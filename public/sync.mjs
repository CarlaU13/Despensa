// Load bounded pages once, then fetch only records changed since the last sync.
export async function syncRecords(api, previous=new Map(), cursor=null, progress=()=>{}, attempt=0) {
  if(attempt>2) throw new Error('Los datos cambiaron durante la carga. Volvé a actualizar.');
  const map=cursor===null?new Map():new Map(previous);
  let history,serverTime;
  async function pages(mode,start=0) {
    let next=start, upper,until;
    const seen=new Set();
    do {
      const params=new URLSearchParams({limit:'500',[mode==='changes'?'since':'after']:String(next)});
      if(upper!==undefined)params.set('upper',String(upper));
      if(until!==undefined)params.set('until',String(until));
      const page=await api('/api/state?'+params);
      if(page.reset)return null;
      if(page.history)history=page.history;
      serverTime=page.server_time;
      if(until===undefined)until=page.change_cursor;
      if(upper===undefined)upper=page.upper_rowid;
      for(const record of page.records) {
        const existing=map.get(record.id);
        if(existing&&existing.version>record.version)continue;
        if(record.deleted)map.delete(record.id);else map.set(record.id,record);
      }
      await progress(map.size,page.total_active);
      const after=page.next_cursor;
      if(after!==null && (!Number.isSafeInteger(after)||after<=next||seen.has(after)))throw new Error('La página de datos no avanzó correctamente.');
      next=after;
      seen.add(next);
    }while(next!==null);
    return until;
  }
  if(cursor===null) {
    const initial=await pages('snapshot');
    if(initial===null)return syncRecords(api,new Map(),null,progress,attempt+1);
    cursor=initial;
  }
  const updated=await pages('changes',cursor);
  if(updated===null)return syncRecords(api,new Map(),null,progress,attempt+1);
  return {map,cursor:updated,history,server_time:serverTime};
}
export function groupRecords(records) {
  const byId=new Map(),byKind=new Map(),lotsByProduct=new Map(),locationStats=new Map();
  for(const record of records) {
    byId.set(record.id,record);
    if(!byKind.has(record.kind))byKind.set(record.kind,[]);
    byKind.get(record.kind).push(record);
    if(record.kind==='lot') {
      if(!lotsByProduct.has(record.product_id))lotsByProduct.set(record.product_id,[]);
      lotsByProduct.get(record.product_id).push(record);
      if(record.quantity>0) {
        const key=record.location_id||'';
        if(!locationStats.has(key))locationStats.set(key,{lots:0,products:new Set()});
        const stat=locationStats.get(key);stat.lots++;stat.products.add(record.product_id);
      }
    }
  }
  return {byId,byKind,lotsByProduct,locationStats};
}
