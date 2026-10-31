import { spawnSync } from 'node:child_process';
import { readFileSync,writeFileSync,existsSync } from 'node:fs';
import { setup } from './setup.mjs';
const wrangler='node_modules/wrangler/bin/wrangler.js';
if(!existsSync(wrangler))throw Error('Instalá Wrangler primero: npm install --save-dev wrangler');
function run(args,options={}){
  const result=spawnSync(process.execPath,[wrangler,...args],{encoding:'utf8',...options});
  if(result.status!==0){if(result.stdout)process.stderr.write(result.stdout);if(result.stderr)process.stderr.write(result.stderr);throw Error(`Falló Wrangler: ${args.join(' ')}`);}
  return result.stdout;
}
setup();
run(['whoami'],{stdio:'inherit'});
const config=JSON.parse(readFileSync('wrangler.jsonc','utf8'));
if(config.d1_databases[0].database_id.startsWith('00000000')){
  const list=JSON.parse(run(['d1','list','--json']));
  const found=list.find(d=>d.name===config.d1_databases[0].database_name);
  let id=found?.uuid;
  if(!id){
    const output=run(['d1','create',config.d1_databases[0].database_name]);
    id=output.match(/database_id["\s:=]+([a-f0-9-]{36})/i)?.[1];
    if(!id)throw Error('No se pudo leer el ID de D1. Configurá database_id en wrangler.jsonc y repetí el despliegue.');
  }
  config.d1_databases[0].database_id=id;
  writeFileSync('wrangler.jsonc',JSON.stringify(config,null,2)+'\n');
}
run(['d1','migrations','apply','DB','--remote'],{stdio:'inherit'});
// Wrangler receives secret values through stdin only, never command arguments.
const secrets={};
for(const line of readFileSync('.dev.vars','utf8').split('\n').filter(Boolean)){const i=line.indexOf('=');secrets[line.slice(0,i)]=JSON.parse(line.slice(i+1));}
if(!secrets.AUTH_USERNAME||!/^[a-f0-9]{64}$/.test(secrets.AUTH_PASSWORD_SHA256||''))throw Error('Configuración de acceso inválida.');
run(['secret','bulk'],{input:JSON.stringify(secrets)});
run(['deploy'],{stdio:'inherit'});
console.log('Desplegado. Compartí con tu familia la URL que muestra Wrangler y el acceso guardado en ACCESO-LOCAL.txt.');
