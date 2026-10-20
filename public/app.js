import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  getFirestore, collection, doc, onSnapshot, runTransaction, setDoc, addDoc, updateDoc, deleteDoc,
  writeBatch, increment, serverTimestamp, query, where, orderBy, limit,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';

/* ================= Utilidades ================= */
const STORE_NAME = 'Farmacia';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const fmt = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });
const money = n => fmt.format(n || 0);
const r2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const dayKey = d => { d = new Date(d); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const addDays = n => { const d = new Date(); d.setDate(d.getDate() + n); return dayKey(d); };
const fmtDate = d => new Date(d).toLocaleString('es-MX', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const fmtDay = s => new Date(s + 'T12:00:00').toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });

const ICONS = {
  cart: 'shopping_cart', box: 'inventory_2', receipt: 'receipt_long', chart: 'bar_chart', plus: 'add', minus: 'remove',
  trash: 'delete', edit: 'edit', theme: 'contrast', check: 'check', logout: 'logout', people: 'group', store: 'storefront',
};
const mi = name => `<span class="mi">${name}</span>`;
const ico = n => mi(ICONS[n]);

const CATS = [
  { id: 'analgesicos', name: 'Analgésicos', icon: 'medication' },
  { id: 'gripa', name: 'Gripa y tos', icon: 'sick' },
  { id: 'digestivo', name: 'Digestivo', icon: 'medication_liquid' },
  { id: 'vitaminas', name: 'Vitaminas', icon: 'nutrition' },
  { id: 'derma', name: 'Dermatología', icon: 'spa' },
  { id: 'curacion', name: 'Curación', icon: 'healing' },
  { id: 'higiene', name: 'Higiene', icon: 'sanitizer' },
  { id: 'antibioticos', name: 'Antibióticos', icon: 'vaccines' },
];
const cat = id => CATS.find(c => c.id === id) || { name: 'Otros', icon: 'category' };

const SEED = () => {
  const P = (code, name, desc, category, price, stock, min, exp, rx = false) =>
    ({ code, name, desc, category, price, stock, min, expiry: exp == null ? '' : addDays(exp), rx });
  return [
    P('7501001', 'Paracetamol 500 mg', 'Caja con 20 tabletas', 'analgesicos', 38, 60, 15, 420),
    P('7501002', 'Ibuprofeno 400 mg', 'Caja con 10 cápsulas', 'analgesicos', 52, 44, 12, 25),
    P('7501003', 'Loratadina 10 mg', 'Caja con 10 tabletas', 'gripa', 45, 35, 10, 500),
    P('7501004', 'Jarabe para la tos', 'Frasco 120 ml', 'gripa', 89, 4, 6, 240),
    P('7501005', 'Omeprazol 20 mg', 'Caja con 14 cápsulas', 'digestivo', 68, 30, 8, 450),
    P('7501006', 'Vitamina C 1 g', 'Tubo con 10 efervescentes', 'vitaminas', 79, 33, 8, 270),
    P('7501007', 'Protector solar FPS 50', 'Frasco 120 ml', 'derma', 289, 9, 4, 480),
    P('7501008', 'Alcohol 70%', 'Botella 250 ml', 'curacion', 36, 50, 12, 800),
    P('7501009', 'Gel antibacterial', 'Botella 250 ml', 'higiene', 42, 48, 12, 600),
    P('7501010', 'Amoxicilina 500 mg', 'Caja con 12 cápsulas', 'antibioticos', 138, 20, 6, 360, true),
  ];
};

function expState(p) {
  if (!p.expiry) return { s: 'none', days: null };
  const days = Math.floor((new Date(p.expiry + 'T23:59:59') - new Date()) / 864e5);
  return { s: days < 0 ? 'expired' : days <= 60 ? 'soon' : 'ok', days };
}

let toastT;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2600);
}

/* ================= Tema ================= */
const THEMES = ['auto', 'light', 'dark'];
const THEME_LABEL = { auto: 'Auto', light: 'Claro', dark: 'Oscuro' };
let theme = 'auto';
try { theme = localStorage.getItem('pvf_theme') || 'auto'; } catch (e) {}
function applyTheme() {
  if (theme === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', theme);
  const l = $('#themeLabel'); if (l) l.textContent = THEME_LABEL[theme];
  try { localStorage.setItem('pvf_theme', theme); } catch (e) {}
}
applyTheme();

/* ================= Pantallas ================= */
function showScreen(name) {
  for (const id of ['boot', 'setup', 'auth', 'noprofile']) $('#' + id).classList.toggle('open', id === name);
  $('#app').style.display = name === 'app' ? 'flex' : 'none';
}

/* ================= Estado ================= */
const S = {
  user: null, profile: null,
  products: [], sales: [], users: [],
  profileUnsub: null, dataUnsubs: [], liveOk: true, firstProducts: true,
};
const isAdmin = () => S.profile?.role === 'admin';
const prod = id => S.products.find(p => p.id === id);

let app, auth, db, view = 'pos';
let cart = [];            // [{id, qty}]
let activeCat = 'all';
let method = 'Tarjeta';
let discount = 0;
let received = null;
let busy = false;

/* ================= Arranque + Auth ================= */
function start() {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);

  bindAuthForm();
  bindStaticEvents();

  onAuthStateChanged(auth, user => {
    stopAll();
    S.user = user; S.profile = null;
    if (!user) { showScreen('auth'); return; }
    showScreen('boot');
    const timer = setTimeout(() => { if (!S.profile) showScreen('noprofile'); }, 7000);
    S.profileUnsub = onSnapshot(doc(db, 'users', user.uid), snap => {
      if (!snap.exists()) return;
      const prevRole = S.profile?.role;
      S.profile = { id: snap.id, ...snap.data() };
      clearTimeout(timer);
      if (prevRole !== S.profile.role) startSession();
    }, () => showScreen('noprofile'));
  });
}

function stopAll() {
  S.profileUnsub?.(); S.profileUnsub = null;
  S.dataUnsubs.forEach(u => u()); S.dataUnsubs = [];
  S.products = []; S.sales = []; S.users = []; S.firstProducts = true;
  cart = []; received = null; discount = 0;
  delete document.body.dataset.role;
}

const toEmail = u => `${u.trim().toLowerCase()}@farmacia.app`;
const AUTH_ERR = {
  'auth/invalid-credential': 'Usuario o contraseña incorrectos',
  'auth/user-not-found': 'Usuario o contraseña incorrectos',
  'auth/wrong-password': 'Usuario o contraseña incorrectos',
  'auth/email-already-in-use': 'Ese nombre de usuario ya existe',
  'auth/weak-password': 'La contraseña debe tener al menos 6 caracteres',
  'auth/too-many-requests': 'Demasiados intentos, espera un momento',
  'auth/network-request-failed': 'Sin conexión con el servidor',
  'auth/operation-not-allowed': 'Activa "Correo/contraseña" en Firebase Authentication',
  'permission-denied': 'No tienes permiso para esta acción (revisa las reglas de Firestore)',
};
const authMsg = e => AUTH_ERR[e.code] || e.message || 'Ocurrió un error';
const validUser = u => /^[a-z0-9._-]{3,20}$/.test(u.trim().toLowerCase());

// Envuelve un campo de contraseña con un botón de ojo para mostrarla u ocultarla.
function attachPassToggle(input) {
  const wrap = document.createElement('span');
  wrap.className = 'pass-wrap';
  input.parentNode.insertBefore(wrap, input);
  wrap.appendChild(input);
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'pass-toggle';
  btn.title = 'Mostrar contraseña';
  btn.setAttribute('aria-label', 'Mostrar contraseña');
  btn.innerHTML = mi('visibility');
  btn.onclick = () => {
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    btn.innerHTML = mi(show ? 'visibility_off' : 'visibility');
    btn.title = btn.ariaLabel = show ? 'Ocultar contraseña' : 'Mostrar contraseña';
    input.focus();
  };
  wrap.appendChild(btn);
}

function bindAuthForm() {
  attachPassToggle($('#aPass'));
  let tab = 'login';
  const err = m => { const e = $('#authError'); e.textContent = m || ''; e.classList.toggle('show', !!m); };
  $$('#authTabs button').forEach(b => b.onclick = () => {
    tab = b.dataset.tab;
    $$('#authTabs button').forEach(x => x.classList.toggle('active', x === b));
    $('#nameField').style.display = tab === 'register' ? 'flex' : 'none';
    $('#authBtn').textContent = tab === 'register' ? 'Crear cuenta' : 'Entrar';
    $('#aPass').autocomplete = tab === 'register' ? 'new-password' : 'current-password';
    $('.auth-card .sub').textContent = tab === 'register' ? 'Crea tu cuenta de cliente' : 'Inicia sesión para continuar';
    err('');
  });
  $('#authForm').onsubmit = async e => {
    e.preventDefault(); err('');
    const user = $('#aUser').value, pass = $('#aPass').value, name = $('#aName').value.trim();
    if (!validUser(user)) return err('Usuario: 3 a 20 caracteres (letras, números, . _ -)');
    if (tab === 'register' && !name) return err('Escribe tu nombre');
    $('#authBtn').disabled = true;
    try {
      if (tab === 'login') {
        await signInWithEmailAndPassword(auth, toEmail(user), pass);
      } else {
        const cred = await createUserWithEmailAndPassword(auth, toEmail(user), pass);
        await setDoc(doc(db, 'users', cred.user.uid), {
          username: user.trim().toLowerCase(), name, role: 'cliente', createdAt: serverTimestamp(),
        });
      }
      $('#authForm').reset();
    } catch (ex) { err(authMsg(ex)); }
    $('#authBtn').disabled = false;
  };
  $('#noprofileOut').onclick = () => signOut(auth);
}

/* ================= Sesión (por rol) ================= */
function startSession() {
  S.dataUnsubs.forEach(u => u()); S.dataUnsubs = [];
  document.body.dataset.role = S.profile.role;
  method = isAdmin() ? 'Efectivo' : 'Tarjeta';
  cart = []; received = null; discount = 0; view = 'pos';
  buildNav(); buildMethod();
  $('#posTitle').textContent = isAdmin() ? 'Nueva venta' : 'Tienda';
  $('#cartTitle').textContent = isAdmin() ? 'Venta actual' : 'Tu pedido';
  $('#histTitle').textContent = isAdmin() ? 'Historial de ventas' : 'Mis compras';
  $('#rxText').textContent = isAdmin()
    ? 'Incluye medicamento con receta. Confirmo que la receta fue revisada.'
    : 'Mi pedido incluye medicamento con receta. Presentaré la receta al recoger.';
  $('#today').textContent = new Date().toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' });
  showScreen('app');
  listen();
  go('pos');
}

function listen() {
  const onErr = () => setLive(false);
  S.dataUnsubs.push(onSnapshot(collection(db, 'products'), snap => {
    S.products = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (!S.firstProducts && !snap.metadata.hasPendingWrites && snap.docChanges().length) toast('Inventario actualizado en vivo');
    S.firstProducts = false;
    setLive(true);
    reconcileCart();
    refresh();
  }, onErr));

  const salesQ = isAdmin()
    ? query(collection(db, 'sales'), orderBy('createdAt', 'desc'), limit(500))
    : query(collection(db, 'sales'), where('userId', '==', S.user.uid));
  S.dataUnsubs.push(onSnapshot(salesQ, snap => {
    S.sales = snap.docs.map(d => {
      const x = d.data();
      return { id: d.id, ...x, _d: x.createdAt?.toDate ? x.createdAt.toDate() : new Date() };
    }).sort((a, b) => b._d - a._d);
    refresh();
  }, onErr));

  if (isAdmin()) {
    S.dataUnsubs.push(onSnapshot(collection(db, 'users'), snap => {
      S.users = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'es'));
      refresh();
    }, onErr));
  }
}

function setLive(ok) {
  S.liveOk = ok;
  const l = $('#live'); if (l) { l.classList.toggle('off', !ok); l.lastChild.textContent = ok ? 'En vivo' : 'Sin conexión'; }
}

/* ================= Navegación ================= */
function buildNav() {
  const items = isAdmin()
    ? [['pos', 'cart', 'Venta'], ['inventory', 'box', 'Inventario'], ['history', 'receipt', 'Historial'], ['dashboard', 'chart', 'Resumen'], ['users', 'people', 'Usuarios']]
    : [['pos', 'store', 'Tienda'], ['history', 'receipt', 'Mis compras']];
  const initial = (S.profile.name || '?').trim()[0].toUpperCase();
  $('#nav').innerHTML = `
    <div class="brand">${mi('local_pharmacy')}</div>
    ${items.map(([v, i, l]) => `<button data-view="${v}">${ico(i)}${l}</button>`).join('')}
    <div class="spacer"></div>
    <div class="user-chip">
      <div class="avatar">${esc(initial)}</div>
      <div class="nm" title="${esc(S.profile.name)}">${esc(S.profile.name)}</div>
      <div class="badge ${isAdmin() ? 'rx' : ''}">${isAdmin() ? 'Admin' : 'Cliente'}</div>
      <div class="live" id="live"><i></i><span>En vivo</span></div>
    </div>
    <button id="themeBtn" title="Cambiar tema">${ico('theme')}<span id="themeLabel">${THEME_LABEL[theme]}</span></button>
    <button id="logoutBtn" title="Cerrar sesión">${ico('logout')}Salir</button>`;
  $$('#nav [data-view]').forEach(b => b.onclick = () => go(b.dataset.view));
  $('#themeBtn').onclick = () => { theme = THEMES[(THEMES.indexOf(theme) + 1) % 3]; applyTheme(); };
  $('#logoutBtn').onclick = () => signOut(auth);
}

function go(v) {
  view = v;
  $$('.view').forEach(s => s.classList.toggle('active', s.id === 'view-' + v));
  $$('#nav [data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === v));
  refresh();
}

function refresh() {
  if (!S.profile) return;
  if (view === 'pos') { renderChips(); renderGrid(); updateCart(); }
  else if (view === 'inventory') renderInventory();
  else if (view === 'history') renderHistory();
  else if (view === 'dashboard') renderDashboard();
  else if (view === 'users') renderUsers();
}

/* ================= Venta / Tienda ================= */
function buildMethod() {
  const opts = isAdmin() ? [['Efectivo', 'Efectivo'], ['Tarjeta', 'Tarjeta']] : [['Tarjeta', 'Tarjeta'], ['En tienda', 'Pagar en tienda']];
  $('#method').innerHTML = opts.map(([v, l]) => `<button data-m="${v}" class="${v === method ? 'active' : ''}">${l}</button>`).join('');
  $$('#method button').forEach(b => b.onclick = () => {
    method = b.dataset.m;
    $$('#method button').forEach(x => x.classList.toggle('active', x === b));
    updateCart();
  });
}

function renderChips() {
  const all = [{ id: 'all', name: 'Todo', icon: 'apps' }, ...CATS];
  $('#chips').innerHTML = all.map(c =>
    `<button class="chip ${activeCat === c.id ? 'active' : ''}" data-c="${c.id}">${mi(c.icon)}${c.name}</button>`).join('');
  $$('#chips .chip').forEach(b => b.onclick = () => { activeCat = b.dataset.c; renderChips(); renderGrid(); });
}

function filtered() {
  const q = norm($('#q').value.trim());
  return S.products.filter(p =>
    (activeCat === 'all' || p.category === activeCat) &&
    (!q || norm(p.name).includes(q) || norm(p.desc).includes(q) || String(p.code || '').includes(q)))
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

function renderGrid() {
  const list = filtered();
  if (!list.length) {
    $('#grid').innerHTML = `<div class="empty">${S.products.length ? 'No se encontraron productos' : 'Aún no hay productos en el inventario'}</div>`;
    return;
  }
  $('#grid').innerHTML = list.map(p => {
    const ex = expState(p);
    const inCart = cart.find(l => l.id === p.id)?.qty || 0;
    const out = p.stock - inCart <= 0 || ex.s === 'expired';
    const tags = [];
    if (p.rx) tags.push('<span class="badge rx">Receta</span>');
    if (ex.s === 'expired') tags.push('<span class="badge bad">Caducado</span>');
    else if (ex.s === 'soon' && isAdmin()) tags.push('<span class="badge warn">Caduca pronto</span>');
    const stockTxt = p.stock <= 0 ? 'Agotado' : isAdmin() ? `${p.stock} en stock` : p.stock <= p.min ? `Quedan ${p.stock}` : 'Disponible';
    return `<button class="product" ${out ? 'disabled' : ''} data-id="${p.id}">
      <div class="tags">${tags.join('')}</div>
      <div class="ico">${mi(cat(p.category).icon)}</div>
      <div class="name">${esc(p.name)}</div>
      <div class="desc">${esc(p.desc)}</div>
      <div class="foot"><span class="price num">${money(p.price)}</span>
        <span class="badge ${p.stock <= 0 ? 'bad' : p.stock <= p.min ? 'warn' : ''}">${stockTxt}</span></div>
    </button>`;
  }).join('');
  $$('#grid .product').forEach(b => b.onclick = () => addToCart(b.dataset.id));
}

function addToCart(id) {
  const p = prod(id); if (!p) return;
  if (expState(p).s === 'expired') return toast('Producto caducado, no se puede vender');
  const line = cart.find(l => l.id === id);
  if ((line ? line.qty : 0) + 1 > p.stock) return toast('No hay más existencias');
  if (line) line.qty++; else cart.push({ id, qty: 1 });
  updateCart(); renderGrid();
}
function setQty(id, d) {
  const line = cart.find(l => l.id === id); if (!line) return;
  const n = line.qty + d;
  if (n > prod(id).stock) return toast('No hay más existencias');
  if (n <= 0) cart = cart.filter(l => l.id !== id); else line.qty = n;
  updateCart(); renderGrid();
}

// Un cambio de inventario en vivo (otra compra, edición del admin) puede dejar el carrito fuera de existencias.
function reconcileCart() {
  let changed = false;
  cart = cart.filter(l => {
    const p = prod(l.id);
    if (!p) { changed = true; return false; }
    if (l.qty > p.stock) { l.qty = p.stock; changed = true; }
    return l.qty > 0;
  });
  if (changed) toast('Tu carrito se ajustó por cambios en el inventario');
}

function totals() {
  const sub = r2(cart.reduce((s, l) => s + l.qty * (prod(l.id)?.price || 0), 0));
  const pct = isAdmin() ? Math.min(100, Math.max(0, discount || 0)) : 0;
  const dAmt = r2(sub * pct / 100);
  return { sub, dAmt, total: r2(sub - dAmt), pct };
}
const cartHasRx = () => cart.some(l => prod(l.id)?.rx);

function updateCart() {
  if (!S.profile) return;
  const t = totals();
  $('#lines').innerHTML = cart.length ? cart.map(l => {
    const p = prod(l.id);
    return `<div class="line">
      <div><div class="nm">${esc(p.name)}</div><div class="cell-sub num">${money(p.price)} c/u</div></div>
      <div class="amt num">${money(p.price * l.qty)}</div>
      <div class="qty"><button data-d="-1" data-id="${p.id}">${ico('minus')}</button><span class="num">${l.qty}</span><button data-d="1" data-id="${p.id}">${ico('plus')}</button></div>
      <div style="text-align:right"><button class="icon-btn danger" data-rm="${p.id}" title="Quitar">${ico('trash')}</button></div>
    </div>`;
  }).join('') : `<div class="cart-empty">${isAdmin() ? 'Toca un producto para empezar' : 'Agrega productos a tu pedido'}</div>`;
  $$('#lines [data-d]').forEach(b => b.onclick = () => setQty(b.dataset.id, +b.dataset.d));
  $$('#lines [data-rm]').forEach(b => b.onclick = () => { cart = cart.filter(l => l.id !== b.dataset.rm); updateCart(); renderGrid(); });

  $('#sSub').textContent = money(t.sub);
  $('#sDisc').textContent = '−' + money(t.dAmt);
  $('#sTotal').textContent = money(t.total);

  const rx = cartHasRx();
  $('#rxBox').style.display = rx ? 'flex' : 'none';
  if (!rx) $('#rxOk').checked = false;

  const cash = isAdmin() && method === 'Efectivo';
  $('#cashBox').style.display = cash ? 'flex' : 'none';
  const opts = [...new Set([t.total, ...[50, 100, 200, 500, 1000].filter(v => v >= t.total)].filter(v => v > 0))].slice(0, 4);
  $('#quick').innerHTML = opts.map((v, i) => `<button data-v="${v}">${i === 0 ? 'Exacto' : money(v).replace('.00', '')}</button>`).join('');
  $$('#quick button').forEach(b => b.onclick = () => { received = +b.dataset.v; $('#received').value = received; updateCart(); });

  const change = r2((received || 0) - t.total);
  const ce = $('#sChange');
  ce.textContent = money(Math.max(change, 0));
  ce.classList.toggle('neg', received != null && change < 0);

  const payOk = !cash || (received != null && change >= 0);
  const rxOk = !rx || $('#rxOk').checked;
  $('#payBtn').disabled = busy || !(cart.length && payOk && rxOk);
  $('#payBtn').textContent = busy ? 'Procesando…' : cart.length ? `${isAdmin() ? 'Cobrar' : 'Pagar'} ${money(t.total)}` : isAdmin() ? 'Cobrar' : 'Pagar';
}

class SaleError extends Error {}

// La compra es una transacción de Firestore: lee el stock vigente, valida y descuenta en una sola operación atómica.
// Si otro usuario modifica el mismo producto mientras tanto, Firestore reintenta la transacción con datos frescos,
// por lo que dos compras simultáneas de la última pieza nunca pueden ganar las dos.
async function checkout() {
  if (busy || !cart.length) return;
  const lines = cart.map(l => ({ id: l.id, qty: l.qty }));
  const pct = totals().pct;
  const cash = isAdmin() && method === 'Efectivo';
  const recv = received;
  busy = true; updateCart();
  try {
    const sale = await runTransaction(db, async tx => {
      const counterRef = doc(db, 'counters', 'sales');
      const refs = lines.map(l => doc(db, 'products', l.id));
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

      const folio = (cSnap.exists() ? cSnap.data().last : 0) + 1;
      snaps.forEach((s, i) => tx.update(refs[i], { stock: s.data().stock - lines[i].qty, updatedAt: serverTimestamp() }));
      tx.set(counterRef, { last: folio });
      const saleRef = doc(collection(db, 'sales'));
      const data = {
        folio, items, subtotal: sub, discount: dAmt, total, method,
        received: cash ? recv : total, change: cash ? r2(recv - total) : 0,
        userId: S.user.uid, userName: S.profile.name, role: S.profile.role, createdAt: serverTimestamp(),
      };
      tx.set(saleRef, data);
      return { id: saleRef.id, ...data, _d: new Date() };
    });
    cart = []; received = null; discount = 0;
    $('#received').value = ''; $('#disc').value = 0;
    busy = false; updateCart(); renderGrid();
    showTicket(sale, true);
  } catch (ex) {
    busy = false;
    reconcileCart();
    toast(ex instanceof SaleError ? ex.message : AUTH_ERR[ex.code] || 'No se pudo completar la compra, intenta de nuevo');
    updateCart(); renderGrid();
  }
}

/* ================= Eventos estáticos ================= */
function bindStaticEvents() {
  $('#q').addEventListener('input', renderGrid);
  $('#q').addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    const q = $('#q').value.trim(); if (!q) return;
    const target = S.products.find(p => p.code === q) || filtered()[0];
    if (target) { addToCart(target.id); $('#q').value = ''; renderGrid(); }
    else toast('Producto no encontrado');
  });
  $('#disc').addEventListener('input', e => { discount = parseFloat(e.target.value) || 0; updateCart(); });
  $('#received').addEventListener('input', e => { received = e.target.value === '' ? null : parseFloat(e.target.value); updateCart(); });
  $('#rxOk').addEventListener('change', updateCart);
  $('#clearCart').onclick = () => { cart = []; received = null; $('#received').value = ''; updateCart(); renderGrid(); };
  $('#payBtn').onclick = checkout;
  $('#invQ').addEventListener('input', renderInventory);
  $('#newProduct').onclick = () => productForm();
  $('#newUser').onclick = userForm;
  $$('#histRange button').forEach(b => b.onclick = () => {
    histRange = b.dataset.r;
    $$('#histRange button').forEach(x => x.classList.toggle('active', x === b));
    renderHistory();
  });
  $('#overlay').addEventListener('mousedown', e => { if (e.target.id === 'overlay') closeModal(); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeModal();
    const typing = ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName);
    if (e.key === '/' && !typing && view === 'pos' && S.profile) { e.preventDefault(); $('#q').focus(); }
  });
}

/* ================= Modal / ticket ================= */
function openModal(html, printable = false) {
  $('#modal').innerHTML = html;
  $('#overlay').classList.add('open');
  $('#overlay').classList.toggle('print-target', printable);
  $$('#modal [data-close]').forEach(b => b.onclick = closeModal);
  $$('#modal [data-print]').forEach(b => b.onclick = () => window.print());
}
function closeModal() { $('#overlay').classList.remove('open'); }

function showTicket(s, fresh = false) {
  const folio = '#' + String(s.folio).padStart(4, '0');
  openModal(`
    ${fresh ? `<div class="check-anim no-print">${ico('check')}</div><h2 class="no-print" style="text-align:center">${isAdmin() ? 'Venta registrada' : 'Compra realizada'}</h2>` : ''}
    <div class="ticket">
      <div class="center t-title"><span class="t-logo">${mi('local_pharmacy')}${esc(STORE_NAME)}</span></div>
      <div class="center muted">Ticket ${folio}<br>${fmtDate(s._d)}${s.userName ? `<br>${esc(s.userName)}` : ''}</div>
      <hr>
      ${s.items.map(i => `<div class="t-row"><span>${i.qty} × ${esc(i.name)}</span><span>${money(i.qty * i.price)}</span></div>`).join('')}
      <hr>
      <div class="t-row"><span>Subtotal</span><span>${money(s.subtotal)}</span></div>
      ${s.discount ? `<div class="t-row"><span>Descuento</span><span>−${money(s.discount)}</span></div>` : ''}
      <div class="t-row t-total"><span>Total</span><span>${money(s.total)}</span></div>
      <hr>
      <div class="t-row"><span>Pago</span><span>${esc(s.method)}</span></div>
      ${s.method === 'Efectivo' ? `<div class="t-row"><span>Recibido</span><span>${money(s.received)}</span></div><div class="t-row"><span>Cambio</span><span>${money(s.change)}</span></div>` : ''}
      <hr>
      <div class="center">¡Gracias por su compra!</div>
    </div>
    <div class="modal-actions no-print">
      <button class="btn" data-print>Imprimir</button>
      <button class="btn primary" data-close>Listo</button>
    </div>`, true);
}

/* ================= Inventario (admin) ================= */
function renderInventory() {
  if (!isAdmin()) return;
  const q = norm($('#invQ').value.trim());
  const list = S.products
    .filter(p => !q || norm(p.name).includes(q) || String(p.code || '').includes(q) || norm(cat(p.category).name).includes(q))
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));
  const low = S.products.filter(p => p.stock <= p.min).length;
  $('#invSub').textContent = `${S.products.length} productos · ${low} con pocas existencias`;
  $('#invBody').innerHTML = list.map(p => {
    const ex = expState(p);
    const exBadge = ex.s === 'expired' ? '<span class="badge bad">Caducado</span>'
      : ex.s === 'soon' ? `<span class="badge warn">${ex.days} días</span>`
      : ex.s === 'ok' ? `<span class="muted">${fmtDay(p.expiry)}</span>` : '<span class="muted">—</span>';
    const stockBadge = p.stock <= 0 ? 'bad' : p.stock <= p.min ? 'warn' : 'ok';
    return `<tr>
      <td><div class="cell-name">${esc(p.name)} ${p.rx ? '<span class="badge rx">Receta</span>' : ''}</div><div class="cell-sub">${esc(p.desc)} · ${esc(p.code)}</div></td>
      <td><span class="cat-cell">${mi(cat(p.category).icon)}${cat(p.category).name}</span></td>
      <td class="r num">${money(p.price)}</td>
      <td class="r"><span class="badge ${stockBadge} num">${p.stock}</span></td>
      <td>${exBadge}</td>
      <td class="r" style="white-space:nowrap">
        <button class="icon-btn" data-edit="${p.id}" title="Editar">${ico('edit')}</button>
        <button class="icon-btn danger" data-del="${p.id}" title="Eliminar">${ico('trash')}</button>
      </td></tr>`;
  }).join('') || `<tr><td colspan="6" style="text-align:center;padding:40px" class="muted">
      ${S.products.length ? 'Sin resultados' : 'El inventario está vacío.<br><br><button class="btn primary" id="loadSeed">Cargar 10 productos de ejemplo</button>'}</td></tr>`;
  $$('#invBody [data-edit]').forEach(b => b.onclick = () => productForm(b.dataset.edit));
  $$('#invBody [data-del]').forEach(b => b.onclick = async () => {
    const p = prod(b.dataset.del);
    if (!confirm(`¿Eliminar "${p.name}" del inventario?`)) return;
    try { await deleteDoc(doc(db, 'products', p.id)); toast('Producto eliminado'); }
    catch (ex) { toast(AUTH_ERR[ex.code] || 'No se pudo eliminar'); }
  });
  const seedBtn = $('#loadSeed');
  if (seedBtn) seedBtn.onclick = async () => {
    seedBtn.disabled = true;
    const batch = writeBatch(db);
    SEED().forEach(p => batch.set(doc(collection(db, 'products')), { ...p, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
    try { await batch.commit(); toast('Productos cargados'); } catch (ex) { toast(AUTH_ERR[ex.code] || 'No se pudo cargar'); seedBtn.disabled = false; }
  };
}

function productForm(id) {
  const p = id ? prod(id) : { code: '', name: '', desc: '', category: CATS[0].id, price: '', stock: 0, min: 5, expiry: '', rx: false };
  openModal(`
    <h2>${id ? 'Editar producto' : 'Nuevo producto'}</h2>
    <form class="form" id="pform">
      <label class="full">Nombre<input name="name" required value="${esc(p.name)}" placeholder="Ej. Paracetamol 500 mg"></label>
      <label class="full">Presentación<input name="desc" value="${esc(p.desc)}" placeholder="Ej. Caja con 20 tabletas"></label>
      <label>Código de barras<input name="code" value="${esc(p.code)}"></label>
      <label>Categoría<select name="category">${CATS.map(c => `<option value="${c.id}" ${c.id === p.category ? 'selected' : ''}>${c.name}</option>`).join('')}</select></label>
      <label>Precio<input name="price" type="number" min="0" step="0.01" required value="${p.price}"></label>
      <label>Existencia<input name="stock" type="number" min="0" step="1" required value="${p.stock}"></label>
      <label>Mínimo<input name="min" type="number" min="0" step="1" value="${p.min}"></label>
      <label>Caducidad<input name="expiry" type="date" value="${p.expiry}"></label>
      <label class="full check"><input name="rx" type="checkbox" ${p.rx ? 'checked' : ''}>Requiere receta médica</label>
      <div class="full modal-actions">
        <button type="button" class="btn" data-close>Cancelar</button>
        <button class="btn primary">Guardar</button>
      </div>
    </form>`);
  $('#pform').onsubmit = async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    const data = {
      name: f.get('name').trim(), desc: f.get('desc').trim(), code: f.get('code').trim(),
      category: f.get('category'), price: r2(parseFloat(f.get('price')) || 0),
      min: parseInt(f.get('min')) || 0, expiry: f.get('expiry') || '', rx: f.get('rx') === 'on',
      updatedAt: serverTimestamp(),
    };
    const stock = parseInt(f.get('stock')) || 0;
    if (!data.name) return;
    try {
      if (id) {
        // La existencia se ajusta con increment(delta): si mientras editabas hubo ventas, no se pisan.
        await updateDoc(doc(db, 'products', id), { ...data, stock: increment(stock - p.stock) });
      } else {
        await addDoc(collection(db, 'products'), { ...data, stock, createdAt: serverTimestamp() });
      }
      closeModal(); toast(id ? 'Producto actualizado' : 'Producto agregado');
    } catch (ex) { toast(AUTH_ERR[ex.code] || 'No se pudo guardar'); }
  };
}

/* ================= Historial ================= */
let histRange = 'today';
function renderHistory() {
  const now = new Date(); const today = dayKey(now);
  const wkd = new Date(now); wkd.setDate(wkd.getDate() - 6); const wk = dayKey(wkd);
  const list = S.sales.filter(s => {
    const k = dayKey(s._d);
    return histRange === 'all' || (histRange === 'today' ? k === today : k >= wk);
  });
  const total = list.reduce((s, x) => s + x.total, 0);
  $('#histSub').textContent = `${list.length} ${isAdmin() ? 'ventas' : 'compras'} · ${money(total)}`;
  const cols = isAdmin() ? 6 : 5;
  $('#histBody').innerHTML = list.map(s => {
    const names = s.items.map(i => i.name).join(', ');
    return `<tr class="click" data-id="${s.id}">
      <td class="cell-name">#${String(s.folio).padStart(4, '0')}</td>
      <td>${fmtDate(s._d)}</td>
      <td class="admin-only">${esc(s.userName || '—')}</td>
      <td class="muted">${s.items.reduce((n, i) => n + i.qty, 0)} pzs · ${esc(names.slice(0, 60))}${names.length > 60 ? '…' : ''}</td>
      <td><span class="badge">${esc(s.method)}</span></td>
      <td class="r num cell-name">${money(s.total)}</td>
    </tr>`;
  }).join('') || `<tr><td colspan="${cols}" class="muted" style="text-align:center;padding:40px">Aún no hay registros en este periodo</td></tr>`;
  $$('#histBody tr[data-id]').forEach(r => r.onclick = () => showTicket(S.sales.find(s => s.id === r.dataset.id)));
}

/* ================= Resumen (admin) ================= */
function renderDashboard() {
  if (!isAdmin()) return;
  const today = dayKey(new Date());
  const todaySales = S.sales.filter(s => dayKey(s._d) === today);
  const total = todaySales.reduce((s, x) => s + x.total, 0);
  const pieces = todaySales.reduce((n, s) => n + s.items.reduce((m, i) => m + i.qty, 0), 0);
  const low = S.products.filter(p => p.stock <= p.min);
  const exp = S.products.filter(p => ['soon', 'expired'].includes(expState(p).s));
  $('#tiles').innerHTML = [
    ['Ventas de hoy', money(total)],
    ['Tickets', todaySales.length],
    ['Ticket promedio', money(todaySales.length ? total / todaySales.length : 0)],
    ['Piezas vendidas', pieces],
  ].map(([l, v]) => `<div class="card tile"><div class="label">${l}</div><div class="value num">${v}</div></div>`).join('');

  const days = [...Array(7)].map((_, i) => { const d = new Date(); d.setDate(d.getDate() - (6 - i)); return d; });
  const sums = days.map(d => S.sales.filter(s => dayKey(s._d) === dayKey(d)).reduce((a, s) => a + s.total, 0));
  const max = Math.max(...sums, 1);
  $('#bars').innerHTML = days.map((d, i) => `
    <div class="bar ${i === 6 ? 'today' : ''}">
      <span class="v num">${sums[i] ? '$' + Math.round(sums[i]) : ''}</span>
      <div class="fill" style="height:${Math.max(sums[i] / max * 100 * .78, 2)}%"></div>
      <span class="d">${d.toLocaleDateString('es-MX', { weekday: 'short' }).replace('.', '')}</span>
    </div>`).join('');

  const wk = dayKey(days[0]);
  const counts = {};
  S.sales.filter(s => dayKey(s._d) >= wk).forEach(s => s.items.forEach(i => {
    counts[i.name] = counts[i.name] || { qty: 0, amt: 0 };
    counts[i.name].qty += i.qty; counts[i.name].amt += i.qty * i.price;
  }));
  const top = Object.entries(counts).sort((a, b) => b[1].qty - a[1].qty).slice(0, 5);
  $('#top').innerHTML = top.map(([n, v], i) => `
    <div class="list-item"><span><span class="muted num">${i + 1}</span>&nbsp;&nbsp;${esc(n)}</span>
    <span class="num"><b>${v.qty}</b> <span class="muted">pzs · ${money(v.amt)}</span></span></div>`).join('')
    || '<div class="muted" style="padding:20px 0">Sin ventas en el periodo</div>';

  $('#low').innerHTML = low.sort((a, b) => a.stock - b.stock).slice(0, 6).map(p => `
    <div class="list-item"><span>${esc(p.name)}<div class="cell-sub">${esc(p.desc)}</div></span>
    <span class="badge ${p.stock <= 0 ? 'bad' : 'warn'}">${p.stock} / mín. ${p.min}</span></div>`).join('')
    || '<div class="muted" style="padding:20px 0">Todo en orden</div>';

  $('#expiring').innerHTML = exp.sort((a, b) => a.expiry.localeCompare(b.expiry)).slice(0, 6).map(p => {
    const e = expState(p);
    return `<div class="list-item"><span>${esc(p.name)}<div class="cell-sub">${fmtDay(p.expiry)}</div></span>
      <span class="badge ${e.s === 'expired' ? 'bad' : 'warn'}">${e.s === 'expired' ? 'Caducado' : e.days + ' días'}</span></div>`;
  }).join('') || '<div class="muted" style="padding:20px 0">Nada por caducar</div>';
}

/* ================= Usuarios (admin) ================= */
function renderUsers() {
  if (!isAdmin()) return;
  $('#usersSub').textContent = `${S.users.length} usuarios · ${S.users.filter(u => u.role === 'admin').length} administradores`;
  $('#usersBody').innerHTML = S.users.map(u => `
    <tr>
      <td class="cell-name">${esc(u.name)} ${u.id === S.user.uid ? '<span class="badge">Tú</span>' : ''}</td>
      <td class="muted">${esc(u.username)}</td>
      <td class="muted">${u.createdAt?.toDate ? fmtDate(u.createdAt.toDate()) : '—'}</td>
      <td><select class="role-select" data-uid="${u.id}" ${u.id === S.user.uid ? 'disabled title="No puedes cambiar tu propio rol"' : ''}>
        <option value="cliente" ${u.role === 'cliente' ? 'selected' : ''}>Cliente</option>
        <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Administrador</option>
      </select></td>
    </tr>`).join('') || '<tr><td colspan="4" class="muted" style="text-align:center;padding:40px">Sin usuarios</td></tr>';
  $$('#usersBody .role-select').forEach(s => s.onchange = async () => {
    try { await updateDoc(doc(db, 'users', s.dataset.uid), { role: s.value }); toast('Rol actualizado'); }
    catch (ex) { toast(AUTH_ERR[ex.code] || 'No se pudo cambiar el rol'); renderUsers(); }
  });
}

let secondaryAuth = null;
function userForm() {
  openModal(`
    <h2>Nuevo usuario</h2>
    <form class="form" id="uform">
      <label class="full">Nombre<input name="name" required placeholder="Nombre completo"></label>
      <label>Usuario<input name="username" required autocapitalize="none" spellcheck="false" placeholder="usuario"></label>
      <label>Contraseña<input name="password" type="password" required minlength="6" placeholder="Mínimo 6"></label>
      <label class="full">Rol<select name="role"><option value="cliente">Cliente</option><option value="admin">Administrador</option></select></label>
      <div class="auth-error full" id="uerr"></div>
      <div class="full modal-actions">
        <button type="button" class="btn" data-close>Cancelar</button>
        <button class="btn primary">Crear</button>
      </div>
    </form>`);
  attachPassToggle($('#uform [name="password"]'));
  $('#uform').onsubmit = async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    const username = f.get('username').trim().toLowerCase();
    const err = m => { const x = $('#uerr'); x.textContent = m; x.classList.add('show'); };
    if (!validUser(username)) return err('Usuario: 3 a 20 caracteres (letras, números, . _ -)');
    const btn = e.submitter; btn.disabled = true;
    try {
      // Una segunda instancia de Firebase crea la cuenta sin cerrar la sesión del administrador.
      if (!secondaryAuth) secondaryAuth = getAuth(initializeApp(firebaseConfig, 'secondary'));
      const cred = await createUserWithEmailAndPassword(secondaryAuth, toEmail(username), f.get('password'));
      await setDoc(doc(db, 'users', cred.user.uid), {
        username, name: f.get('name').trim(), role: f.get('role'), createdAt: serverTimestamp(),
      });
      await signOut(secondaryAuth);
      closeModal(); toast('Usuario creado');
    } catch (ex) { err(authMsg(ex)); btn.disabled = false; }
  };
}

/* ================= Inicio ================= */
const configured = firebaseConfig.apiKey && !String(firebaseConfig.apiKey).startsWith('TU_');
if (configured) start(); else showScreen('setup');
