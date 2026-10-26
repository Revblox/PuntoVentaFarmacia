// Pruebas de transacciones y fallos de red contra el emulador de Firestore, usando las reglas reales
// (firestore.rules) y la MISMA lógica de compra que usa la app (public/checkout.js).
// Ejecutar con:  npm test   (ver tests/README.md)
import { initializeApp } from 'firebase/app';
import {
  getFirestore, connectFirestoreEmulator, doc, collection, runTransaction, serverTimestamp,
  setDoc, getDoc, getDocs, updateDoc, disableNetwork, enableNetwork,
} from 'firebase/firestore';
import net from 'node:net';
import { createCheckout, SaleError, isNetworkError } from '../public/checkout.js';

const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080').split(':');
let n = 0;
function dbFor(token, viaPort = +port) {
  const db = getFirestore(initializeApp({ projectId: 'demo-farmacia' }, 'app' + n++));
  connectFirestoreEmulator(db, host, viaPort, { mockUserToken: token });
  return db;
}

// Proxy TCP entre el cliente y el emulador para simular una red que se cae: en modo "down" rechaza y corta
// todas las conexiones, igual que si el usuario perdiera internet.
function makeProxy() {
  const state = { mode: 'ok' }; const conns = new Set();
  const server = net.createServer(client => {
    if (state.mode === 'down') return client.destroy();
    const up = net.connect(+port, host);
    conns.add(client); conns.add(up);
    const close = () => { client.destroy(); up.destroy(); conns.delete(client); conns.delete(up); };
    client.on('data', d => up.write(d)); up.on('data', d => client.write(d));
    for (const x of [client, up]) { x.on('error', close); x.on('close', close); }
  });
  return {
    state,
    listen: () => new Promise(r => server.listen(0, '127.0.0.1', () => r(server.address().port))),
    setMode(m) { state.mode = m; if (m === 'down') conns.forEach(c => c.destroy()); },
  };
}
const checkout = createCheckout({ doc, collection, runTransaction, serverTimestamp });

// "owner" omite las reglas: solo para sembrar datos y verificar el estado real de la base.
const owner = dbFor('owner');
const asUser = id => dbFor({ sub: id, user_id: id });
const profile = (id, role = 'cliente') => ({ name: id, role });

const results = [];
async function test(name, fn) {
  try { await fn(); results.push([name, true, '']); console.log('OK  ', name); }
  catch (e) { results.push([name, false, e.message]); console.log('FAIL', name, '->', e.message); }
}
const eq = (a, b, msg) => { if (a !== b) throw new Error(`${msg}: esperaba ${b} y obtuve ${a}`); };
const stockOf = async id => (await getDoc(doc(owner, 'products', id))).data().stock;
const salesCount = async () => (await getDocs(collection(owner, 'sales'))).size;
const newId = db => doc(collection(db, 'sales')).id;
const order = (db, uid, saleId, lines, extra = {}) =>
  checkout(db, { saleId, lines, method: 'Tarjeta', user: { uid }, profile: profile(uid), ...extra });
const product = (name, stock, price = 10) => ({ name, price, stock, min: 0, expiry: '', rx: false, category: 'x', code: name });

// Datos base
await setDoc(doc(owner, 'users', 'admin1'), { username: 'admin', name: 'admin1', role: 'admin' });
for (const u of ['ana', 'beto', 'carla', 'dan']) await setDoc(doc(owner, 'users', u), { username: u, name: u, role: 'cliente' });

await test('1. Compra normal: crea la venta, descuenta stock y avanza el folio', async () => {
  await setDoc(doc(owner, 'products', 'a1'), product('a1', 10));
  const ana = asUser('ana');
  const s = await order(ana, 'ana', newId(ana), [{ id: 'a1', qty: 3 }]);
  eq(s.folio, 1, 'folio'); eq(await stockOf('a1'), 7, 'stock'); eq(await salesCount(), 1, 'ventas');
});

await test('2. Respuesta perdida: reintentar el mismo pago NO duplica la venta', async () => {
  await setDoc(doc(owner, 'products', 'b1'), product('b1', 10));
  const beto = asUser('beto'); const id = newId(beto);
  const antes = await salesCount();
  const primera = await order(beto, 'beto', id, [{ id: 'b1', qty: 2 }]);   // el servidor confirma...
  const reintento = await order(beto, 'beto', id, [{ id: 'b1', qty: 2 }]); // ...pero el cliente no lo supo y reintenta
  eq(reintento.duplicate, true, 'marcada como duplicado'); eq(reintento.folio, primera.folio, 'mismo folio');
  eq(await stockOf('b1'), 8, 'stock descontado una sola vez'); eq(await salesCount(), antes + 1, 'una sola venta nueva');
});

await test('3. Doble clic (dos envíos simultáneos del mismo pago): una sola venta', async () => {
  await setDoc(doc(owner, 'products', 'c1'), product('c1', 10));
  const carla = asUser('carla'); const id = newId(carla); const antes = await salesCount();
  const [x, y] = await Promise.all([order(carla, 'carla', id, [{ id: 'c1', qty: 1 }]), order(carla, 'carla', id, [{ id: 'c1', qty: 1 }])]);
  eq(x.folio, y.folio, 'mismo folio'); eq(await stockOf('c1'), 9, 'stock'); eq(await salesCount(), antes + 1, 'ventas');
});

await test('4. Red caída: la compra falla con error de red, no toca la base, y al volver la red el reintento funciona', async () => {
  await setDoc(doc(owner, 'products', 'd1'), product('d1', 10));
  const proxy = makeProxy(); const proxyPort = await proxy.listen();
  const dan = dbFor({ sub: 'dan', user_id: 'dan' }, proxyPort); const id = newId(dan); const antes = await salesCount();
  eq((await order(dan, 'dan', newId(dan), [{ id: 'd1', qty: 1 }])).folio > 0, true, 'con red funciona');
  eq(await stockOf('d1'), 9, 'stock con red');
  proxy.setMode('down'); // se corta internet
  let err;
  try { await order(dan, 'dan', id, [{ id: 'd1', qty: 1 }]); } catch (e) { err = e; }
  if (!err) throw new Error('debió fallar sin red');
  if (!isNetworkError(err)) throw new Error('el error no se reconoce como de red: ' + err.code);
  eq(await stockOf('d1'), 9, 'stock intacto sin red'); eq(await salesCount(), antes + 1, 'sin ventas nuevas durante la caída');
  proxy.setMode('ok'); // vuelve internet
  const s = await order(dan, 'dan', id, [{ id: 'd1', qty: 1 }]);
  eq(s.duplicate, false, 'venta nueva'); eq(await stockOf('d1'), 8, 'stock tras reconectar');
});

await test('5. Atomicidad: si un producto del pedido no alcanza, no se descuenta NINGUNO', async () => {
  await setDoc(doc(owner, 'products', 'e1'), product('e1', 5));
  await setDoc(doc(owner, 'products', 'e2'), product('e2', 1));
  const ana = asUser('ana'); const antes = await salesCount();
  let err;
  try { await order(ana, 'ana', newId(ana), [{ id: 'e1', qty: 2 }, { id: 'e2', qty: 3 }]); } catch (e) { err = e; }
  if (!(err instanceof SaleError)) throw new Error('debió rechazar por stock: ' + (err && err.message));
  eq(await stockOf('e1'), 5, 'e1 intacto'); eq(await stockOf('e2'), 1, 'e2 intacto'); eq(await salesCount(), antes, 'sin venta');
});

await test('6. Concurrencia por red: 4 clientes, 1 sola pieza -> gana uno, los demás reciben "se agotó"', async () => {
  await setDoc(doc(owner, 'products', 'f1'), product('f1', 1));
  const who = ['ana', 'beto', 'carla', 'dan'];
  const r = await Promise.allSettled(who.map(u => { const d = asUser(u); return order(d, u, newId(d), [{ id: 'f1', qty: 1 }]); }));
  const ok = r.filter(x => x.status === 'fulfilled'); const bad = r.filter(x => x.status === 'rejected');
  eq(ok.length, 1, 'compras exitosas'); eq(bad.length, 3, 'rechazadas');
  if (!bad.every(x => x.reason instanceof SaleError)) throw new Error('los rechazos deben ser "se agotó", no errores técnicos');
  eq(await stockOf('f1'), 0, 'stock final');
});

await test('7. Folios únicos y consecutivos con compras simultáneas', async () => {
  await setDoc(doc(owner, 'products', 'g1'), product('g1', 20));
  const who = ['ana', 'beto', 'carla', 'dan'];
  const r = await Promise.all(who.map(u => { const d = asUser(u); return order(d, u, newId(d), [{ id: 'g1', qty: 1 }]); }));
  const folios = r.map(x => x.folio).sort((a, b) => a - b);
  eq(new Set(folios).size, 4, 'folios distintos');
  eq(folios[3] - folios[0], 3, 'consecutivos'); eq(await stockOf('g1'), 16, 'stock');
});

await test('8. Seguridad: un cliente no puede subir stock ni leer ventas ajenas', async () => {
  const ana = asUser('ana');
  let blocked = 0;
  try { await updateDoc(doc(ana, 'products', 'a1'), { stock: 999 }); } catch (e) { if (e.code === 'permission-denied') blocked++; }
  const otra = (await getDocs(collection(owner, 'sales'))).docs.find(d => d.data().userId !== 'ana');
  try { await getDoc(doc(ana, 'sales', otra.id)); } catch (e) { if (e.code === 'permission-denied') blocked++; }
  eq(blocked, 2, 'operaciones bloqueadas por las reglas');
});

const fails = results.filter(r => !r[1]).length;
console.log(`\n${results.length - fails}/${results.length} pruebas correctas`);
process.exit(fails ? 1 : 0);
