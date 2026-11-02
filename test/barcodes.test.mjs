import test from 'node:test';
import assert from 'node:assert/strict';
import {database} from '../scripts/sqlite.mjs';
import {normalizeBarcode,validate} from '../src/domain.mjs';
import {lookupBarcode,fetchBarcode} from '../src/barcodes.mjs';
import worker,{sha256} from '../src/worker.mjs';
const CODE='03017620422003';
const response=()=>new Response(JSON.stringify({code:'3017620422003',status:1,product:{code:'3017620422003',product_name_es:'Producto de ejemplo',brands:'Marca de ejemplo',quantity:'500 g',product_type:'food'}}),{headers:{'content-type':'application/json'}});
test('normaliza códigos EAN y UPC equivalentes y verifica su dígito de control',()=>{
 assert.equal(normalizeBarcode('3017620422003'),CODE);
 assert.equal(normalizeBarcode('036000291452'),normalizeBarcode('0036000291452'));
 assert.equal(normalizeBarcode('96385074'),'00000096385074');
 assert.equal(normalizeBarcode('3017 6204-22003'),CODE);
 assert.equal(normalizeBarcode(''),null);
 for(const bad of ['3017620422004','123','https://evil.test/123','0000000000000',123,{},'123456789012345'])assert.throws(()=>normalizeBarcode(bad));
});
test('los campos nuevos son opcionales y no cambian la unidad de stock',()=>{
 const p=validate('product',{name:'Leche'});assert.equal(p.barcode,null);assert.equal(p.brand,null);assert.equal(p.presentation,null);
 const imported=validate('product',{name:'Leche',barcode:'3017620422003',brand:'Marca',presentation:'500 ml',barcode_source:'openfoodfacts'});
 assert.equal(imported.barcode,CODE);assert.equal(imported.unit,'unidad');assert.equal(imported.presentation,'500 ml');
 assert.equal(validate('product',{name:'Leche',barcode_source:'openfoodfacts'}).barcode_source,null);
});
test('la consulta externa envía únicamente el código y un identificador público de la aplicación',async()=>{
 const calls=[];
 const result=await fetchBarcode(CODE,async(url,options)=>{calls.push({url,options});return response();});
 assert.equal(result.status,'found');assert.equal(result.product.brand,'Marca de ejemplo');
 assert.ok(calls[0].url.includes(CODE));assert.ok(calls[0].url.includes('product_type=all'));
 assert.deepEqual(Object.keys(calls[0].options.headers).sort(),['Accept','User-Agent']);
 assert.equal(calls[0].options.redirect,'manual');assert.equal('body' in calls[0].options,false);
});
test('rechaza redirecciones a destinos ajenos a Open Facts',async()=>{
 let calls=0;
 await assert.rejects(fetchBarcode(CODE,async()=>{calls++;return new Response(null,{status:302,headers:{location:'https://evil.test/api/v3/product/'+CODE}});}));
 assert.equal(calls,1);
});
test('permite redirecciones controladas a otra base para cosméticos o limpieza',async()=>{
 let calls=0;
 const result=await fetchBarcode(CODE,async()=>{
 calls++;if(calls===1)return new Response(null,{status:302,headers:{location:'https://world.openproductsfacts.org/api/v3/product/'+CODE+'.json'}});
 return new Response(JSON.stringify({code:CODE,status:1,product:{code:CODE,product_name:'Limpiador de ejemplo',product_type:'product'}}));
 });
 assert.equal(result.source,'openproductsfacts');assert.equal(result.product.category,null);
});
test('la caché evita repetir consultas y nunca crea productos automáticamente',async t=>{
 const db=database();t.after(()=>db.close());let calls=0;
 const fetcher=async()=>{calls++;return response();};
 const first=await lookupBarcode(db,CODE,fetcher),second=await lookupBarcode(db,'3017620422003',fetcher);
 assert.equal(first.status,'found');assert.equal(second.cached,true);assert.equal(calls,1);
 assert.equal(db._raw.prepare('SELECT active_count FROM inventory_meta').get().active_count,0);
});
test('consulta el catálogo antes del servicio externo, incluso con el cupo agotado',async t=>{
 const db=database();t.after(()=>db.close());
 const product=validate('product',{name:'Producto propio',barcode:CODE});
 db._raw.prepare("INSERT INTO records(id,kind,data) VALUES('own','product',?)").run(JSON.stringify(product));
 let called=false;const result=await lookupBarcode(db,CODE,async()=>{called=true;throw Error();});
 assert.equal(result.status,'existing');assert.equal(result.product.id,'own');assert.equal(called,false);
});
test('una caída del servicio deja disponible la carga manual y no se guarda como ausencia definitiva',async t=>{
 const db=database();t.after(()=>db.close());
 const result=await lookupBarcode(db,CODE,async()=>new Response('no',{status:503}));
 assert.equal(result.status,'unavailable');assert.equal(db._raw.prepare('SELECT count(*) AS n FROM barcode_cache').get().n,0);
 const good=await lookupBarcode(db,CODE,async()=>response());assert.equal(good.status,'found');
});
test('un resultado ausente se puede recordar sin impedir la carga manual',async t=>{
 const db=database();t.after(()=>db.close());let calls=0;
 const missing=async()=>{calls++;return new Response(JSON.stringify({status:0}));};
 assert.equal((await lookupBarcode(db,CODE,missing)).status,'not_found');
 assert.equal((await lookupBarcode(db,CODE,missing)).cached,true);assert.equal(calls,1);
});
test('limita consultas nuevas, pero sigue permitiendo artículos ya guardados',async t=>{
 const db=database();t.after(()=>db.close());
 const minute=Math.floor(Date.now()/60000);db._raw.prepare('UPDATE barcode_lookup_budget SET minute=?,used=10').run(minute);
 let called=false;const result=await lookupBarcode(db,CODE,async()=>{called=true;return response();});
 assert.equal(result.reason,'rate_limit');assert.equal(called,false);
});
test('no acepta datos externos de otro código ni respuestas desproporcionadas',async()=>{
 await assert.rejects(fetchBarcode(CODE,async()=>new Response(JSON.stringify({status:1,product:{code:'036000291452',product_name:'Otro'}}))));
 await assert.rejects(fetchBarcode(CODE,async()=>new Response('x',{headers:{'content-length':'70000'}})));
});
async function apiFixture(t){
 const DB=database();t.after(()=>DB.close());
 const env={DB,AUTH_USERNAME:'familia',AUTH_PASSWORD_SHA256:await sha256('synthetic-test-password'),ASSETS:{fetch:async()=>new Response('app')}};
 let cookie='';
 async function call(path,method='GET',body,custom={}){
 const response=await worker.fetch(new Request('https://despensa.test'+path,{method,headers:{...(cookie?{Cookie:cookie}:{}),...(method==='GET'?{}:{Origin:'https://despensa.test','X-Despensa':'1','Content-Type':'application/json'}),...custom},...(body===undefined?{}:{body:JSON.stringify(body)})}),env);
 const data=await response.json();return {response,data};
 }
 async function login(){const r=await call('/api/login','POST',{username:'familia',password:'synthetic-test-password'});cookie=r.response.headers.get('set-cookie').split(';')[0];}
 return {DB,call,login};
}
test('el buscador exige sesión, origen propio y un código válido',async t=>{
 const f=await apiFixture(t);
 assert.equal((await f.call('/api/barcode/lookup','POST',{barcode:CODE})).response.status,401);
 await f.login();
 assert.equal((await f.call('/api/barcode/lookup','POST',{barcode:CODE},{Origin:'https://otro.test'})).response.status,403);
 assert.equal((await f.call('/api/barcode/lookup','POST',{barcode:'not-a-code'})).response.status,400);
});
test('la asociación única impide duplicados EAN/UPC sin perder datos al editar con una versión anterior de la interfaz',async t=>{
 const f=await apiFixture(t);await f.login();
 const body={name:'Artículo',barcode:'036000291452',brand:'Marca',presentation:'1 l'};
 assert.equal((await f.call('/api/product','POST',body)).response.status,200);
 assert.equal((await f.call('/api/product','POST',{...body,barcode:'0036000291452'})).response.status,409);
 const p=(await f.call('/api/state')).data.records[0];
 assert.equal((await f.call('/api/product/'+p.id,'PUT',{version:p.version,data:null})).response.status,400);
 assert.equal((await f.call('/api/product/'+p.id,'PUT',{version:p.version,data:{name:'Artículo editado',unit:'unidad',minimum:null,notes:null,category:null}})).response.status,200);
 const saved=(await f.call('/api/state')).data.records[0];
 assert.equal(saved.barcode,normalizeBarcode(body.barcode));assert.equal(saved.brand,'Marca');assert.equal(saved.presentation,'1 l');
 assert.equal((await f.call('/api/product/'+p.id,'PUT',{version:saved.version,data:{barcode:''}})).response.status,200);
 assert.equal((await f.call('/api/product','POST',body)).response.status,200);
});
