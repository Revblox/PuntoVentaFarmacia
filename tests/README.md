# Pruebas de transacciones y red

Corren contra el **emulador local de Firestore** con las reglas reales (`firestore.rules`) y la misma lógica de compra que usa la app (`public/checkout.js`). No tocan la base de datos real.

## Requisitos
- Node.js y la CLI de Firebase (`npm install -g firebase-tools`).
- Java 11 o superior (el emulador lo necesita). Si usas Android Studio, sirve su JDK: `JAVA_HOME="C:\Program Files\Android\Android Studio\jbr"`.

## Ejecutar
```bash
cd tests
npm install
npm test
```

## Qué se valida
| # | Prueba | Qué demuestra |
| --- | --- | --- |
| 1 | Compra normal | Crea la venta, descuenta stock y avanza el folio |
| 2 | Respuesta perdida | Si el servidor confirmó pero el cliente no lo supo y reintenta, **no se duplica** la venta |
| 3 | Doble clic | Dos envíos simultáneos del mismo pago generan **una sola** venta |
| 4 | Red caída | Un proxy corta la conexión: la compra falla con error de red, no cambia nada, y al volver la red el reintento funciona |
| 5 | Atomicidad | Si un producto del pedido no alcanza, no se descuenta ninguno |
| 6 | Concurrencia | 4 clientes compran la última pieza a la vez: uno gana, los demás reciben "se agotó" |
| 7 | Folios | Compras simultáneas obtienen folios distintos y consecutivos |
| 8 | Seguridad | Un cliente no puede subir stock ni leer ventas ajenas |

## Cómo está hecha la protección
- Cada intento de pago genera un `saleId` en el cliente. La transacción primero busca esa venta: si ya existe, la devuelve sin volver a descontar.
- Todo (stock, folio y venta) se escribe en **una sola transacción**: se aplica completo o no se aplica.
- Una caída de red antes de confirmar no deja cambios; una caída después de confirmar se resuelve con el reintento idempotente.
