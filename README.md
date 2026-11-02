# Vaquita

App web para dividir los gastos de cada juntada con amigos. Se entra con un link, sin crear cuentas, y funciona en el celular como una app instalable.

Corre gratis en el plan Free de Cloudflare: Workers para el servidor y D1 para la base de datos.

## Publicarla gratis

Necesitás una cuenta de GitHub y una de Cloudflare. No hace falta instalar nada en tu computadora.

1. **Subí el código a GitHub.**
   - Creá un repositorio **público** llamado `vaquita-codigo`. Tiene que ser público para que funcione el paso 2. Se ve el código, pero nunca los datos de las juntadas: esos quedan en Cloudflare.
   - Tocá **uploading an existing file** y arrastrá todo lo que está **dentro** de la carpeta `vaquita`, con sus subcarpetas.
   - Confirmá con **Commit changes**.
2. **Abrí este enlace en el navegador**, reemplazando `TU-USUARIO` por tu usuario de GitHub:
   `https://deploy.workers.cloudflare.com/?url=https://github.com/TU-USUARIO/vaquita-codigo`
3. **Seguí los pasos en pantalla.** Entrá o registrate en Cloudflare, autorizá a GitHub y elegí un nombre para el repositorio nuevo que va a crear, por ejemplo `vaquita`. Cloudflare crea la base de datos solo. Confirmá para publicar.
4. **Abrí la dirección que te da**, del tipo `https://vaquita.tu-usuario.workers.dev`, y creá una juntada de prueba.

El repositorio nuevo es el que queda conectado a la app: cada cambio que se guarde ahí se publica solo.

## Qué incluye el plan gratuito

- 100.000 pedidos por día a la API y archivos de la app ilimitados.
- 5 millones de filas leídas y 100.000 escritas por día.
- Hasta 500 MB por base de datos.

Si se pasa un límite diario, la app deja de responder hasta las 21:00 de Argentina (medianoche UTC) y los datos no se pierden. Mantené la cuenta en el plan Free y no agregues un plan pago: la app no lo necesita.

Revisá los [límites vigentes](https://developers.cloudflare.com/workers/platform/pricing/), porque pueden cambiar.

## Qué hace

- Una cuenta por juntada, con su link propio para invitar al grupo.
- Cinco formas de dividir: partes iguales, ítems del ticket (con cantidades, propina y descuento), montos a medida, porcentajes y partes.
- Varios pagadores por gasto.
- Quién le paga a quién con la menor cantidad de transferencias, y registro de pagos totales o parciales.
- Los cambios de los demás aparecen en unos 5 segundos.
- PDF de resumen: se comparte directo desde el celular o se descarga. También hay un texto listo para WhatsApp.
- Historial de cambios, y recuperación de gastos y juntadas borrados durante 30 días.
- Abre sin señal, con lo último que se cargó, en modo lectura.

## Copias de seguridad

- Cloudflare guarda automáticamente el historial de la base durante 7 días (Time Travel), y permite volver a un momento anterior.
- Para bajar una copia completa a tu computadora, con [Node.js](https://nodejs.org) instalado, abrí la carpeta del proyecto y ejecutá `npm install` y `npm run respaldo`. La primera vez, `npx wrangler login` conecta tu cuenta.

## Seguridad: lo que conviene saber

- **El link es la llave.** Cualquiera que lo tenga puede ver y editar esa juntada. Los links no se pueden adivinar, pero si alguien reenvía uno, quien lo reciba entra.
- Como no hay cuentas, el "¿Quién sos?" sólo sirve para personalizar la vista y firmar el historial. No demuestra la identidad de nadie.
- La lista de juntadas y la identidad elegida se guardan en cada dispositivo: si se borran, se recuperan entrando otra vez con el link de cada juntada. Los grupos guardados también viven en el dispositivo, y esos sí se pierden.
- El servidor valida que cada cuenta cierre antes de guardarla. También frena pedidos excesivos, aunque es una protección parcial: alguien decidido a saturar la app podría dejarla sin servicio hasta el corte diario.

## Para desarrollar

Necesitás Node.js 22.13 o más nuevo.

```bash
npm run local   # app en http://localhost:3000, sin instalar nada
npm test        # pruebas de la API y de las cuentas
```

```
worker/       servidor (Cloudflare Worker) y consultas a la base
migrations/   estructura de la base de datos
public/       app web; logic.js se comparte con el servidor (cuentas, PDF, validación)
scripts/      servidor local para desarrollar y probar sin Cloudflare
test/         pruebas
```
