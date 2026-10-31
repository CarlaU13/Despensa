import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import worker,{sha256} from '../src/worker.mjs';
import {database} from '../scripts/sqlite.mjs';
async function fixture(t){
 const DB=database();t.after(()=>DB.close());
 const password=randomBytes(32).toString('base64url');
 const env={DB,AUTH_USERNAME:'familia',AUTH_PASSWORD_SHA256:await sha256(password),ASSETS:{fetch:async()=>new Response('app')}};
 let cookie='';
 const call=async(path,method='GET',body,custom={})=>{
 const headers={...(method==='GET'?{}:{Origin:'https://despensa.test','Content-Type':'application/json','X-Despensa':'1'}),...(cookie?{Cookie:cookie}:{}),...custom};
 const response=await worker.fetch(new Request('https://despensa.test'+path,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})}),env);
 const raw=await response.text();let data;try{data=JSON.parse(raw);}catch{data=raw;}
 return {status:response.status,headers:response.headers,data};
 };
 const login=async()=>{
 const result=await call('/api/login','POST',{username:'familia',password});assert.equal(result.status,200,JSON.stringify(result.data));cookie=result.headers.get('set-cookie').split(';')[0];return result;
 };
 const state=async()=>{const result=await call('/api/state');assert.equal(result.status,200);return result.data;};
 const create=async(kind,data)=>{
 const result=await call('/api/'+kind,'POST',data);assert.equal(result.status,200,JSON.stringify(result.data));
 return (await state()).records.filter(r=>r.kind===kind).at(-1);
 };
 return {env,call,login,state,create,password};
}
test('no expone inventario ni exportaciones sin sesión; aplica cabeceras de seguridad',async t=>{
 const f=await fixture(t);
 for(const endpoint of ['/api/state','/api/export','/api/session']){const r=await f.call(endpoint);assert.equal(r.status,401);assert.equal(r.headers.get('cache-control'),'no-store');assert.equal(r.headers.get('x-frame-options'),'DENY');assert.match(r.headers.get('content-security-policy'),/frame-ancestors 'none'/);}
});
test('sesión segura, contraseña fuera de la base y cierre de todos los dispositivos',async t=>{
 const f=await fixture(t),login=await f.login();
 const cookie=login.headers.get('set-cookie');for(const attr of ['__Host-despensa=','HttpOnly','SameSite=Strict','Secure','Path=/'])assert.ok(cookie.includes(attr));
 const stored=f.env.DB._raw.prepare('SELECT * FROM sessions').get();
 assert.notEqual(stored.token_hash,cookie.split(';')[0].split('=')[1]);assert.equal(JSON.stringify(stored).includes(f.password),false);
 assert.equal((await f.call('/api/session')).data.username,'familia');
 assert.equal((await f.call('/api/logout-all','POST',{})).status,200);
 assert.equal((await f.call('/api/state')).status,401);
});
test('rechaza solicitudes desde otros orígenes y cuerpos demasiado grandes',async t=>{
 const f=await fixture(t);await f.login();
 assert.equal((await f.call('/api/product','POST',{name:'Leche'},{Origin:'https://otro.test'})).status,403);
 assert.equal((await f.call('/api/product','POST',{name:'Leche'},{'X-Despensa':''})).status,403);
 assert.equal((await f.call('/api/product','POST',{name:'a'.repeat(26000)})).status,413);
});
test('limita intentos de acceso y rechaza contraseñas incorrectas',async t=>{
 const f=await fixture(t);
 for(let i=0;i<15;i++)assert.equal((await f.call('/api/login','POST',{username:'familia',password:'incorrecta'})).status,401);
 const limited=await f.call('/api/login','POST',{username:'familia',password:f.password});
 assert.equal(limited.status,429);assert.equal(limited.headers.get('retry-after'),'900');
});
test('rotar el acceso invalida sesiones anteriores',async t=>{
 const f=await fixture(t);await f.login();f.env.AUTH_PASSWORD_SHA256=await sha256(randomBytes(32).toString('base64url'));
 assert.equal((await f.call('/api/state')).status,401);
});
test('compras opcionales, lotes en varios lugares y cantidades decimales',async t=>{
 const f=await fixture(t);await f.login();const p=await f.create('product',{name:'Sal',unit:'g'});
 const a=await f.create('location',{name:'Alacena'}),b=await f.create('location',{name:'Apoyo'});
 await f.create('lot',{product_id:p.id,location_id:a.id,quantity:500.5});await f.create('lot',{product_id:p.id,location_id:b.id,quantity:200,purchase_date:'2026-10-31'});
 assert.equal((await f.state()).records.filter(r=>r.kind==='lot').length,2);
});
test('los cambios simultáneos no sobrescriben información ni agregan historial falso',async t=>{
 const f=await fixture(t);await f.login();const p=await f.create('product',{name:'Leche'});
 assert.equal((await f.call('/api/product/'+p.id,'PUT',{version:p.version,data:{...p,name:'Leche entera'}})).status,200);
 const before=await f.state();
 const stale=await f.call('/api/product/'+p.id,'PUT',{version:p.version,data:{...p,name:'Otro nombre'}});
 assert.equal(stale.status,409);
 const after=await f.state();assert.equal(after.records.find(r=>r.id===p.id).name,'Leche entera');assert.equal(after.history.length,before.history.length);
});
test('protege lugares, productos y unidades con lotes asociados',async t=>{
 const f=await fixture(t);await f.login();const p=await f.create('product',{name:'Arroz',unit:'kg'}),l=await f.create('location',{name:'Alacena'});
 await f.create('lot',{product_id:p.id,location_id:l.id,quantity:1});
 assert.equal((await f.call('/api/location/'+l.id,'DELETE',{version:l.version})).status,409);
 assert.equal((await f.call('/api/product/'+p.id,'DELETE',{version:p.version})).status,409);
 assert.equal((await f.call('/api/product/'+p.id,'PUT',{version:p.version,data:{...p,unit:'g'}})).status,409);
 assert.equal((await f.call('/api/lot','POST',{product_id:p.id,location_id:'missing'})).status,409);
});
test('comprar desde la lista es atómico, impide duplicados y se deshace como un solo cambio',async t=>{
 const f=await fixture(t);await f.login();const p=await f.create('product',{name:'Leche'});
 const shopping=await f.create('shopping',{name:'Leche',product_id:p.id,quantity:2});
 const body={shopping_id:shopping.id,version:shopping.version,lot:{product_id:p.id,quantity:2,purchase_date:'2026-10-31'}};
 assert.equal((await f.call('/api/receive','POST',body)).status,200);
 let s=await f.state();assert.equal(s.records.find(r=>r.id===shopping.id).purchased,true);assert.equal(s.records.filter(r=>r.kind==='lot').length,1);
 assert.equal((await f.call('/api/receive','POST',body)).status,409);
 const event=s.history.find(h=>h.action==='receive');
 assert.equal((await f.call('/api/undo/'+event.id,'POST',{})).status,200);
 s=await f.state();assert.equal(s.records.find(r=>r.id===shopping.id).purchased,false);assert.equal(s.records.filter(r=>r.kind==='lot').length,0);
 assert.equal((await f.call('/api/undo/'+event.id,'POST',{})).status,409);
});
test('una recepción con versión vieja o referencia inválida no deja lotes huérfanos',async t=>{
 const f=await fixture(t);await f.login();const p=await f.create('product',{name:'Leche'}),s=await f.create('shopping',{name:'Leche',product_id:p.id});
 await f.call('/api/shopping/'+s.id,'PUT',{version:s.version,data:{...s,quantity:3}});
 const stale=await f.call('/api/receive','POST',{shopping_id:s.id,version:s.version,lot:{product_id:p.id,quantity:2}});
 assert.equal(stale.status,409);assert.equal((await f.state()).records.filter(r=>r.kind==='lot').length,0);
 const updated=(await f.state()).records.find(r=>r.id===s.id);
 const invalid=await f.call('/api/receive','POST',{shopping_id:s.id,version:updated.version,lot:{product_id:p.id,location_id:'missing',quantity:2}});
 assert.equal(invalid.status,409);const final=await f.state();assert.equal(final.records.find(r=>r.id===s.id).purchased,false);assert.equal(final.records.filter(r=>r.kind==='lot').length,0);
});
test('deshacer respeta cambios posteriores y no puede romper referencias',async t=>{
 const f=await fixture(t);await f.login();const p=await f.create('product',{name:'Tomate'});
 const creation=(await f.state()).history.find(h=>h.record_id===p.id);
 await f.create('lot',{product_id:p.id});
 assert.equal((await f.call('/api/undo/'+creation.id,'POST',{})).status,409);
 await f.call('/api/product/'+p.id,'PUT',{version:p.version,data:{...p,name:'Tomate perita'}});
 assert.equal((await f.call('/api/undo/'+creation.id,'POST',{})).status,409);
});
test('mover una parte conserva la cantidad total y permite deshacer ambos lotes',async t=>{
 const f=await fixture(t);await f.login();const p=await f.create('product',{name:'Tomate'}),a=await f.create('location',{name:'Frutero'}),b=await f.create('location',{name:'Heladera'});
 const lot=await f.create('lot',{product_id:p.id,location_id:a.id,quantity:5});
 assert.equal((await f.call('/api/move','POST',{id:lot.id,version:lot.version,amount:2,location_id:b.id})).status,200);
 let s=await f.state();const lots=s.records.filter(r=>r.kind==='lot');assert.equal(lots.length,2);assert.equal(lots.reduce((sum,l)=>sum+l.quantity,0),5);assert.equal(lots.find(l=>l.location_id===b.id).quantity,2);
 const event=s.history.find(h=>h.action==='move');assert.equal((await f.call('/api/undo/'+event.id,'POST',{})).status,200);
 s=await f.state();assert.equal(s.records.filter(r=>r.kind==='lot').length,1);assert.equal(s.records.find(r=>r.id===lot.id).quantity,5);
});
test('rechaza movimientos imposibles sin modificar inventario',async t=>{
 const f=await fixture(t);await f.login();const p=await f.create('product',{name:'Leche'}),lot=await f.create('lot',{product_id:p.id,quantity:2});
 for(const amount of [0,-1,3,'1'])assert.equal((await f.call('/api/move','POST',{id:lot.id,version:lot.version,amount,location_id:null})).status,400);
 assert.equal((await f.state()).records.find(r=>r.id===lot.id).quantity,2);
});
test('la exportación autenticada es portable y nunca contiene secretos ni sesiones',async t=>{
 const f=await fixture(t);await f.login();await f.create('product',{name:"Sal '); DROP TABLE records; --"});
 const result=await f.call('/api/export');assert.equal(result.status,200);assert.equal(result.data.format,'despensa-v1');assert.equal(result.data.records.length,1);
 assert.equal(JSON.stringify(result.data).includes(f.password),false);assert.equal('sessions' in result.data,false);
 assert.match(result.headers.get('content-disposition'),/attachment/);
});

test('deshacer cambios sucesivos permite volver hasta el estado inicial',async t=>{
 const f=await fixture(t);await f.login();let p=await f.create('product',{name:'Sal'});
 await f.call('/api/product/'+p.id,'PUT',{version:p.version,data:{...p,name:'Sal fina'}});
 p=(await f.state()).records.find(r=>r.id===p.id);
 await f.call('/api/product/'+p.id,'PUT',{version:p.version,data:{...p,name:'Sal gruesa'}});
 let s=await f.state();assert.equal((await f.call('/api/undo/'+s.history[0].id,'POST',{})).status,200);
 s=await f.state();assert.equal(s.records.find(r=>r.id===p.id).name,'Sal fina');
 const previous=s.history.find(h=>h.action==='edit'&&!h.undone);
 assert.equal((await f.call('/api/undo/'+previous.id,'POST',{})).status,200);
 s=await f.state();assert.equal(s.records.find(r=>r.id===p.id).name,'Sal');
});
