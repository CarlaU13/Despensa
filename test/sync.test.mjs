import test from 'node:test';
import assert from 'node:assert/strict';
import {syncRecords,groupRecords} from '../public/sync.mjs';
test('incorpora cambios producidos mientras se descargan las páginas iniciales',async()=>{
 const requests=[];
 const pages=[
 {records:[{id:'a',kind:'product',version:1,name:'Antes',deleted:false}],history:[],next_cursor:1,change_cursor:1,upper_rowid:2,total_active:2},
 {records:[{id:'b',kind:'product',version:1,name:'Otro',deleted:false}],next_cursor:null,change_cursor:1,upper_rowid:2,total_active:2},
 {records:[{id:'a',kind:'product',version:2,name:'Después',deleted:false},{id:'b',kind:'product',version:2,deleted:true}],next_cursor:null,change_cursor:3,upper_rowid:2,total_active:1}
 ];
 const result=await syncRecords(async path=>{requests.push(path);return pages.shift();});
 assert.equal(result.map.size,1);assert.equal(result.map.get('a').name,'Después');assert.equal(result.cursor,3);
 assert.ok(requests[1].includes('until=1'));assert.ok(requests[2].includes('since=1'));
});
test('recupera un cursor invalidado por una restauración de la base',async()=>{
 const pages=[
 {reset:true,records:[],next_cursor:null},
 {records:[{id:'new',kind:'location',version:1}],history:[],next_cursor:null,change_cursor:1,upper_rowid:1,total_active:1},
 {records:[],next_cursor:null,change_cursor:1,upper_rowid:1,total_active:1}
 ];
 const result=await syncRecords(async()=>pages.shift(),new Map([['old',{id:'old',version:4}]]),10);
 assert.equal(result.map.size,1);assert.ok(result.map.has('new'));assert.ok(!result.map.has('old'));
});
test('los índices agrupan miles de lotes sin recorrer todo por cada producto',()=>{
 const rows=[];
 for(let i=0;i<10000;i++)rows.push({id:'lot-'+i,kind:'lot',product_id:'p-'+(i%100),location_id:'shelf',quantity:1});
 const grouped=groupRecords(rows);
 assert.equal(grouped.lotsByProduct.get('p-0').length,100);
 assert.equal(grouped.locationStats.get('shelf').lots,10000);
 assert.equal(grouped.locationStats.get('shelf').products.size,100);
});
