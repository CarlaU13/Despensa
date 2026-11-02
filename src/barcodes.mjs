import { AppError, normalizeBarcode, BARCODE_SOURCES } from './domain.mjs';
const HOSTS=new Set(Object.values(BARCODE_SOURCES).map(s=>s.host));
const USER_AGENT='DespensaFamiliar/1.1 (+https://github.com/CarlaU13/Despensa)';
function clean(value,max){return typeof value==='string'?value.trim().slice(0,max)||null:null;}
async function boundedJson(response) {
  if(Number(response.headers.get('content-length'))>65536)throw Error('Respuesta demasiado grande.');
  const reader=response.body?.getReader();if(!reader)throw Error('Sin respuesta.');
  const chunks=[];let size=0;
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>65536){await reader.cancel();throw Error('Respuesta demasiado grande.');}chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  return JSON.parse(new TextDecoder().decode(bytes));
}
export async function fetchBarcode(barcode,fetcher=fetch) {
  const params=new URLSearchParams({product_type:'all',lc:'es',fields:'code,product_name,brands,quantity,product_type'});
  let url=new URL('https://world.openfoodfacts.org/api/v3.6/product/'+barcode+'.json?'+params);
  const signal=AbortSignal.timeout(7000);
  for(let redirects=0;redirects<4;redirects++){
    if(url.protocol!=='https:'||url.username||url.password||url.port||!HOSTS.has(url.hostname)||!/^\/api\/v3(?:\.6)?\/product\/[0-9]{8,14}(?:\.json)?$/.test(url.pathname))throw Error('Destino no permitido.');
    const response=await fetcher(url.toString(),{headers:{Accept:'application/json','User-Agent':USER_AGENT},redirect:'manual',signal});
    if([301,302,303,307,308].includes(response.status)){
      const location=response.headers.get('location');if(!location)throw Error('Redirección inválida.');
      url=new URL(location,url);await response.body?.cancel();continue;
    }
    if(response.status===404)return {status:'not_found',barcode};
    if(!response.ok)throw Error('Servicio no disponible.');
    const body=await boundedJson(response);
    if(body.status===0)return {status:'not_found',barcode};
    const p=body.product;if(!p)throw Error('Respuesta sin producto.');
    if(normalizeBarcode(String(p.code||body.code||''))!==barcode)throw Error('El código de la respuesta no coincide.');
    const type=p.product_type||body.product_type;
    const source=({food:'openfoodfacts',beauty:'openbeautyfacts',petfood:'openpetfoodfacts',product:'openproductsfacts'})[type]||Object.keys(BARCODE_SOURCES).find(k=>BARCODE_SOURCES[k].host===url.hostname);
    if(!source)throw Error('Fuente desconocida.');
    return {status:'found',barcode,source,product:{
      name:clean(p.product_name_es,140)||clean(p.product_name,140),brand:clean(p.brands,100),
      presentation:clean(p.quantity,100),category:BARCODE_SOURCES[source].category,unit:'unidad',barcode,barcode_source:source
    }};
  }
  throw Error('Demasiadas redirecciones.');
}
export async function lookupBarcode(db,input,fetcher=fetch) {
  const barcode=normalizeBarcode(input);if(!barcode)throw new AppError(400,'Ingresá o escaneá un código.');
  const existing=await db.prepare("SELECT id,kind,data,version FROM records WHERE kind='product' AND deleted=0 AND json_extract(data,'$.barcode')=?").bind(barcode).first();
  if(existing)return {status:'existing',barcode,product:{id:existing.id,kind:existing.kind,version:existing.version,...JSON.parse(existing.data)}};
  const now=Math.floor(Date.now()/1000);
  const cached=await db.prepare('SELECT payload FROM barcode_cache WHERE barcode=? AND expires_at>?').bind(barcode,now).first();
  if(cached)return {...JSON.parse(cached.payload),cached:true};
  const budget=await db.prepare('UPDATE barcode_lookup_budget SET used=CASE WHEN minute=? THEN used+1 ELSE 1 END,minute=? WHERE id=1 RETURNING used').bind(Math.floor(now/60),Math.floor(now/60)).first();
  if(budget.used>10)return {status:'unavailable',barcode,reason:'rate_limit',retry_after:60};
  let result;
  try{result=await fetchBarcode(barcode,fetcher);}catch{return {status:'unavailable',barcode,reason:'service'};}
  await db.batch([
    db.prepare('DELETE FROM barcode_cache WHERE expires_at<=?').bind(now),
    db.prepare('INSERT INTO barcode_cache(barcode,payload,expires_at) VALUES(?,?,?) ON CONFLICT(barcode) DO UPDATE SET payload=excluded.payload,expires_at=excluded.expires_at').bind(barcode,JSON.stringify(result),now+(result.status==='found'?604800:3600))
  ]);
  return result;
}
