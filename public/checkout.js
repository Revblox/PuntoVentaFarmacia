// Lógica de compra, separada de la interfaz para poder probarla sola (ver tests/).
// No importa Firebase: recibe las funciones de Firestore ya cargadas (CDN en el navegador, npm en las pruebas).

export class SaleError extends Error {}

export const r2 = n => Math.round((n + Number.EPSILON) * 100) / 100;

export function expState(p) {
  if (!p.expiry) return { s: 'none', days: null };
  const days = Math.floor((new Date(p.expiry + 'T23:59:59') - new Date()) / 864e5);
  return { s: days < 0 ? 'expired' : days <= 60 ? 'soon' : 'ok', days };
}

// Errores que indican que falló la red (no la lógica ni los permisos): la compra pudo o no haberse confirmado.
export const isNetworkError = ex => ['unavailable', 'deadline-exceeded', 'cancelled'].includes(ex?.code);

export function createCheckout({ doc, collection, runTransaction, serverTimestamp }) {
  /**
   * Registra una venta de forma atómica e IDEMPOTENTE.
   * - `saleId` lo genera el cliente una vez por intento de pago. Si la red se corta justo después de que el
   *   servidor confirmó, el reintento usa el mismo id, detecta que la venta ya existe y la devuelve
   *   (`duplicate: true`) sin descontar stock otra vez ni gastar otro folio.
   * - Si hay choque con otra compra simultánea, la transacción se repite con datos frescos.
   */
  return async function checkout(db, { saleId, lines, pct = 0, method, cash = false, recv = null, user, profile }) {
    const run = () => runTransaction(db, async tx => {
      const saleRef = doc(db, 'sales', saleId);
      const counterRef = doc(db, 'counters', 'sales');
      const refs = lines.map(l => doc(db, 'products', l.id));

      // Todas las lecturas van antes de cualquier escritura.
      const prev = await tx.get(saleRef);
      if (prev.exists()) {
        const d = prev.data();
        return { id: prev.id, ...d, _d: d.createdAt?.toDate ? d.createdAt.toDate() : new Date(), duplicate: true };
      }
      const snaps = await Promise.all(refs.map(r => tx.get(r)));
      const cSnap = await tx.get(counterRef);

      const items = []; let sub = 0;
      snaps.forEach((s, i) => {
        if (!s.exists()) throw new SaleError('Un producto de tu pedido ya no está disponible');
        const p = s.data();
        if (expState(p).s === 'expired') throw new SaleError(`${p.name} está caducado`);
        if (p.stock < lines[i].qty) throw new SaleError(p.stock > 0 ? `Solo quedan ${p.stock} de ${p.name}` : `${p.name} se agotó`);
        items.push({ id: s.id, name: p.name, qty: lines[i].qty, price: p.price });
        sub += lines[i].qty * p.price;
      });
      sub = r2(sub);
      const dAmt = r2(sub * pct / 100), total = r2(sub - dAmt);
      if (cash && (recv == null || recv < total)) throw new SaleError('El monto recibido es menor al total');

      const last = cSnap.data()?.last;
      const folio = (Number.isInteger(last) ? last : 0) + 1;
      snaps.forEach((s, i) => tx.update(refs[i], { stock: s.data().stock - lines[i].qty, updatedAt: serverTimestamp() }));
      tx.set(counterRef, { last: folio });
      const data = {
        folio, items, subtotal: sub, discount: dAmt, total, method,
        received: cash ? recv : total, change: cash ? r2(recv - total) : 0,
        userId: user.uid, userName: profile.name, role: profile.role, createdAt: serverTimestamp(),
      };
      tx.set(saleRef, data);
      return { id: saleRef.id, ...data, _d: new Date(), duplicate: false };
    });

    // Las reglas se evalúan ANTES de que Firestore detecte un choque entre transacciones, así que una transacción
    // con datos viejos (p. ej. un folio que otro ya usó) llega como "permission-denied" y no se reintenta sola.
    // La repetimos aquí: en el reintento lee el estado real y, si ya no hay stock, responde "se agotó".
    for (let i = 0; ; i++) {
      try { return await run(); }
      catch (ex) {
        if (ex.code !== 'permission-denied' || i >= 5) throw ex;
        await new Promise(r => setTimeout(r, 30 + Math.random() * 150));
      }
    }
  };
}
