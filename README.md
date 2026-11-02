# Despensa · En casa

Aplicación privada para una despensa familiar, adaptable a celulares y computadoras. Todos usan el mismo usuario y contraseña y comparten los datos guardados en el servidor.

## Qué incluye

- Catálogo con nombre, categoría libre (con sugerencias de Alimentos, Limpieza, Higiene personal, Mascotas y Otros), notas, unidad y mínimo para avisos de stock. Solo el nombre es obligatorio; unidad por defecto: unidad.
- Unidades: unidad, paquete, kg, g, l, ml, pote, botella, lata, frasco y porción. No mezcla ni convierte unidades automáticamente.
- Filtros por categoría en catálogo e inventario; la categoría es independiente del lugar físico.
- Lugares configurables: alacenas, fruteros, heladeras, freezers, etc.
- Compras por lotes con cantidad y lugar; fechas de compra, vencimiento, apertura, congelación y próxima revisión; precio, notas y atención manual. Todos los detalles adicionales pueden quedar vacíos.
- Consumo y movimientos completos o parciales entre lugares.
- Avisos dentro de la aplicación por poco stock (cantidad menor o igual al mínimo), atención manual, vencimiento dentro de 7 días o pasado, revisión pendiente y compra de más de un año.
- Lista compartida manual, sugerencias de reposición y recepción de compras que ingresa el lote y marca la lista en una sola transacción.
- Historial y deshacer, con protección frente a cambios simultáneos.
- Exportación JSON de los datos activos. La restauración completa se realiza con D1; todavía no hay importación JSON desde la interfaz.
- Escaneo de códigos con cámara, lectura local de una foto o ingreso manual; consulta externa opcional y confirmación antes de crear el producto. No incluye avisos por correo o push.

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

## Capacidad y sincronización

El límite propio de la aplicación es de **50.000 registros activos**, sumando lugares, productos, lotes y artículos de compra. No es una promesa de capacidad ilimitada: siguen aplicando las cuotas y los límites de almacenamiento del alojamiento. No se cambió el plan gratuito.

La API entrega páginas de hasta 500 registros usando cursores; al abrir se obtiene el inventario completo por partes y luego solo los registros modificados o eliminados desde la última sincronización. Las listas muestran 50 resultados por página y cada producto despliega inicialmente hasta 20 lotes. Los totales incluyen todos los registros, no solo la página visible.

La descarga desde la interfaz reúne todas las páginas en el navegador para producir un único JSON completo. La API /api/export también es paginada: sus clientes deben seguir next_cursor con upper_rowid y change_cursor hasta el final.

La migración 0002 mantiene los datos y crea un contador de capacidad actualizado por transacciones, incluyendo recepción de compras, separación de lotes, eliminación y deshacer.

Para artículos de limpieza: creá el producto con categoría **Limpieza** y registrá su compra en el lugar real (por ejemplo, **Alacena del lavadero**). Se pueden crear categorías propias o dejarlas vacías.

## Códigos de barras

En “Escanear código” se busca primero en el catálogo familiar. Si no está asociado, el servidor consulta la API pública Open Facts (alimentos, cosméticos, mascotas u otros productos) enviando solo el código y un identificador público de esta aplicación. No se envían fotos, inventario ni credenciales familiares.

Los resultados se revisan antes de guardar. Nombre, marca y presentación pueden estar incompletos. La cantidad comprada, el lugar y las fechas siguen siendo datos de cada compra. La unidad de stock no se convierte automáticamente a partir del tamaño del envase.

El código, marca, presentación y fuente son campos opcionales del producto. Los códigos GTIN se verifican y normalizan para impedir duplicados UPC/EAN. Los productos anteriores siguen funcionando sin código; la migración 0003 añade índices y tablas auxiliares sin reemplazar registros.

La consulta necesita sesión y origen propio. Solo se permiten los dominios Open Facts y redirecciones controladas. Se limitan tiempo y tamaño de respuesta; una caché evita consultas repetidas y un cupo de 10 consultas nuevas por minuto ayuda a respetar los límites del proveedor. La carga manual sigue disponible ante ausencia, fallo o límite del servicio.

La cámara se activa únicamente al tocar “Usar cámara”; se solicita permiso del navegador y se detiene al cerrar, ocultar la pestaña o detectar un código. Los fotogramas y las fotos se decodifican en el dispositivo. El lector ZXing se sirve desde este sitio, sin CDN. Se leen EAN-8, EAN-13, UPC-A e ITF/GTIN-14; otros formatos se pueden ingresar manualmente cuando correspondan a un GTIN válido.

Para reconstruir el lector local: npm ci y npm run build:scanner. El archivo empaquetado y sus licencias están en public/vendor y se versionan para que un despliegue normal no dependa de instalar librerías en el servidor.

Datos externos: [Open Food Facts](https://world.openfoodfacts.org), [Open Beauty Facts](https://world.openbeautyfacts.org), [Open Pet Food Facts](https://world.openpetfoodfacts.org), [Open Products Facts](https://world.openproductsfacts.org). Bases bajo ODbL y contenidos bajo DbCL: https://openfoodfacts.github.io/openfoodfacts-server/api/ . El proveedor solicita identificar la aplicación y registrar su uso mediante el formulario enlazado en su documentación.

Lector: @zxing/library (Apache-2.0); se incluye su archivo de licencia. No se utilizan imágenes del proveedor.

La lectura en vivo usa primero BarcodeDetector cuando el navegador ofrece los formatos necesarios y mantiene ZXing local como alternativa. Se solicita cámara trasera en alta resolución y enfoque continuo solo cuando está disponible. La alternativa prueba ambas orientaciones, valida el código antes de detenerse y avisa si tarda en reconocerlo. Cerrar u ocultar la pestaña detiene cámara y bucle de lectura.
