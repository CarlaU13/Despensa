import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import worker,{sha256} from '../src/worker.mjs';
import {database} from '../scripts/sqlite.mjs';
import {syncRecords} from '../public/sync.mjs';
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
 assert.equal(result.data.next_cursor,null);
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

function seedProducts(db,total,prefix='bulk') {
 const stmt=db._raw.prepare("INSERT INTO records(id,kind,data,version,deleted) VALUES(?,'product',?,1,0)");
 db._raw.exec('BEGIN IMMEDIATE');
 try { for(let i=0;i<total;i++)stmt.run(prefix+'-'+i,JSON.stringify({name:'Artículo '+i,category:i%2?'Limpieza':'Alimentos',unit:'unidad',minimum:null,notes:null})); db._raw.exec('COMMIT'); }
 catch(error){db._raw.exec('ROLLBACK');throw error;}
}
test('la carga de más de 5000 registros se pagina sin omitir ninguno',async t=>{
 const f=await fixture(t);await f.login();seedProducts(f.env.DB,5100);
 const first=await f.call('/api/state');
 assert.equal(first.data.records.length,500);assert.equal(first.data.total_active,5100);assert.equal(first.data.max_active,50000);assert.ok(first.data.next_cursor);
 const loaded=await syncRecords(async url=>{const r=await f.call(url);assert.equal(r.status,200);return r.data;});
 assert.equal(loaded.map.size,5100);assert.ok(loaded.map.has('bulk-5099'));
 const created=await f.call('/api/product','POST',{name:'Por encima del límite anterior',category:'Limpieza'});
 assert.equal(created.status,200);
 const resynced=await syncRecords(async url=>(await f.call(url)).data,loaded.map,loaded.cursor);
 assert.equal(resynced.map.size,5101);
});
test('el límite de 50000 es atómico y se libera al eliminar un registro',async t=>{
 const f=await fixture(t);await f.login();seedProducts(f.env.DB,50000);
 assert.equal((await f.call('/api/product','POST',{name:'No entra'})).status,409);
 assert.equal(f.env.DB._raw.prepare('SELECT active_count FROM inventory_meta').get().active_count,50000);
 assert.equal((await f.call('/api/product/bulk-0','DELETE',{version:1})).status,200);
 assert.equal(f.env.DB._raw.prepare('SELECT active_count FROM inventory_meta').get().active_count,49999);
 assert.equal((await f.call('/api/product','POST',{name:'Sí entra'})).status,200);
 assert.equal(f.env.DB._raw.prepare('SELECT active_count FROM inventory_meta').get().active_count,50000);
 const event=f.env.DB._raw.prepare("SELECT id FROM history WHERE action='delete'").get();
 assert.equal((await f.call('/api/undo/'+event.id,'POST',{})).status,409);
 assert.equal(f.env.DB._raw.prepare('SELECT deleted FROM records WHERE id=?').get('bulk-0').deleted,1);
});
test('una recepción al alcanzar capacidad revierte lista, lote e historial',async t=>{
 const f=await fixture(t);await f.login();
 const p=await f.create('product',{name:'Detergente',category:'Limpieza'});
 const shopping=await f.create('shopping',{name:'Detergente',product_id:p.id});
 seedProducts(f.env.DB,49998);
 const response=await f.call('/api/receive','POST',{shopping_id:shopping.id,version:shopping.version,lot:{product_id:p.id,quantity:1}});
 assert.equal(response.status,409);
 assert.equal(JSON.parse(f.env.DB._raw.prepare('SELECT data FROM records WHERE id=?').get(shopping.id).data).purchased,false);
 assert.equal(f.env.DB._raw.prepare("SELECT count(*) AS n FROM history WHERE action='receive'").get().n,0);
 assert.equal(f.env.DB._raw.prepare('SELECT active_count FROM inventory_meta').get().active_count,50000);
});
test('la sincronización incremental comunica ediciones y eliminaciones sin recargar el inventario',async t=>{
 const f=await fixture(t);await f.login();
 const p=await f.create('product',{name:'Lavandina',category:'Limpieza'});
 const api=async url=>(await f.call(url)).data;
 const original=await syncRecords(api);
 await f.call('/api/product/'+p.id,'PUT',{version:p.version,data:{...p,name:'Lavandina concentrada'}});
 const delta=await f.call('/api/state?since='+original.cursor);
 assert.equal(delta.data.records.length,1);assert.equal(delta.data.records[0].name,'Lavandina concentrada');
 const updated=await syncRecords(api,original.map,original.cursor);
 assert.equal(updated.map.get(p.id).name,'Lavandina concentrada');
 await f.call('/api/product/'+p.id,'DELETE',{version:2});
 const removed=await syncRecords(api,updated.map,updated.cursor);assert.equal(removed.map.size,0);
 const unchanged=await f.call('/api/state?since='+removed.cursor);
 assert.equal(unchanged.data.records.length,0);assert.equal('history' in unchanged.data,false);
});
test('la exportación paginada incluye todos los registros después de la primera página',async t=>{
 const f=await fixture(t);await f.login();seedProducts(f.env.DB,1100);
 let cursor=0,upper,until;const ids=new Set();
 do {
 const params=new URLSearchParams({after:String(cursor)});
 if(upper!==undefined)params.set('upper',String(upper));
 if(until!==undefined)params.set('until',String(until));
 const response=await f.call('/api/export?'+params);assert.equal(response.status,200);
 const data=response.data;assert.equal(data.format,'despensa-v1');
 upper=data.upper_rowid;until=data.change_cursor;for(const r of data.records)ids.add(r.id);cursor=data.next_cursor;
 }while(cursor!==null);
 assert.equal(ids.size,1100);
});
test('rechaza cursores y tamaños de página inválidos',async t=>{
 const f=await fixture(t);await f.login();
 for(const query of ['after=-1','since=abc','limit=0','limit=501','after=1.5','upper=NaN'])assert.equal((await f.call('/api/state?'+query)).status,400);
});
test('conserva las categorías libres de limpieza y las fechas opcionales',async t=>{
 const f=await fixture(t);await f.login();const p=await f.create('product',{name:'Limpiador',category:'Limpieza'});
 const lot=await f.create('lot',{product_id:p.id});
 assert.equal(p.category,'Limpieza');assert.equal(lot.expiry_date,null);
});
