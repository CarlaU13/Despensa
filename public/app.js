import { UNITS, lotAlerts, stocks, localToday } from './domain.mjs';
const $ = selector => document.querySelector(selector);
const escape = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const num = value => new Intl.NumberFormat('es-AR',{maximumFractionDigits:3}).format(value ?? 0);
const money = value => new Intl.NumberFormat('es-AR',{maximumFractionDigits:2}).format(value);
const date = value => value ? new Intl.DateTimeFormat('es-AR',{day:'2-digit',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(value+'T12:00:00Z')) : 'Sin fecha';
const paths = {
 home:'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
 inventory:'<path d="M4 7h16v14H4zM3 3h18v4H3zM9 11h6M9 15h6"/>',
 shopping:'<path d="M3 3h2l3 13h10l3-9H6"/><circle cx="9" cy="21" r="1"/><circle cx="18" cy="21" r="1"/>',
 products:'<path d="M20 13l-7 7-10-10V3h7z"/><circle cx="7.5" cy="7.5" r="1"/>',
 locations:'<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1116 0z"/><circle cx="12" cy="10" r="3"/>',
 history:'<path d="M3 11a9 9 0 119 10M3 4v7h7M12 7v6l4 2"/>',
 alert:'<path d="M12 3L2 21h20zM12 9v5M12 17v1"/>'
};
const icon = key => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+(paths[key]||paths.inventory)+'</svg>';
const sections = {
 home:['Resumen','Un vistazo a la despensa','Lo que tenemos, lo que falta y lo que necesita un poco de atención.'],
 inventory:['Inventario','Todo en su lugar','Consultá las existencias y cada compra, sin perder de vista sus fechas.'],
 shopping:['Compras','Lo que hace falta','Una sola lista, compartida con toda la familia.'],
 products:['Productos','Nuestro catálogo','Agregá cada artículo una vez y elegilo al registrar nuevas compras.'],
 locations:['Lugares','Un lugar para cada cosa','Organizá la casa como te resulte más cómodo.'],
 history:['Historial','Los cambios de la casa','Consultá la actividad reciente y deshacé errores sin perder otros cambios.']
};
let state={records:[],history:[]}, current='home', search='', location='', onlyAlerts=false, showEmpty=false, username='', busy=false;
let dialogState=null, toastTimer=null, requestSequence=0;
const records = kind => state.records.filter(r=>r.kind===kind);
const find = id => state.records.find(r=>r.id===id);
const products = () => stocks(records('product'),records('lot'));
const locationName = id => find(id)?.name || 'Sin lugar asignado';
const productName = id => find(id)?.name || 'Producto';
const unitName = product => product?.unit || 'unidad';
const tag = alert => '<span class="badge '+(['expired','attention'].includes(alert.type)?'red':'amber')+'">'+escape(alert.label)+'</span>';
function notify(message,error=false){const toast=$('#toast');toast.textContent=message;toast.classList.toggle('error',error);toast.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>toast.hidden=true,5500);}
function showLogin(){username='';state={records:[],history:[]};$('#app').hidden=true;$('#login').hidden=false;$('#loading').hidden=true;$('#login-form').elements.password.value='';if($('#editor').open)$('#editor').close();}
async function api(path,method='GET',body){
 const response=await fetch(path,{method,credentials:'same-origin',headers:method==='GET'?{}:{'Content-Type':'application/json','X-Despensa':'1'},...(body!==undefined?{body:JSON.stringify(body)}:{})});
 const data=await response.json().catch(()=>({error:'La respuesta del servidor no es válida.'}));
 if(!response.ok){if(response.status===401&&path!=='/api/login')showLogin();const error=new Error(data.error||'No pudimos completar la operación.');error.status=response.status;throw error;}return data;
}
async function refresh(silent=false){
 const sequence=++requestSequence;
 try{const data=await api('/api/state');if(sequence!==requestSequence)return;state=data;$('#sync-status').textContent='Actualizado';render();if(!silent)notify('La despensa está actualizada.');}
 catch(error){$('#sync-status').textContent='Sin actualizar';if(!silent)notify(error.message,true);throw error;}
}
function navigation(){
 $('#navigation').innerHTML=Object.entries(sections).map(([key,values])=>'<button class="nav-item '+(key===current?'active':'')+'" data-page="'+key+'"'+(key===current?' aria-current="page"':'')+'>'+icon(key)+'<span>'+values[0]+'</span>'+(key==='shopping'&&records('shopping').filter(i=>!i.purchased).length?'<span class="nav-count">'+records('shopping').filter(i=>!i.purchased).length+'</span>':'')+'</button>').join('');
}
function render(){
 navigation();
 $('#breadcrumb').textContent='Nuestra casa / '+sections[current][0];
 $('#page-title').textContent=sections[current][1];
 $('#page-description').textContent=sections[current][2];
 $('#page-eyebrow').textContent=current==='home'?'TU CASA, EN ORDEN':'DESPENSA FAMILIAR';
 $('#page').innerHTML=({home:homeView,inventory:inventoryView,shopping:shoppingView,products:productsView,locations:locationsView,history:historyView}[current])();
}
function empty(title,message,action='',label=''){
 return '<div class="empty-state"><div class="empty-icon" aria-hidden="true">'+icon('inventory')+'</div><h3>'+escape(title)+'</h3><p>'+escape(message)+'</p>'+(action?'<button class="button secondary" data-action="'+action+'">'+escape(label)+'</button>':'')+'</div>';
}
function locationCards(full=false){
 return records('location').map(l=>{
 const lots=records('lot').filter(item=>item.location_id===l.id&&item.quantity>0);
 const total=new Set(lots.map(item=>item.product_id)).size;
 return '<article class="location-card"><div class="food-mark">'+icon('locations')+'</div><h3>'+escape(l.name)+'</h3><p>'+total+' producto'+(total===1?'':'s')+' · '+lots.length+' lote'+(lots.length===1?'':'s')+'</p>'+(full&&l.notes?'<p class="notes">'+escape(l.notes)+'</p>':'')+'<div class="actions"><button class="text-button" data-action="view-location" data-id="'+l.id+'">Ver productos ↗</button>'+(full?'<button class="text-button" data-action="edit" data-id="'+l.id+'">Editar</button>':'')+'</div></article>';
 }).join('');
}
function homeView(){
 const ps=products(), lots=records('lot').filter(l=>l.quantity>0), alerts=lots.filter(l=>lotAlerts(l).length), low=ps.filter(p=>p.low), pending=records('shopping').filter(i=>!i.purchased);
 const statsData=[['Productos en casa',ps.filter(p=>p.quantity>0).length,'Artículos con existencias','inventory','inventory'],['Para revisar',alerts.length,'Lotes que necesitan atención','alert','alerts'],['Stock bajo',low.length,'Artículos por reponer','products','low'],['En la lista',pending.length,'Pendientes de compra','shopping','shopping']];
 const recent=alerts.slice().sort((a,b)=>(a.expiry_date||'9999').localeCompare(b.expiry_date||'9999')).slice(0,5);
 return (!ps.length?'<section class="welcome"><div><span class="eyebrow">EMPEZAMOS POR LO SIMPLE</span><h2>Hagamos lugar para tu despensa</h2><p>Creá tus lugares, agregá un producto y registrá lo que ya tenés en casa. No necesitás completar todas las fechas.</p></div><button class="button primary" data-action="new-product">＋ Primer producto</button></section>':'')+
 '<div class="stats">'+statsData.map(([label,count,note,key,destination])=>'<button class="stat '+(key==='alert'?'warn':'')+'" data-action="stat" data-target="'+destination+'"><span class="stat-label">'+label+'</span><span class="stat-icon">'+icon(key)+'</span><strong>'+count+'</strong><small>'+note+'</small></button>').join('')+'</div>'+
 '<div class="dashboard-grid"><section class="panel"><div class="panel-heading"><div><h2>Un poco de atención</h2><p>Para revisar y aprovechar lo que ya tenemos.</p></div><span class="badge amber">'+alerts.length+' lote'+(alerts.length===1?'':'s')+'</span></div><div class="panel-body">'+
 (recent.length?'<div class="attention-list">'+recent.map(l=>'<div class="attention-row"><div class="food-mark">'+icon('inventory')+'</div><div class="row-info"><div class="row-title">'+escape(productName(l.product_id))+'</div><div class="row-meta">'+escape(locationName(l.location_id))+' · '+num(l.quantity)+' '+escape(unitName(find(l.product_id)))+'</div><button class="text-button" data-action="edit" data-id="'+l.id+'">Ver lote ↗</button></div><div class="badges">'+lotAlerts(l).map(tag).join('')+'</div></div>').join('')+'</div><button class="text-button" data-action="stat" data-target="alerts">Ver todos los avisos →</button>':empty('Todo tranquilo por acá','Los lotes marcados, antiguos, por revisar o próximos a vencer aparecerán en este espacio.'))+'</div></section>'+
 '<div><section class="panel"><div class="panel-heading"><h2>La próxima compra</h2><button class="text-button" data-page="shopping">Ver lista ↗</button></div><div class="panel-body">'+
 (pending.length?pending.slice(0,5).map(i=>'<div class="shopping-mini"><button class="check-button" data-action="receive" data-id="'+i.id+'" aria-label="Registrar compra de '+escape(i.name)+'"></button><div class="row-title">'+escape(i.name)+'</div><span class="quantity">'+num(i.quantity)+' '+escape(i.unit)+'</span></div>').join(''):empty('La lista está al día','Agregá lo que falta y todos podrán verlo.'))+
 '<button class="text-button" data-action="new-shopping">＋ Agregar a la lista</button></div></section><aside class="tip-card"><div class="eyebrow">UN HÁBITO QUE SUMA</div><h3>Primero, lo que lleva más tiempo en casa.</h3><p>Registrar la fecha de compra te ayuda a encontrar esos productos que quedaron al fondo.</p></aside></div></div>'+
 '<div class="section-heading"><h2>Los lugares de casa</h2><button class="text-button" data-page="locations">Organizar lugares ↗</button></div>'+
 (records('location').length?'<div class="locations-grid">'+locationCards()+'</div>':'<section class="panel">'+empty('¿Dónde guardamos cada cosa?','Agregá las alacenas, heladeras, fruteros y otros lugares de tu casa.','new-location','＋ Agregar lugar')+'</section>');
}
function normalized(value){return String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();}
function inventoryView(){
 const all=products().filter(p=>normalized(p.name+' '+(p.category||'')).includes(normalized(search)));
 let list=all.map(p=>({...p,lots:records('lot').filter(l=>l.product_id===p.id&&(!location|| (location==='none'?!l.location_id:l.location_id===location))&&(showEmpty||l.quantity>0))})).filter(p=>p.lots.length&&( !onlyAlerts ||p.low||p.lots.some(l=>lotAlerts(l).length)));
 list.sort((a,b)=>a.name.localeCompare(b.name,'es'));
 return '<div class="toolbar"><label class="search-box"><span aria-hidden="true">⌕</span><input id="inventory-search" aria-label="Buscar productos" placeholder="Buscar en la despensa…" value="'+escape(search)+'"></label><select id="location-filter" aria-label="Filtrar por lugar"><option value="">Todos los lugares</option><option value="none"'+(location==='none'?' selected':'')+'>Sin lugar asignado</option>'+records('location').map(l=>'<option value="'+l.id+'"'+(location===l.id?' selected':'')+'>'+escape(l.name)+'</option>').join('')+'</select><button class="filter-button '+(onlyAlerts?'selected':'')+'" data-action="toggle-alerts" aria-pressed="'+onlyAlerts+'">⚑ Necesitan atención</button><button class="filter-button '+(showEmpty?'selected':'')+'" data-action="toggle-empty" aria-pressed="'+showEmpty+'">Incluir agotados</button></div>'+
 '<div class="results-meta"><span>'+list.length+' producto'+(list.length===1?'':'s')+(location?' en este lugar':'')+'</span><span>Ordenados por nombre</span></div>'+
 (list.length?'<div class="inventory-list">'+list.map(p=>'<details class="product-card"'+(search||onlyAlerts?' open':'')+'><summary class="product-summary"><div class="food-mark">'+icon('inventory')+'</div><div class="product-info"><div class="product-name">'+escape(p.name)+'</div><div class="row-meta">'+escape(p.category||'Sin categoría')+' · '+p.lots.length+' lote'+(p.lots.length===1?'':'s')+(p.low?' · <span class="badge amber">Stock bajo</span>':'')+'</div></div><div class="stock-total">'+num(p.lots.reduce((s,l)=>s+l.quantity,0))+' <small>'+escape(p.unit)+'</small></div><span class="disclosure" aria-hidden="true">⌄</span></summary><div class="product-lots">'+p.lots.slice().sort((a,b)=>(a.expiry_date||'9999').localeCompare(b.expiry_date||'9999')||(a.purchase_date||'9999').localeCompare(b.purchase_date||'9999')).map(l=>lotRow(l,p)).join('')+'<button class="text-button" data-action="new-lot" data-id="'+p.id+'">＋ Agregar otra compra de este producto</button></div></details>').join('')+'</div>':
 '<section class="panel">'+empty(search||location||onlyAlerts?'No encontramos productos con estos filtros':'Todavía no hay compras registradas',search||location||onlyAlerts?'Probá con otro nombre, lugar o filtro.':'Empezá con algo que ya tengas en casa.','new-lot','＋ Registrar compra')+'</section>');
}
function lotRow(l,p){
 const alerts=lotAlerts(l);
 return '<div class="lot-row '+(l.quantity===0?'zero':'')+'"><div><div class="lot-head">'+escape(locationName(l.location_id))+'</div><p>'+num(l.quantity)+' '+escape(p.unit)+(l.quantity===0?' · Agotado':'')+'</p><p>Compra: '+date(l.purchase_date)+'</p>'+(l.notes?'<div class="notes">'+escape(l.notes)+'</div>':'')+'</div><div>'+
 (l.expiry_date?'<p>Vence: '+date(l.expiry_date)+'</p>':'<p>Sin vencimiento registrado</p>')+(l.opened_date?'<p>Abierto: '+date(l.opened_date)+'</p>':'')+(l.frozen_date?'<p>Congelado: '+date(l.frozen_date)+'</p>':'')+(l.review_date?'<p>Revisar: '+date(l.review_date)+'</p>':'')+(l.price!=null?'<p>Precio de compra: '+money(l.price)+'</p>':'')+'<div class="badges">'+alerts.map(tag).join('')+'</div></div><div class="actions">'+(l.quantity>0?'<button class="button small-button" data-action="consume" data-id="'+l.id+'">Consumir</button><button class="button small-button" data-action="move" data-id="'+l.id+'">Mover</button>':'')+'<button class="button small-button" data-action="edit" data-id="'+l.id+'">Editar</button></div></div>';
}
function productsView(){
 const ps=products().sort((a,b)=>a.name.localeCompare(b.name,'es'));
 return '<div class="toolbar"><button class="button secondary" data-action="new-product">＋ Nuevo producto</button><span class="muted field-help">Cada producto tiene una unidad. Sus compras comparten esa unidad.</span></div>'+
 (ps.length?'<div class="table-wrap"><table><thead><tr><th>PRODUCTO</th><th>EN CASA</th><th>MÍNIMO</th><th></th></tr></thead><tbody>'+ps.map(p=>'<tr><td><strong>'+escape(p.name)+'</strong><div class="row-meta">'+escape(p.category||'Sin categoría')+'</div></td><td>'+num(p.quantity)+' '+escape(p.unit)+(p.low?' <span class="badge amber">Reponer</span>':'')+'</td><td>'+(p.minimum==null?'Sin definir':num(p.minimum)+' '+escape(p.unit))+'</td><td><div class="actions"><button class="text-button" data-action="edit" data-id="'+p.id+'">Editar</button><button class="text-button" data-action="add-product-shopping" data-id="'+p.id+'">A la lista</button></div></td></tr>').join('')+'</tbody></table></div>':'<section class="panel">'+empty('El catálogo empieza con un producto','Puede ser un tomate, una especia, leche o lo que guardes en casa.','new-product','＋ Agregar producto')+'</section>');
}
function shoppingView(){
 const items=records('shopping'), pending=items.filter(i=>!i.purchased), done=items.filter(i=>i.purchased);
 const suggestions=products().filter(p=>p.low&&!pending.some(i=>i.product_id===p.id));
 const row=i=>'<div class="shopping-row '+(i.purchased?'done':'')+'"><button class="check-button" data-action="'+(i.purchased?'reopen-shopping':'receive')+'" data-id="'+i.id+'" aria-label="'+(i.purchased?'Volver a pendientes: ':'Registrar compra de ')+escape(i.name)+'">'+(i.purchased?'✓':'')+'</button><div class="row-info"><div class="row-title">'+escape(i.name)+'</div>'+(i.notes?'<div class="row-meta">'+escape(i.notes)+'</div>':'')+'</div><span class="quantity">'+num(i.quantity)+' '+escape(i.unit)+'</span><div class="actions">'+(!i.purchased?'<button class="text-button" data-action="receive" data-id="'+i.id+'">Comprado →</button>':'')+'<button class="text-button" data-action="edit" data-id="'+i.id+'">Editar</button></div></div>';
 return '<div class="toolbar"><button class="button secondary" data-action="new-shopping">＋ Agregar a la lista</button><button class="button" data-action="copy-list">Copiar lista</button></div>'+
 (suggestions.length?'<div class="section-heading"><h2>Quizás haga falta reponer</h2><span class="badge amber">'+suggestions.length+' con poco stock</span></div>'+suggestions.map(p=>'<div class="suggestion"><span class="food-mark">'+icon('products')+'</span><div class="row-info"><div class="row-title">'+escape(p.name)+'</div><div class="row-meta">Quedan '+num(p.quantity)+' '+escape(p.unit)+' · Mínimo: '+num(p.minimum)+'</div></div><button class="button small-button" data-action="add-product-shopping" data-id="'+p.id+'">＋ A la lista</button></div>').join(''):'')+
 '<div class="section-heading"><h2>Por comprar</h2><span class="muted field-help">'+pending.length+' pendientes</span></div>'+
 (pending.length?'<div class="shopping-list">'+pending.map(row).join('')+'</div>':'<section class="panel">'+empty('Por ahora, no falta nada','Anotá lo que necesiten. La familia verá la misma lista.','new-shopping','＋ Agregar algo')+'</section>')+
 (done.length?'<div class="section-heading"><h2>Comprado</h2><span class="muted field-help">Ya ingresado al inventario</span></div><div class="shopping-list">'+done.map(row).join('')+'</div>':'');
}
function locationsView(){
 return '<div class="toolbar"><button class="button secondary" data-action="new-location">＋ Nuevo lugar</button>'+(!records('location').length?'<button class="button" data-action="suggest-locations">Usar lugares sugeridos</button>':'')+'</div>'+
 (records('location').length?'<div class="locations-grid">'+locationCards(true)+'</div>':'<section class="panel">'+empty('La casa se organiza a tu manera','Podés crear alacenas, fruteros, heladeras y freezers con los nombres que uses en casa.','new-location','＋ Crear lugar')+'</section>')+
 '<p class="muted field-help">Los productos pueden repartirse entre distintos lugares. Las compras sin ubicación aparecen como “Sin lugar asignado”.</p>';
}
function historyView(){
 const seen=new Set();const rows=state.history.filter(h=>{if(seen.has(h.group_id))return false;seen.add(h.group_id);return true;});
 return '<p class="muted field-help">Mostramos los últimos 100 movimientos. Una compra y su ingreso al inventario se deshacen juntos. Al usar la misma cuenta, los cambios no se atribuyen a personas.</p>'+
 (rows.length?'<div class="history-list">'+rows.map(h=>'<div class="history-row '+(h.undone?'undone':'')+'"><span class="history-dot"></span><div class="row-info"><div class="row-title">'+escape(h.label)+'</div><div class="row-meta">'+escape(new Intl.DateTimeFormat('es-AR',{dateStyle:'medium',timeStyle:'short',timeZone:'America/Argentina/Buenos_Aires'}).format(new Date(h.created_at)))+(h.undone?' · Deshecho':'')+'</div></div>'+(!h.undone&&h.action!=='undo'?'<button class="button small-button" data-action="undo" data-id="'+h.id+'">Deshacer</button>':'')+'</div>').join('')+'</div>':'<section class="panel">'+empty('Todavía no hay movimientos','Tus compras, consumos, cambios y eliminaciones aparecerán acá.')+'</section>');
}
function options(items,value,emptyLabel='Elegí una opción'){
 return '<option value="">'+emptyLabel+'</option>'+items.map(i=>'<option value="'+escape(i.id)+'"'+(i.id===value?' selected':'')+'>'+escape(i.name)+'</option>').join('');
}
function unitOptions(value='unidad'){return UNITS.map(u=>'<option'+(u===value?' selected':'')+'>'+escape(u)+'</option>').join('');}
function input(name,label,value='',type='text',extra=''){
 return '<label>'+label+'<input name="'+name+'" type="'+type+'" value="'+escape(value)+'" '+extra+'></label>';
}
function notes(value){return '<label class="full">Notas <span class="field-help">Opcional</span><textarea name="notes" maxlength="2000" placeholder="Lo que quieras recordar…">'+escape(value)+'</textarea></label>';}
function footer(edit=false,label='Guardar'){return '<p id="dialog-error" class="form-error" role="alert" hidden></p><div class="form-actions">'+(edit?'<button type="button" class="button danger" data-action="delete-record">Eliminar</button>':'')+'<button type="button" class="button" data-action="close-dialog">Cancelar</button><button type="submit" class="button primary">'+label+'</button></div>';}
function openDialog(mode,item={},extra={}){
 if(busy)return;
 dialogState={mode,item:{...item},...extra};
 const titles={location:'Lugar de guardado',product:'Producto',lot:item.id?'Editar compra / lote':'Registrar una compra',shopping:'En la lista de compras',consume:'Registrar consumo',move:'Mover de lugar',receive:'Comprado, a la despensa',account:'La cuenta familiar'};
 const hints={location:'Poné el nombre que usan en casa.',product:'Solo el nombre es obligatorio. La unidad inicial es unidad.',lot:'Cantidad inicial: 1. Todos los detalles adicionales son opcionales.',shopping:'Podés elegir un producto o escribir algo nuevo.',consume:'Se descontará únicamente de este lote.',move:'Mové todo el lote o solo una parte.',receive:'Confirmá los datos para ingresarlo al inventario.',account:'Un acceso compartido por toda la familia.'};
 let body='';
 if(mode==='location')body='<div class="form-grid">'+input('name','Nombre',item.name,'text','required maxlength="100" placeholder="Ej.: Heladera 1"')+'<div></div>'+notes(item.notes)+'</div>';
 if(mode==='product')body='<div class="form-grid">'+input('name','Nombre',item.name,'text','required maxlength="140" placeholder="Ej.: Leche"')+input('category','Categoría (opcional)',item.category,'text','maxlength="80" placeholder="Ej.: Lácteos"')+'<label>Unidad<select name="unit">'+unitOptions(item.unit)+'</select><span class="field-help">Cada compra se mide en esta unidad.</span></label>'+input('minimum','Avisar con este stock o menos (opcional)',item.minimum,'number','min="0" max="1000000000" step="0.001"')+notes(item.notes)+'</div>';
 if(['lot','receive'].includes(mode)){
 const productId=item.product_id||extra.productId||'';
 body='<div class="form-grid"><label class="full">Producto<select name="product_id" required>'+options(records('product'),productId,'Elegí un producto')+'</select><button type="button" class="text-button" data-action="create-product-in-dialog">＋ Crear un producto nuevo</button></label>'+input('quantity','Cantidad',item.quantity??1,'number','min="'+(item.id?0:0.001)+'" max="1000000000" step="0.001" required')+'<label>Lugar (opcional)<select name="location_id">'+options(records('location'),item.location_id,'Sin lugar asignado')+'</select></label></div><p id="lot-unit" class="field-help">Unidad: '+escape(unitName(find(productId)))+'</p><details class="optional-fields"'+(item.id?' open':'')+'><summary>Fechas, precio y otros detalles · Opcionales</summary><div class="form-grid">'+
 input('purchase_date','Fecha de compra',item.purchase_date||'','date')+input('expiry_date','Vencimiento',item.expiry_date||'','date')+input('opened_date','Fecha de apertura',item.opened_date||'','date')+input('frozen_date','Fecha de congelación',item.frozen_date||'','date')+input('review_date','Volver a revisar el',item.review_date||'','date')+input('price','Precio pagado (opcional)',item.price,'number','min="0" max="1000000000" step="0.01"')+notes(item.notes)+'<label class="checkbox-label full"><input type="checkbox" name="attention"'+(item.attention?' checked':'')+'> Marcar para revisar el estado</label></div></details>';
 }
 if(mode==='shopping')body='<div class="form-grid"><label class="full">Producto del catálogo (opcional)<select name="product_id">'+options(records('product'),item.product_id,'Escribir un artículo nuevo')+'</select></label>'+input('name','Qué hace falta',item.name,'text','required maxlength="140" placeholder="Ej.: Tomates"')+input('quantity','Cantidad',item.quantity??1,'number','required min="0.001" max="1000000000" step="0.001"')+'<label>Unidad<select name="unit">'+unitOptions(item.unit)+'</select></label><div></div>'+notes(item.notes)+'</div>';
 if(mode==='consume')body='<div class="dialog-info">'+escape(productName(item.product_id))+' · '+escape(locationName(item.location_id))+'<br>Disponible: '+num(item.quantity)+' '+escape(unitName(find(item.product_id)))+'</div>'+input('amount','Cantidad consumida',Math.min(1,item.quantity),'number','required min="0.001" max="'+item.quantity+'" step="0.001"');
 if(mode==='move')body='<div class="dialog-info">'+escape(productName(item.product_id))+'<br>Desde '+escape(locationName(item.location_id))+' · '+num(item.quantity)+' '+escape(unitName(find(item.product_id)))+'</div><div class="form-grid">'+input('amount','Cantidad a mover',item.quantity,'number','required min="0.001" max="'+item.quantity+'" step="0.001"')+'<label>Nuevo lugar<select name="location_id">'+options(records('location').filter(l=>l.id!==item.location_id),'','Sin lugar asignado')+'</select></label></div>';
 if(mode==='account')body='<div class="dialog-info">Usuario: <strong>'+escape(username)+'</strong><br>Todos ven y modifican la misma despensa. Si necesitás retirar el acceso de un dispositivo, cerrá todas las sesiones.</div><div class="actions"><button class="button" type="button" data-action="export">Descargar mis datos</button><button class="button" type="button" data-action="logout">Salir de este dispositivo</button><button class="button danger" type="button" data-action="logout-all">Cerrar todas las sesiones</button></div>';
 $('#dialog-content').innerHTML='<div class="dialog-header"><div><h2 id="dialog-title">'+escape(titles[mode])+'</h2><p class="muted">'+escape(hints[mode])+'</p></div><button type="button" class="icon-button" data-action="close-dialog" aria-label="Cerrar">×</button></div>'+(mode==='account'?body:'<form id="editor-form">'+body+footer(!!item.id&&!['receive','consume','move'].includes(mode),mode==='receive'?'Guardar en despensa':mode==='consume'?'Descontar':mode==='move'?'Mover':'Guardar')+'</form>');
 if(!$('#editor').open)$('#editor').showModal();
 $('#editor-form')?.addEventListener('submit',saveForm);
 if(mode==='lot'||mode==='receive')$('#editor-form').elements.product_id.addEventListener('change',e=>$('#lot-unit').textContent='Unidad: '+unitName(find(e.target.value)));
 if(mode==='shopping')$('#editor-form').elements.product_id.addEventListener('change',e=>{const p=find(e.target.value);if(p){$('#editor-form').elements.name.value=p.name;$('#editor-form').elements.unit.value=p.unit;}});
}
function formData(form){
 const data=Object.fromEntries(new FormData(form));
 for(const key of ['quantity','minimum','price','amount'])if(key in data)data[key]=data[key]===''?null:Number(data[key]);
 if(['lot','receive'].includes(dialogState.mode))data.attention=form.elements.attention.checked;
 return data;
}
async function saveForm(event){
 event.preventDefault();if(busy)return;busy=true;
 const form=event.target, data=formData(form), context=dialogState;
 const buttons=[...$('#editor').querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);$('#dialog-error').hidden=true;
 try{
 const {mode,item}=context;
 if(mode==='consume'){
 const quantity=Math.round((item.quantity-data.amount)*1000)/1000;
 if(quantity<0||!data.amount)throw Error('La cantidad supera lo disponible.');
 await api('/api/lot/'+item.id,'PUT',{version:item.version,data:{...item,quantity},action:'consume'});
 }else if(mode==='move')await api('/api/move','POST',{id:item.id,version:item.version,amount:data.amount,location_id:data.location_id||null});
 else if(mode==='receive')await api('/api/receive','POST',{shopping_id:context.shopping.id,version:context.shopping.version,lot:data});
 else {
 if(mode==='shopping'){data.purchased=!!item.purchased;const p=find(data.product_id);if(p)data.unit=p.unit;}
 await api('/api/'+mode+(item.id?'/'+item.id:''),item.id?'PUT':'POST',item.id?{version:item.version,data}:data);
 }
 $('#editor').close();notify(mode==='receive'?'Compra ingresada al inventario.':'Cambio guardado.');await refresh(true);
 if(context.returnTo){
 const created=records('product').find(p=>p.id===context.createdId)||records('product').slice().reverse().find(p=>p.name===data.name);
 busy=false;openDialog(context.returnTo.mode,{...context.returnTo.item,product_id:created?.id||''},context.returnTo.extra);
 }
 }catch(error){if($('#dialog-error')){$('#dialog-error').textContent=error.message;$('#dialog-error').hidden=false;}else notify(error.message,true);if(error.status===409)refresh(true).catch(()=>{});}
 finally{busy=false;buttons.forEach(b=>b.disabled=false);}
}
async function perform(action,id,button){
 if(busy&&!['close-dialog'].includes(action))return;
 const item=id?find(id):null;
 if(action==='close-dialog'){if(!busy)$('#editor').close();return;}
 if(action==='new-location'){openDialog('location');return;}
 if(action==='new-product'){openDialog('product');return;}
 if(action==='new-lot'){if(!records('product').length)openDialog('product',{}, {returnTo:{mode:'lot',item:{},extra:{}}});else openDialog('lot',{}, {productId:id});return;}
 if(action==='new-shopping'){openDialog('shopping');return;}
 if(action==='edit'&&item){openDialog(item.kind,item);return;}
 if(action==='consume'&&item){openDialog('consume',item);return;}
 if(action==='move'&&item){openDialog('move',item);return;}
 if(action==='account'){openDialog('account');return;}
 if(action==='receive'&&item){
 const lot={product_id:item.product_id||'',quantity:item.quantity,purchase_date:localToday()};
 if(!records('product').length)openDialog('product',{name:item.name,unit:item.unit}, {returnTo:{mode:'receive',item:lot,extra:{shopping:item}}});
 else openDialog('receive',lot,{shopping:item});return;
 }
 if(action==='create-product-in-dialog'){
 const context=dialogState;
 const draft=formData($('#editor-form'));
 openDialog('product',{}, {returnTo:{mode:context.mode,item:draft,extra:{shopping:context.shopping,productId:context.productId}}});return;
 }
 if(action==='toggle-alerts'){onlyAlerts=!onlyAlerts;render();return;}
 if(action==='toggle-empty'){showEmpty=!showEmpty;render();return;}
 if(action==='stat'){
 const target=button.dataset.target;
 current=['alerts','low'].includes(target)?'inventory':target;
 onlyAlerts=['alerts','low'].includes(target);search='';location='';render();return;
 }
 if(action==='view-location'){current='inventory';location=id;search='';onlyAlerts=false;render();return;}
 if(action==='export'){window.location.assign('/api/export');return;}
 if(action==='copy-list'){
 const text=records('shopping').filter(i=>!i.purchased).map(i=>'☐ '+i.name+' · '+num(i.quantity)+' '+i.unit+(i.notes?' ('+i.notes+')':'')).join('\n');
 if(!text){notify('La lista está vacía.');return;}
 try{await navigator.clipboard.writeText(text);notify('Lista copiada.');}catch{notify('El navegador no permitió copiar. Podés descargar los datos desde el pie de página.',true);}return;
 }
 if(action==='delete-record'){
 if(!dialogState.item.id)return;
 if(!confirm('¿Eliminar este registro? Podrás intentar deshacerlo desde el historial.'))return;
 const record=dialogState.item;await api('/api/'+record.kind+'/'+record.id,'DELETE',{version:record.version});$('#editor').close();await refresh(true);notify('Registro eliminado.');return;
 }
 if(action==='logout-all'&&!confirm('¿Cerrar las sesiones de todos los dispositivos de la familia?'))return;
 busy=true;if(button)button.disabled=true;
 try{
 if(action==='refresh')await refresh();
 if(action==='logout'||action==='logout-all'){await api(action==='logout'?'/api/logout':'/api/logout-all','POST',{});showLogin();notify('Sesión cerrada.');}
 if(action==='undo'){await api('/api/undo/'+id,'POST',{});await refresh(true);notify('Cambio deshecho.');}
 if(action==='reopen-shopping'&&item){await api('/api/shopping/'+id,'PUT',{version:item.version,data:{...item,purchased:false}});await refresh(true);notify('Vuelve a estar pendiente. El inventario no cambió.');}
 if(action==='add-product-shopping'&&item){
 if(records('shopping').some(s=>!s.purchased&&s.product_id===id)){notify('Este producto ya está en la lista.');return;}
 await api('/api/shopping','POST',{product_id:id,name:item.name,unit:item.unit,quantity:Math.max(1,Math.round(((item.minimum||1)-(item.quantity||0))*1000)/1000)});await refresh(true);notify('Agregado a la lista.');}
 if(action==='suggest-locations'){
 for(const name of ['Alacena cocina izquierda','Alacena cocina derecha','Frutero','Almacén de apoyo','Heladera 1','Freezer 1'])if(!records('location').some(l=>l.name===name))await api('/api/location','POST',{name});
 await refresh(true);notify('Lugares agregados. Podés cambiar sus nombres.');}
 }finally{busy=false;if(button)button.disabled=false;}
}
document.addEventListener('click',event=>{
 const pageButton=event.target.closest('[data-page]');
 if(pageButton){if(busy)return;current=pageButton.dataset.page;search='';location='';onlyAlerts=false;render();$('#main').focus();return;}
 const button=event.target.closest('[data-action]');
 if(button)perform(button.dataset.action,button.dataset.id,button).catch(error=>notify(error.message,true));
});
document.addEventListener('input',event=>{
 if(event.target.id==='inventory-search'){
 search=event.target.value;const pos=event.target.selectionStart;$('#page').innerHTML=inventoryView();$('#inventory-search').focus();$('#inventory-search').setSelectionRange(pos,pos);
 }
});
document.addEventListener('change',event=>{if(event.target.id==='location-filter'){location=event.target.value;render();}});
$('#editor').addEventListener('cancel',event=>{if(busy)event.preventDefault();});
$('#show-password').addEventListener('click',()=>{const input=$('#login-form').elements.password;input.type=input.type==='password'?'text':'password';$('#show-password').textContent=input.type==='password'?'Mostrar':'Ocultar';});
$('#login-form').addEventListener('submit',async event=>{
 event.preventDefault();if(busy)return;busy=true;const form=event.target,button=form.querySelector('[type=submit]');button.disabled=true;$('#login-error').hidden=true;
 try{const credentials=Object.fromEntries(new FormData(form));await api('/api/login','POST',credentials);username=credentials.username;form.elements.password.value='';await refresh(true);$('#login').hidden=true;$('#app').hidden=false;}
 catch(error){$('#login-error').textContent=error.message;$('#login-error').hidden=false;}
 finally{busy=false;button.disabled=false;}
});
async function start(){
 try{const user=await api('/api/session');username=user.username;await refresh(true);$('#login').hidden=true;$('#app').hidden=false;$('#loading').hidden=true;}
 catch(error){showLogin();if(error.status!==401){$('#login-error').textContent=error.message;$('#login-error').hidden=false;}}
}
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&username&&!$('#editor').open&&!busy)refresh(true).catch(()=>{});});
setInterval(()=>{if(!document.hidden&&username&&!$('#editor').open&&!busy)refresh(true).catch(()=>{});},60000);
start();
