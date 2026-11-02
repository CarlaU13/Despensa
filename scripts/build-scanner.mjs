import {build} from 'esbuild';
import {mkdirSync,copyFileSync} from 'node:fs';
mkdirSync('public/vendor',{recursive:true});
await build({entryPoints:['src/scanner-entry.mjs'],outfile:'public/vendor/scanner.js',bundle:true,minify:true,format:'esm',platform:'browser',target:['es2020'],legalComments:'eof'});
copyFileSync('node_modules/@zxing/browser/LICENSE','public/vendor/ZXING-BROWSER-LICENSE.txt');
copyFileSync('node_modules/@zxing/library/LICENSE','public/vendor/ZXING-LIBRARY-LICENSE.txt');
console.log('Lector empaquetado para servirse desde el propio sitio.');
