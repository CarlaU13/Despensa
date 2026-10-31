# Despensa · En casa

Aplicación privada para una despensa familiar, adaptable a celulares y computadoras. Todos usan el mismo usuario y contraseña y comparten los datos guardados en el servidor.

## Qué incluye

- Catálogo con nombre, categoría, notas, unidad y mínimo para avisos de stock. Solo el nombre es obligatorio; unidad por defecto: unidad.
- Unidades: unidad, paquete, kg, g, l, ml, pote, botella, lata, frasco y porción. No mezcla ni convierte unidades automáticamente.
- Lugares configurables: alacenas, fruteros, heladeras, freezers, etc.
- Compras por lotes con cantidad y lugar; fechas de compra, vencimiento, apertura, congelación y próxima revisión; precio, notas y atención manual. Todos los detalles adicionales pueden quedar vacíos.
- Consumo y movimientos completos o parciales entre lugares.
- Avisos dentro de la aplicación por poco stock (cantidad menor o igual al mínimo), atención manual, vencimiento dentro de 7 días o pasado, revisión pendiente y compra de más de un año.
- Lista compartida manual, sugerencias de reposición y recepción de compras que ingresa el lote y marca la lista en una sola transacción.
- Historial y deshacer, con protección frente a cambios simultáneos.
- Exportación JSON de los datos activos. La restauración completa se realiza con D1; todavía no hay importación JSON desde la interfaz.
- No incluye escáner de códigos ni avisos por correo o push en esta versión.

## Ejecutar en tu computadora

Requiere Node.js 24 o posterior. No se necesitan dependencias para ejecutar y probar localmente.

1. Abrí una terminal **en esta carpeta Despensa**.
2. Ejecutá `npm run setup`.
3. Consultá el usuario y contraseña en `ACCESO-LOCAL.txt`, guardado solamente en tu computadora.
4. Ejecutá `npm run dev`.
5. Abrí [http://127.0.0.1:8787](http://127.0.0.1:8787).

La base local se guarda en `.local/despensa.sqlite`. No se comparte entre equipos hasta desplegar la aplicación. El servidor de desarrollo escucha solo en este equipo.

```text
npm test
npm run check
```

## Desplegar sin comprar dominio

Alojamiento propuesto: **Cloudflare Workers Free + D1**. Necesitás crear tu propia cuenta de Cloudflare; este repositorio no incluye ni presupone acceso a ella.

Consultado el 31/10/2026: Workers Free incluye 100.000 solicitudes por día con 10 ms de CPU por invocación. D1 tiene sus propias cuotas gratuitas; exceder límites puede impedir solicitudes. Revisá las condiciones vigentes antes de habilitar cualquier plan pago:
- [Workers: precios](https://developers.cloudflare.com/workers/platform/pricing/)
- [D1: precios](https://developers.cloudflare.com/d1/platform/pricing/)
- [D1: recuperación de datos](https://developers.cloudflare.com/d1/reference/time-travel/)

Para el uso doméstico previsto, el plan gratuito es el punto de partida. Se usa una URL `workers.dev`; no necesitás dominio propio.

1. Creá una cuenta gratuita en [Cloudflare](https://dash.cloudflare.com/sign-up).
2. En la terminal de esta carpeta ejecutá `npm ci` para instalar la versión de Wrangler fijada en el proyecto.
3. Ejecutá `npx wrangler login` y autorizá **tu cuenta de Cloudflare** en el navegador.
4. Ejecutá `npm run deploy`.
5. Compartí la URL HTTPS que devuelve Wrangler y las credenciales de `ACCESO-LOCAL.txt` solo con tu familia.

El script crea o reutiliza la base D1, guarda su identificador en `wrangler.jsonc`, aplica las migraciones, configura los secretos y despliega. El identificador de D1 no es una contraseña. No cambies la cuenta de Cloudflare sin revisar la base configurada.

El acceso a GitHub y el acceso al alojamiento son independientes. El código público no contiene el inventario, la contraseña ni la base de datos de tu familia.

## Acceso y seguridad

- Una única cuenta familiar, sin registro público ni usuarios invitados.
- Contraseña inicial aleatoria de 256 bits. **No reemplazar por una contraseña humana**: el almacenamiento mediante SHA-256 presupone esta entropía. Para contraseñas elegidas manualmente se necesitaría un esquema de derivación de contraseñas diferente.
- El hash de la contraseña y el usuario se configuran como secretos del Worker. La contraseña no se envía en comandos de terminal ni se imprime en los logs.
- Sesiones opacas aleatorias, guardadas como hashes en la base. Cookie `__Host-`, Secure, HttpOnly y SameSite=Strict; expiran a los 14 días.
- Autenticación en cada operación de la API, incluida la exportación. Verificación de origen y cabecera propia para escrituras, límite de cuerpo y consultas SQL parametrizadas.
- Límite de 15 intentos de acceso por dirección IP y ventana de 15 minutos. No es una garantía contra denegación de servicio; las cuotas de alojamiento también aplican.
- Cabeceras CSP, protección contra iframes, no almacenamiento de respuestas y sin recursos ni analíticas de terceros.
- El cierre de todas las sesiones está en “Cuenta familiar” (en celular, tocá el círculo F de la barra superior).
- Al compartir una cuenta, no se puede atribuir cada cambio a una persona.

Los archivos `.dev.vars`, `ACCESO-LOCAL.txt` y `.local/` están excluidos de Git. No publiques capturas ni copias de ellos. Si usás OneDrive, sus permisos y sincronización también deben quedar bajo tu control.

### Cambiar el acceso

En esta carpeta: `npm run setup -- --rotate` y luego `npm run deploy`. Esto genera una contraseña nueva. Las sesiones anteriores dejan de ser válidas al aplicar los nuevos secretos. Volvé a compartir el acceso con la familia.

Para recuperar una contraseña perdida también se realiza una rotación desde el equipo o la cuenta de Cloudflare; no hay recuperación pública por correo.

## Copias y recuperación

Desde el pie de página podés descargar los datos activos en JSON. Guardá esas copias en un lugar privado. La exportación no incluye contraseñas ni sesiones.

D1 ofrece Time Travel: la documentación indica 7 días de recuperación en el plan gratuito y 30 en el pago. Confirmá disponibilidad en tu cuenta. Para una copia SQL manual de producción:

```text
npx wrangler d1 export DB --remote --output=backup-despensa.sql
```

Las copias SQL contienen datos privados; guardalas fuera del repositorio. No hay una tarea automática de exportación externa configurada. Antes de una restauración completa, hacé una copia del estado actual y seguí la documentación de Time Travel.

## Estructura

- `public/`: interfaz sin frameworks ni dependencias externas.
- `src/`: API del Worker y reglas de validación.
- `migrations/`: esquema D1/SQLite, restricciones de referencias e historial.
- `scripts/`: configuración, servidor local, verificación y despliegue.
- `test/`: pruebas de dominio y API usando SQLite real en memoria.
- `wrangler.jsonc`: configuración del alojamiento; sin secretos.

`src/domain.mjs` y `public/domain.mjs` contienen las mismas reglas puras. `npm run check` verifica que sigan sincronizadas.
