# Punto de Venta · Farmacia

App web (HTML + JS) con base de datos compartida en Firebase (Auth + Firestore). Todos los usuarios ven los mismos datos en tiempo real.

## Roles

| Rol | Puede |
| --- | --- |
| **Cliente** | Ver el catálogo, comprar (tarjeta o pagar en tienda) y ver sus propias compras. |
| **Administrador** | Todo lo anterior + cobrar en mostrador (descuento y efectivo), administrar inventario, ver historial completo, resumen con gráficas y gestionar usuarios/roles. |

Los clientes se registran solos desde "Crear cuenta". El admin puede crear cuentas (de cliente o admin) y cambiar roles desde **Usuarios**.

## Concurrencia

- **Sin sobreventa:** cada compra es una transacción de Firestore (`runTransaction` en `public/app.js`). Lee el stock actual, valida, descuenta, genera el folio y guarda la venta en una sola operación atómica. Si dos usuarios compran la última pieza a la vez, Firestore reintenta una de las transacciones, ve que ya no hay stock y esa compra se rechaza con un aviso.
- **Tiempo real:** `onSnapshot` en productos, ventas y usuarios. Si alguien compra o el admin edita el inventario, todas las pantallas se actualizan solas y el carrito se ajusta si se queda sin existencias.
- **Ediciones del admin:** la existencia se ajusta con `increment(delta)`, así que corregir un producto mientras se vende no pisa las ventas que llegaron mientras editabas.

## Estado actual

- Proyecto de Firebase: `farmacia-pos-valde` (config ya en `public/firebase-config.js`, reglas y hosting desplegados).
- URL: <https://farmacia-pos-valde.web.app>
- Pendiente en consola: habilitar Authentication con correo/contraseña (paso 2 de abajo) y promover al primer admin.
- Para publicar cambios: `firebase deploy --only hosting` (o `firestore:rules` si cambias las reglas).

## Validación de transacciones y red

La lógica de compra vive en `public/checkout.js` y es **idempotente**: cada intento de pago lleva un `saleId`; si la red se corta después de que el servidor confirmó y el usuario reintenta, la venta no se duplica. Si no hay conexión, la app lo avisa y bloquea el pago. Las pruebas automáticas (`tests/`, ver `tests/README.md`) cubren caída de red, respuesta perdida, doble clic, atomicidad, concurrencia y reglas de seguridad: `cd tests && npm install && npm test`.

## Puesta en marcha (desde cero)

1. **Crear el proyecto** en <https://console.firebase.google.com> (puedes desactivar Analytics).
2. **Authentication** → Comenzar → *Correo electrónico/contraseña* → Habilitar.
3. **Firestore Database** → Crear base de datos (modo producción; las reglas se despliegan abajo).
4. **Configuración del proyecto → Tus apps → Web (`</>`)** → registra la app y copia el `firebaseConfig` en `public/firebase-config.js`.
5. Instala la CLI y despliega reglas y hosting:

   ```bash
   npm install -g firebase-tools
   firebase login
   firebase use --add          # elige tu proyecto
   firebase deploy --only firestore:rules,hosting
   ```

6. Abre la URL de Hosting que te da el comando. Para probar en local: `firebase serve --only hosting` o cualquier servidor estático sobre la carpeta `public/` (no funciona abriendo el archivo con doble clic, porque usa módulos ES).

## Crear el primer administrador

1. En la app, **Crear cuenta** con el usuario que será admin.
2. En la consola de Firebase → Firestore → colección `users` → documento de ese usuario → cambia el campo `role` de `cliente` a `admin`.
3. Recarga la app: ya verás Inventario, Resumen y Usuarios. Desde ahí el admin crea o promueve a los demás.
4. En **Inventario** pulsa *Cargar 10 productos de ejemplo* si quieres datos de prueba.

## Probar la concurrencia

Abre la app en dos navegadores (o una ventana normal y una de incógnito) con dos usuarios distintos. Deja un producto con 1 pieza, agrégalo al carrito en ambos y paga casi al mismo tiempo: una compra se confirma y la otra muestra "se agotó". Mientras tanto el inventario del otro usuario se actualiza solo.

## Estructura

```
public/
  index.html          Pantallas y maquetado
  styles.css          Estilos (claro/oscuro)
  app.js              Auth, roles, tiempo real, transacciones
  firebase-config.js  Tu configuración de Firebase
firestore.rules       Reglas de seguridad por rol
firebase.json         Hosting + reglas
```

## Límites conocidos

- Los usuarios se identifican con `usuario@farmacia.app` internamente (Firebase Auth pide correo). No se envían correos reales ni hay recuperación de contraseña.
- Las reglas impiden que un cliente suba stock, edite productos o lea ventas ajenas. No pueden verificar que el total de una venta coincida con los precios (eso requeriría Cloud Functions, que necesitan el plan Blaze). En un entorno real, el cobro iría en un servidor.
- El resumen usa las últimas 500 ventas.
