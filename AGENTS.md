# Despensa familiar

Este repositorio corresponde únicamente a CarlaU13/Despensa. Trabajá en el checkout de Despensa; nunca escribas en otros proyectos ni uses repositorios ajenos.

La aplicación usa una única cuenta compartida, interfaz en español y datos familiares en el servidor. No reemplaces el acceso por cuentas individuales sin que lo pida la persona usuaria.

No confirmes despliegues sin evidencia. La cuenta de alojamiento debe pertenecer a la persona usuaria. No subas secretos, credenciales, bases locales ni copias de datos familiares a Git.

Validación: Node.js 24 o posterior, `npm run check` y `npm test`. Las reglas puras en src/domain.mjs y public/domain.mjs deben ser idénticas.

La interfaz no depende de frameworks. El lector ZXing se empaqueta con npm run build:scanner y se sirve desde public/vendor; no cargar código desde CDN. La consulta externa de códigos usa solo los dominios Open Facts permitidos, después de autenticar la sesión, sin enviar imágenes ni datos familiares. Mantené consultas SQL parametrizadas, autorización en cada endpoint, protección de origen y transacciones para cambios de varias entidades.
