import { readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
function walk(dir){return readdirSync(dir,{withFileTypes:true}).filter(e=>e.name!=='vendor').flatMap(e=>e.isDirectory()?walk(`${dir}/${e.name}`):[`${dir}/${e.name}`]);}
for(const file of ['src','scripts','public','test'].flatMap(walk).filter(f=>/\.(mjs|js)$/.test(f))){
  const result=spawnSync(process.execPath,['--check',file],{stdio:'inherit'});if(result.status)process.exit(result.status);
}
for(const file of ['public/index.html','public/app.js','public/styles.css']) if(!readFileSync(file,'utf8').trim())throw Error(`Archivo vacío: ${file}`);
if(readFileSync('src/domain.mjs','utf8')!==readFileSync('public/domain.mjs','utf8'))throw Error('Sincronizá public/domain.mjs con src/domain.mjs.');
console.log('Sintaxis y archivos de la aplicación: correctos.');
