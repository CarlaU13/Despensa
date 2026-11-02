import { lookupBarcode } from './barcodes.mjs';
import { AppError, identifier, validate, MAX_ACTIVE_RECORDS } from './domain.mjs';

const enc = new TextEncoder();
const SESSION_SECONDS = 14 * 24 * 3600;
export async function sha256(value) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(value)))].map(x=>x.toString(16).padStart(2,'0')).join('');
}
function equal(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let result = 0;
  for (let i=0;i<a.length;i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}
function token() { return [...crypto.getRandomValues(new Uint8Array(32))].map(x=>x.toString(16).padStart(2,'0')).join(''); }
function json(data, status = 200, headers = {}) { return new Response(JSON.stringify(data), { status, headers: { 'Content-Type':'application/json; charset=utf-8', ...headers } }); }
function secure(response) {
  const result = new Response(response.body, response);
  for (const [key, value] of Object.entries({
    'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff', 'Referrer-Policy':'no-referrer',
    'X-Frame-Options':'DENY', 'Permissions-Policy':'camera=(self), microphone=(), geolocation=()',
    'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    'Strict-Transport-Security':'max-age=31536000', 'Cross-Origin-Resource-Policy':'same-origin'
  })) result.headers.set(key,value);
  return result;
}
function isLocal(request, env) {
  return env.LOCAL_DEV === 'true' && ['localhost','127.0.0.1','[::1]'].includes(new URL(request.url).hostname);
}
function cookieName(request, env) { return isLocal(request,env) ? 'despensa_local' : '__Host-despensa'; }
function cookie(request, env, value, maxAge = SESSION_SECONDS) {
  return `${cookieName(request,env)}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${isLocal(request,env) ? '' : '; Secure'}`;
}
async function credentialVersion(env) { return sha256(`${env.AUTH_USERNAME}:${env.AUTH_PASSWORD_SHA256}`); }
async function session(request, env) {
  const match = (request.headers.get('Cookie') || '').split(';').map(x=>x.trim()).find(x=>x.startsWith(`${cookieName(request,env)}=`));
  const raw = match?.slice(match.indexOf('=')+1);
  if (!raw || !/^[a-f0-9]{64}$/.test(raw)) return null;
  const hash = await sha256(raw);
  const row = await env.DB.prepare('SELECT * FROM sessions WHERE token_hash=? AND expires_at>?').bind(hash, Math.floor(Date.now()/1000)).first();
  return row && equal(row.credential_version, await credentialVersion(env)) ? hash : null;
}
async function readBody(request) {
  if (!(request.headers.get('Content-Type') || '').toLowerCase().startsWith('application/json')) throw new AppError(415,'Se requiere JSON.');
  if (Number(request.headers.get('Content-Length')) > 24576) throw new AppError(413,'Demasiados datos.');
  const reader = request.body?.getReader();
  if (!reader) throw new AppError(400,'Faltan los datos.');
  const chunks=[]; let size=0;
  while (true) {
    const {value,done}=await reader.read(); if(done) break;
    size+=value.byteLength; if(size>24576) { await reader.cancel(); throw new AppError(413,'Demasiados datos.'); }
    chunks.push(value);
  }
  const bytes=new Uint8Array(size); let offset=0;
  for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  try { const data=JSON.parse(new TextDecoder().decode(bytes)); if(!data||typeof data!=='object'||Array.isArray(data)) throw Error(); return data; }
  catch { throw new AppError(400,'Los datos no son válidos.'); }
}
function requireSameOrigin(request) {
  if (request.headers.get('Origin') !== new URL(request.url).origin || request.headers.get('X-Despensa') !== '1') throw new AppError(403,'Solicitud no permitida.');
  const site=request.headers.get('Sec-Fetch-Site');
  if (site && !['same-origin','none'].includes(site)) throw new AppError(403,'Solicitud no permitida.');
}
async function login(request, env) {
  const {username,password} = await readBody(request);
  if (typeof username !== 'string' || typeof password !== 'string' || username.length > 100 || password.length > 256) throw new AppError(400,'Usuario o contraseña inválidos.');
  // The deployment helper generates a 256-bit random password. SHA-256 is used
  // only for this high-entropy credential, never for a human-chosen password.
  const window=Math.floor(Date.now()/900000);
  const ip=request.headers.get('CF-Connecting-IP') || 'local';
  const key=await sha256(`${env.AUTH_PASSWORD_SHA256}:${ip}`);
  const attempts=await env.DB.prepare(`INSERT INTO login_attempts(key,window,count) VALUES(?,?,1)
    ON CONFLICT(key) DO UPDATE SET count=CASE WHEN window=excluded.window THEN count+1 ELSE 1 END,window=excluded.window RETURNING count`).bind(key,window).first();
  if(attempts.count>15) return json({error:'Demasiados intentos. Volvé a probar en 15 minutos.'},429,{'Retry-After':'900'});
  const digest=await sha256(password);
  if (!equal(await sha256(username),await sha256(env.AUTH_USERNAME)) || !equal(digest,env.AUTH_PASSWORD_SHA256)) throw new AppError(401,'Usuario o contraseña incorrectos.');
  const raw=token();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE expires_at<=?').bind(Math.floor(Date.now()/1000)),
    env.DB.prepare('DELETE FROM login_attempts WHERE window<?').bind(window-1),
    env.DB.prepare('INSERT INTO sessions(token_hash,credential_version,expires_at) VALUES(?,?,?)').bind(await sha256(raw),await credentialVersion(env),Math.floor(Date.now()/1000)+SESSION_SECONDS)
  ]);
  return json({ok:true},200,{'Set-Cookie':cookie(request,env,raw)});
}
function unpack(row) { return {id:row.id,kind:row.kind,version:row.version,...JSON.parse(row.data)}; }
function pageNumber(params, name, fallback=0) {
  const raw=params.get(name);
  if(raw===null) return fallback;
  if(!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw))) throw new AppError(400,'Cursor de página inválido.');
  return Number(raw);
}
async function snapshot(env, params=new URLSearchParams()) {
  const limit=pageNumber(params,'limit',500);
  if(limit<1||limit>500) throw new AppError(400,'La página debe tener entre 1 y 500 registros.');
  const meta=await env.DB.prepare('SELECT active_count,COALESCE((SELECT MAX(rowid) FROM records),0) AS upper_rowid,COALESCE((SELECT MAX(rowid) FROM history),0) AS watermark FROM inventory_meta WHERE id=1').first();
  const changes=params.has('since');
  const after=pageNumber(params,changes?'since':'after');
  const upper=pageNumber(params,'upper',meta.upper_rowid);
  const until=pageNumber(params,'until',meta.watermark);
  if(until>meta.watermark || (changes&&after>meta.watermark)) return {reset:true,records:[],history:[],next_cursor:null};
  const query=changes
    ? env.DB.prepare('SELECT h.rowid AS page_cursor,r.* FROM history h JOIN records r ON r.id=h.record_id WHERE h.rowid>? AND h.rowid<=? ORDER BY h.rowid LIMIT ?').bind(after,until,limit+1)
    : env.DB.prepare('SELECT rowid AS page_cursor,* FROM records WHERE deleted=0 AND rowid>? AND rowid<=? ORDER BY rowid LIMIT ?').bind(after,upper,limit+1);
  const firstPage=!params.has('upper')&&!params.has('until')&&(!changes||after!==until);
  const statements=[query];
  if(firstPage) statements.push(env.DB.prepare('SELECT id,record_id,kind,action,label,created_at,undone,group_id FROM history ORDER BY rowid DESC LIMIT 100'));
  const results=await env.DB.batch(statements);
  const rows=results[0].results;
  const page=rows.slice(0,limit);
  return {
    records:page.map(row=>({...unpack(row),deleted:!!row.deleted})),
    ...(firstPage?{history:results[1].results}:{}),
    next_cursor:rows.length>limit?page.at(-1).page_cursor:null,
    change_cursor:until, upper_rowid:upper, total_active:meta.active_count,
    max_active:MAX_ACTIVE_RECORDS, server_time:new Date().toISOString()
  };
}
function version(value) { if(!Number.isInteger(value)||value<1) throw new AppError(400,'Falta la versión del registro.'); return value; }
function mutationStatements(env, operations, groupId, action='edit') {
  const stmts=[]; const events=[];
  for(const op of operations) {
    const event=crypto.randomUUID(); events.push(event);
    const time=new Date().toISOString();
    if(op.create) {
      stmts.push(env.DB.prepare(`INSERT INTO history(id,record_id,kind,action,before_data,before_deleted,before_version,after_version,label,created_at,group_id)
        SELECT ?,?,?,?,NULL,1,0,1,?,?,? WHERE NOT EXISTS(SELECT 1 FROM records WHERE id=?)`).bind(event,op.id,op.kind,action,op.label,time,groupId,op.id));
      stmts.push(env.DB.prepare(`INSERT INTO records(id,kind,data,version,deleted) SELECT ?,?,?,1,0 WHERE EXISTS(SELECT 1 FROM history WHERE id=?)`).bind(op.id,op.kind,JSON.stringify(op.data),event));
    } else {
      stmts.push(env.DB.prepare(`INSERT INTO history(id,record_id,kind,action,before_data,before_deleted,before_version,after_version,label,created_at,group_id)
        SELECT ?,id,kind,?,data,deleted,version,version+1,?,?,? FROM records WHERE id=? AND kind=? AND version=? AND deleted=?`).bind(event,action,op.label,time,groupId,op.id,op.kind,op.version,op.currentDeleted||0));
      stmts.push(env.DB.prepare(`UPDATE records SET data=?,deleted=?,version=version+1 WHERE id=? AND EXISTS(SELECT 1 FROM history WHERE id=?)`).bind(JSON.stringify(op.data),op.deleted?1:0,op.id,event));
    }
  }
  // A CHECK constraint makes every operation roll back when any revision has
  // changed. This includes paired shopping + inventory changes and their undo.
  stmts.push(env.DB.prepare(`INSERT INTO mutation_guards(id,ok) VALUES(?,(SELECT count(*)=? FROM history WHERE id IN (${events.map(()=>'?').join(',')})))`).bind(groupId,events.length,...events));
  stmts.push(env.DB.prepare('DELETE FROM mutation_guards WHERE id=?').bind(groupId));
  return {stmts,events};
}
async function commit(env, operations, action='edit', extra=[]) {
  const group=crypto.randomUUID();
  const {stmts}=mutationStatements(env,operations,group,action);
  await env.DB.batch([...stmts,...extra]);
  return json({ok:true});
}
async function record(env, id, kind) {
  identifier(id);
  const row=await env.DB.prepare('SELECT * FROM records WHERE id=? AND kind=? AND deleted=0').bind(id,kind).first();
  if(!row) throw new AppError(404,'El registro ya no existe.'); return row;
}
async function undo(env, eventId) {
  identifier(eventId);
  const event=await env.DB.prepare("SELECT * FROM history WHERE id=? AND undone=0 AND action!='undo'").bind(eventId).first();
  if(!event) throw new AppError(409,'Este cambio ya fue deshecho.');
  const {results}=await env.DB.prepare('SELECT * FROM history WHERE group_id=? ORDER BY rowid DESC').bind(event.group_id).all();
  const ops=[];
  for(const e of results) {
    if(e.undone) throw new AppError(409,'Este cambio ya fue deshecho.');
    const current=await env.DB.prepare('SELECT * FROM records WHERE id=?').bind(e.record_id).first();
    if(!current||current.version!==e.after_version) throw new AppError(409,'Hay cambios posteriores en este registro. Deshacelos primero.');
    ops.push({id:e.record_id,kind:e.kind,version:e.after_version,currentDeleted:current.deleted,data:e.before_data?JSON.parse(e.before_data):JSON.parse(current.data),deleted:e.before_deleted===1,label:`Deshacer: ${e.label}`});
  }
  const group=crypto.randomUUID();
  const {stmts}=mutationStatements(env,ops,group,'undo');
  await env.DB.batch([...stmts,
    ...results.filter(e=>e.before_version>0).map(e=>env.DB.prepare("UPDATE history SET after_version=? WHERE record_id=? AND after_version=? AND undone=0 AND action!='undo'").bind(e.after_version+1,e.record_id,e.before_version)),
    env.DB.prepare('UPDATE history SET undone=1 WHERE group_id=?').bind(event.group_id)
  ]);
  return json({ok:true});
}
async function api(request,env,path) {
  const params=new URL(request.url).searchParams;
  if (!env.DB || !env.AUTH_USERNAME || !/^[a-f0-9]{64}$/.test(env.AUTH_PASSWORD_SHA256||'')) throw new AppError(503,'La despensa todavía no está configurada.');
  if(request.method!=='GET') requireSameOrigin(request);
  if(path==='/api/login' && request.method==='POST') return login(request,env);
  const currentSession=await session(request,env);
  if(!currentSession) throw new AppError(401,'Iniciá sesión para entrar a tu despensa.');
  if(path==='/api/barcode/lookup'&&request.method==='POST') {
    const body=await readBody(request);
    return json(await lookupBarcode(env.DB,body.barcode));
  }
  if(path==='/api/session'&&request.method==='GET') return json({username:env.AUTH_USERNAME});
  if(path==='/api/logout'&&request.method==='POST') {
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(currentSession).run();
    return json({ok:true},200,{'Set-Cookie':cookie(request,env,'',0)});
  }
  if(path==='/api/logout-all'&&request.method==='POST') {
    await env.DB.prepare('DELETE FROM sessions').run();
    return json({ok:true},200,{'Set-Cookie':cookie(request,env,'',0)});
  }
  if(path==='/api/state'&&request.method==='GET') return json(await snapshot(env,params));
  if(path==='/api/export'&&request.method==='GET') {
    const data=await snapshot(env,params);
    return json({format:'despensa-v1',exported_at:new Date().toISOString(),...data});
  }
  const match=path.match(/^\/api\/(location|product|lot|shopping)(?:\/([a-zA-Z0-9_-]+))?$/);
  if(match) {
    const [,kind,id]=match;
    if(!id&&request.method==='POST') {
      const data=validate(kind,await readBody(request));
      const count=await env.DB.prepare('SELECT active_count AS total FROM inventory_meta WHERE id=1').first();
      if(count.total>=MAX_ACTIVE_RECORDS) throw new AppError(409,'Se alcanzó el límite de 50.000 registros activos.');
      return commit(env,[{create:true,id:crypto.randomUUID(),kind,data,label:`Agregar ${data.name||'compra / lote'}`}],'create');
    }
    if(id&&['PUT','DELETE'].includes(request.method)) {
      const body=await readBody(request); const old=await record(env,id,kind);
      if(request.method==='PUT'&&(!body.data||typeof body.data!=='object'||Array.isArray(body.data)))throw new AppError(400,'Datos inválidos.');
      const previous=JSON.parse(old.data);
      const data=request.method==='DELETE'?previous:validate(kind,{...previous,...body.data});
      if(kind==='product'&&request.method==='PUT'&&data.barcode!==previous.barcode&&!Object.hasOwn(body.data,'barcode_source'))data.barcode_source=null;
      return commit(env,[{id,kind,version:version(body.version),data,deleted:request.method==='DELETE',label:body.action==='consume'?'Registrar consumo':body.action==='move'?'Mover de lugar':`${request.method==='DELETE'?'Eliminar':'Editar'} ${data.name||'compra / lote'}`}],request.method==='DELETE'?'delete':'edit');
    }
  }
  if(path==='/api/move'&&request.method==='POST') {
    const body=await readBody(request);
    const row=await record(env,body.id,'lot');
    const old=JSON.parse(row.data);
    if(typeof body.amount!=='number'||!Number.isFinite(body.amount)||body.amount<=0||body.amount>old.quantity||Math.round(body.amount*1000)===0) throw new AppError(400,'Ingresá una cantidad disponible y mayor a cero.');
    const amount=Math.round(body.amount*1000)/1000;
    const location_id=identifier(body.location_id,true);
    if(location_id===old.location_id) throw new AppError(400,'Elegí un lugar distinto del actual.');
    const complete=amount===old.quantity;
    const operations=[{id:row.id,kind:'lot',version:version(body.version),data:{...old,...(complete?{location_id}:{quantity:Math.round((old.quantity-amount)*1000)/1000})},label:'Mover de lugar'}];
    if(!complete) operations.push({create:true,id:crypto.randomUUID(),kind:'lot',data:{...old,location_id,quantity:amount},label:'Separar parte del lote'});
    return commit(env,operations,'move');
  }
  if(path==='/api/receive'&&request.method==='POST') {
    const body=await readBody(request);
    const shopping=await record(env,body.shopping_id,'shopping');
    const previous=JSON.parse(shopping.data);
    if(previous.purchased) throw new AppError(409,'Esta compra ya se registró.');
    const lot=validate('lot',body.lot);
    if(lot.quantity<=0) throw new AppError(400,'La cantidad comprada debe ser mayor a cero.');
    if(previous.product_id&&previous.product_id!==lot.product_id) throw new AppError(400,'Elegí el mismo producto de la lista.');
    return commit(env,[
      {id:shopping.id,kind:'shopping',version:version(body.version),data:{...previous,purchased:true},label:`Comprar ${previous.name}`},
      {create:true,id:crypto.randomUUID(),kind:'lot',data:lot,label:`Ingresar ${previous.name} al inventario`}
    ],'receive');
  }
  if(path.startsWith('/api/undo/')&&request.method==='POST') return undo(env,path.split('/').pop());
  throw new AppError(404,'Ruta no encontrada.');
}
export default {
  async fetch(request,env) {
    try {
      const url=new URL(request.url);
      if(url.protocol!=='https:'&&!isLocal(request,env)) return secure(new Response('Se requiere HTTPS.',{status:400}));
      if(url.pathname.startsWith('/api/')) return secure(await api(request,env,url.pathname));
      if(!['GET','HEAD'].includes(request.method)) return secure(new Response('Método no permitido.',{status:405}));
      return secure(await env.ASSETS.fetch(request));
    } catch(error) {
      if(error instanceof AppError) return secure(json({error:error.message},error.status));
      const message=String(error.message||'');
      if(/product_barcode_unique/.test(message)) return secure(json({error:'Este código ya está asociado a otro producto. Buscalo desde Escanear código para usarlo.'},409));
      if(/capacity_limit/.test(message)) return secure(json({error:'Se alcanzó el límite de 50.000 registros activos.'},409));
      if(/in_use|invalid_product|invalid_location|unit_in_use|CHECK constraint failed|UNIQUE constraint failed/.test(message)) {
        const explanation=/unit_in_use/.test(message)?'Este producto tiene lotes: mantené su unidad o creá otro producto.':/in_use/.test(message)?'Hay productos o compras asociados. Movelos o eliminalos primero.':/invalid_product|invalid_location/.test(message)?'El producto o lugar ya no existe. Actualizá e intentá otra vez.':'Alguien modificó este registro. Actualizá para ver el último cambio.';
        return secure(json({error:explanation},409));
      }
      // Do not log credentials, request bodies, cookies or inventory contents.
      return secure(json({error:'No pudimos completar la operación. Intentá nuevamente.'},500));
    }
  }
};
