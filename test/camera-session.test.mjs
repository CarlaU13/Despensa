import test from 'node:test';
import assert from 'node:assert/strict';
import {startVideoScan} from '../src/camera-session.mjs';
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(){
 let stops=0,next=0;const pending=new Map(),codes=[],hints=[];
 const track={stop(){stops++;}},stream={getTracks:()=>[track],getVideoTracks:()=>[track]};
 const video={srcObject:null,play:async()=>{}};
 const options={getStream:async()=>stream,decode:async()=>null,onCode:code=>codes.push(code),onHint:message=>hints.push(message),schedule:fn=>{pending.set(++next,fn);return next;},cancel:id=>pending.delete(id)};
 async function step(){const entry=pending.entries().next().value;assert.ok(entry,'Debe continuar buscando');pending.delete(entry[0]);await entry[1]();await settle();}
 return {video,options,stream,codes,hints,pending,step,get stops(){return stops;}};
}
test('el video sigue leyendo después de cuadros vacíos y entrega una sola detección',async()=>{
 const f=fixture();let attempts=0;f.options.decode=async()=>++attempts===3?'03017620422003':null;
 const control=await startVideoScan(f.video,f.options);await settle();await f.step();await f.step();
 assert.equal(attempts,3);assert.deepEqual(f.codes,['03017620422003']);assert.equal(f.stops,1);assert.equal(f.video.srcObject,null);assert.equal(f.pending.size,0);control.stop();assert.equal(f.stops,1);
});
test('cerrar durante el permiso libera el stream cuando llega',async()=>{
 const f=fixture();let active=true,resolve;f.options.isActive=()=>active;f.options.getStream=()=>new Promise(r=>resolve=r);
 const started=startVideoScan(f.video,f.options);active=false;resolve(f.stream);await started;
 assert.equal(f.stops,1);assert.equal(f.video.srcObject,null);assert.equal(f.pending.size,0);
});
test('un resultado atrasado no se aplica después de detener la cámara',async()=>{
 const f=fixture();let resolve;f.options.decode=()=>new Promise(r=>resolve=r);
 const control=await startVideoScan(f.video,f.options);await settle();control.stop();resolve('03017620422003');await settle();
 assert.equal(f.codes.length,0);assert.equal(f.stops,1);assert.equal(f.pending.size,0);
});
test('ocultar el escáner detiene el stream y no programa más cuadros',async()=>{
 const f=fixture();let active=true;f.options.isActive=()=>active;
 await startVideoScan(f.video,f.options);await settle();active=false;await f.step();assert.equal(f.stops,1);assert.equal(f.pending.size,0);
});
test('si el video no puede reproducirse se libera la cámara',async()=>{
 const f=fixture();f.video.play=async()=>{throw Error('No disponible');};await assert.rejects(startVideoScan(f.video,f.options));assert.equal(f.stops,1);assert.equal(f.video.srcObject,null);
});
test('un error fatal se muestra y detiene la cámara',async()=>{
 const f=fixture();f.options.decode=async()=>{throw Error('Fallo');};await startVideoScan(f.video,f.options);await settle();
 assert.equal(f.stops,1);assert.equal(f.hints.length,1);assert.match(f.hints[0],/interrumpió/);assert.equal(f.pending.size,0);
});
test('una lectura lenta muestra ayuda una vez y continúa buscando',async()=>{
 const f=fixture();let time=0;f.options.now=()=>time;const control=await startVideoScan(f.video,f.options);await settle();time=9000;await f.step();await f.step();
 assert.equal(f.hints.length,1);assert.match(f.hints[0],/sigue activa/);assert.equal(f.stops,0);control.stop();
});
