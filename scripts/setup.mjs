import { randomBytes, createHash } from 'node:crypto';
import { writeFileSync, existsSync } from 'node:fs';
export function setup(rotate=false) {
  if(existsSync('.dev.vars')&&!rotate) return;
  const password=randomBytes(32).toString('base64url');
  const username='familia';
  const hash=createHash('sha256').update(password).digest('hex');
  writeFileSync('.dev.vars',`AUTH_USERNAME=${JSON.stringify(username)}\nAUTH_PASSWORD_SHA256=${JSON.stringify(hash)}\n`,{mode:0o600});
  writeFileSync('ACCESO-LOCAL.txt',`DESPENSA FAMILIAR — ACCESO PRIVADO\n\nUsuario: ${username}\nContraseña: ${password}\n\nGuardá esta contraseña en un gestor de contraseñas y compartila solo con tu familia.\nEste archivo y .dev.vars están excluidos de Git. No los subas al repositorio.\nLa contraseña es aleatoria: no la reemplaces por una contraseña elegida manualmente.\nPara rotarla: npm run setup -- --rotate, y luego npm run deploy.\n`,{mode:0o600});
  console.log('Acceso generado. Consultá ACCESO-LOCAL.txt en tu equipo. No se muestran credenciales en la consola.');
}
if(process.argv[1]?.endsWith('setup.mjs')) setup(process.argv.includes('--rotate'));
