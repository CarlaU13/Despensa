import test from 'node:test';
import assert from 'node:assert/strict';
import {validate,lotAlerts,stocks,localToday} from '../src/domain.mjs';
test('todos los detalles de una compra son opcionales y la cantidad inicial es una unidad',()=>{
 const lot=validate('lot',{product_id:'milk'});
 assert.equal(lot.quantity,1);for(const field of ['location_id','purchase_date','expiry_date','opened_date','frozen_date','review_date','price','notes'])assert.equal(lot[field],null);
 assert.equal(lot.attention,false);
});
test('rechaza cantidades, indicadores y fechas inválidas',()=>{
 for(const quantity of [-1,Infinity,NaN,'2'])assert.throws(()=>validate('lot',{product_id:'milk',quantity}));
 for(const expiry_date of ['2026-02-30','2026-13-01','ayer',123])assert.throws(()=>validate('lot',{product_id:'milk',expiry_date}));
 assert.throws(()=>validate('lot',{product_id:'milk',attention:'false'}));
 assert.throws(()=>validate('shopping',{name:'Pan',quantity:0}));
});
test('conserva cero explícito y admite las unidades de una despensa',()=>{
 assert.equal(validate('product',{name:'Sal',minimum:0,unit:'g'}).minimum,0);
 assert.equal(validate('lot',{product_id:'salt',quantity:0,price:0}).price,0);
 assert.equal(validate('product',{name:'Tomate'}).unit,'unidad');
 assert.equal(validate('product',{name:'Condimento',unit:'frasco'}).unit,'frasco');
});
test('un lote puede tener varios avisos, pero los agotados no producen avisos de revisión',()=>{
 const lot={quantity:1,attention:true,expiry_date:'2026-10-30',purchase_date:'2025-10-30',review_date:'2026-10-31'};
 assert.deepEqual(lotAlerts(lot,'2026-10-31').map(a=>a.type),['attention','expired','old','review']);
 assert.equal(lotAlerts({...lot,quantity:0},'2026-10-31').length,0);
 assert.equal(lotAlerts({quantity:1,purchase_date:'2025-10-31'},'2026-10-31').length,0);
 assert.equal(lotAlerts({quantity:1,expiry_date:'2026-11-07'},'2026-10-31')[0].type,'soon');
});
test('el stock se suma por producto y nunca mezcla unidades de productos diferentes',()=>{
 const result=stocks([{id:'a',minimum:2},{id:'b',minimum:null}],[{product_id:'a',quantity:1.2},{product_id:'a',quantity:.8},{product_id:'b',quantity:250}]);
 assert.equal(result[0].quantity,2);assert.equal(result[0].low,true);assert.equal(result[1].quantity,250);assert.equal(result[1].low,false);
});
test('las fechas de referencia respetan Argentina aun al cambiar el día UTC',()=>{
 assert.equal(localToday(new Date('2026-11-01T01:30:00Z')),'2026-10-31');
});
