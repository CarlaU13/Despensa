import http from 'node:http';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import worker from '../src/worker.mjs';
import { database } from './sqlite.mjs';
import { setup } from './setup.mjs';
setup();
const env={LOCAL_DEV:'true',DB:database(process.env.DESPENSA_DB_PATH||'.local/despensa.sqlite')};
for(const line of readFileSync('.dev.vars','utf8').split('\n').filter(Boolean)){const index=line.indexOf('=');env[line.slice(0,index)]=JSON.parse(line.slice(index+1));}
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'};
const publicRoot=path.resolve('public');
env.ASSETS={async fetch(request){
  try{
    const pathname=decodeURIComponent(new URL(request.url).pathname);
    const target=path.resolve(publicRoot,`.${pathname==='/'?'/index.html':pathname}`);
    if(!target.startsWith(publicRoot+path.sep))return new Response('No encontrado',{status:404});
    return new Response(readFileSync(target),{headers:{'Content-Type':types[path.extname(target)]||'application/octet-stream'}});
  }catch{return new Response('No encontrado',{status:404});}
}};
const port=Number(process.env.PORT||8787);
const server=http.createServer(async(req,res)=>{
  try{
    const chunks=[];let size=0;
    for await(const chunk of req){size+=chunk.length;if(size>24576){res.writeHead(413);res.end();return;}chunks.push(chunk);}
    const request=new Request(`http://127.0.0.1:${port}${req.url}`,{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method)?{body:Buffer.concat(chunks)}:{})});
    const response=await worker.fetch(request,env);
    res.writeHead(response.status,Object.fromEntries(response.headers));res.end(req.method==='HEAD'?undefined:Buffer.from(await response.arrayBuffer()));
  }catch{res.writeHead(500);res.end('No se pudo procesar la solicitud.');}
});
server.listen(port,'127.0.0.1',()=>console.log(`Despensa local: http://127.0.0.1:${port}\nCredenciales: ACCESO-LOCAL.txt (solo en este equipo).`));
process.on('SIGINT',()=>server.close(()=>{env.DB.close();process.exit();}));
