/* ============================================================
   PrintControl — app.js
   Firebase Auth + Firestore · un usuario = sus propios datos
   ============================================================ */

import { initializeApp }                        from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth, createUserWithEmailAndPassword,
         signInWithEmailAndPassword, signOut,
         onAuthStateChanged }                   from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { getFirestore, collection, doc,
         addDoc, setDoc, updateDoc, deleteDoc,
         getDocs, onSnapshot, query, orderBy }  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

// ============ FIREBASE CONFIG ============

const firebaseConfig = {
  apiKey:            'AIzaSyCscW8GmWeFverwZmUH9Vdw0co_XIf-Fmk',
  authDomain:        'tatu3d-cd25b.firebaseapp.com',
  projectId:         'tatu3d-cd25b',
  storageBucket:     'tatu3d-cd25b.firebasestorage.app',
  messagingSenderId: '897677948498',
  appId:             '1:897677948498:web:bf4a444f7f3c263bb9518b',
  measurementId:     'G-403KW950LE'
};

const firebaseApp = initializeApp(firebaseConfig);
const auth        = getAuth(firebaseApp);
const db          = getFirestore(firebaseApp);

// ============ ESTADO GLOBAL ============

let currentUser   = null;
let currentView   = 'dashboard';
let editingId     = null;
let editingMatId  = null;
let editingGastoId= null;

// Cache local (se llena desde Firestore)
let DB = { pedidos: [], materiales: [], gastos: [] };

// Suscripciones en tiempo real
let unsubPedidos   = null;
let unsubMateriales= null;
let unsubGastos    = null;

// ============ HELPERS FIRESTORE ============

function userCol(col) {
  // Ruta: users/{uid}/{col}
  return collection(db, 'users', currentUser.uid, col);
}

function userDoc(col, id) {
  return doc(db, 'users', currentUser.uid, col, id);
}

// ============ AUTH STATE ============

onAuthStateChanged(auth, user => {
  if (user) {
    currentUser = user;
    showApp();
    subscribeAll();
  } else {
    currentUser = null;
    unsubscribeAll();
    showLogin();
  }
});

// ============ SUSCRIPCIONES TIEMPO REAL ============

function subscribeAll() {
  // Pedidos
  unsubPedidos = onSnapshot(query(userCol('pedidos'), orderBy('fecha', 'desc')), snap => {
    DB.pedidos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    refreshAll();
  });
  // Materiales
  unsubMateriales = onSnapshot(userCol('materiales'), snap => {
    DB.materiales = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (currentView === 'materiales') renderMateriales();
  });
  // Gastos
  unsubGastos = onSnapshot(query(userCol('gastos'), orderBy('fecha', 'desc')), snap => {
    DB.gastos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (currentView === 'gastos') renderGastos();
    renderMetrics();
  });
}

function unsubscribeAll() {
  if (unsubPedidos)    { unsubPedidos();    unsubPedidos    = null; }
  if (unsubMateriales) { unsubMateriales(); unsubMateriales = null; }
  if (unsubGastos)     { unsubGastos();     unsubGastos     = null; }
  DB = { pedidos: [], materiales: [], gastos: [] };
}

// ============ MOSTRAR/OCULTAR PANTALLAS ============

function showLogin() {
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('app-screen').style.display   = 'none';
}

function showApp() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app-screen').style.display   = 'block';
  document.getElementById('user-email').textContent     = currentUser.email;
  const NOW = new Date();
  document.getElementById('topbar-date').textContent =
    NOW.toLocaleDateString('es-AR', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
}

// ============ AUTH: LOGIN / REGISTER / LOGOUT ============

async function handleLogin() {
  const email = document.getElementById('auth-email').value.trim();
  const pass  = document.getElementById('auth-pass').value;
  setAuthError('');
  try {
    await signInWithEmailAndPassword(auth, email, pass);
  } catch(e) {
    setAuthError(authMsg(e.code));
  }
}

async function handleRegister() {
  const email = document.getElementById('auth-email').value.trim();
  const pass  = document.getElementById('auth-pass').value;
  setAuthError('');
  if (pass.length < 6) { setAuthError('La contraseña debe tener al menos 6 caracteres.'); return; }
  try {
    await createUserWithEmailAndPassword(auth, email, pass);
  } catch(e) {
    setAuthError(authMsg(e.code));
  }
}

async function handleLogout() {
  await signOut(auth);
}

function setAuthError(msg) {
  document.getElementById('auth-error').textContent = msg;
}

function authMsg(code) {
  const map = {
    'auth/user-not-found':      'No existe una cuenta con ese email.',
    'auth/wrong-password':      'Contraseña incorrecta.',
    'auth/email-already-in-use':'Ese email ya está registrado.',
    'auth/invalid-email':       'Email inválido.',
    'auth/too-many-requests':   'Demasiados intentos. Esperá un momento.',
    'auth/invalid-credential':  'Email o contraseña incorrectos.',
  };
  return map[code] || 'Error: ' + code;
}

// Enter en los campos de login
document.getElementById('auth-pass').addEventListener('keydown', e => {
  if (e.key === 'Enter') handleLogin();
});

// Exponer al HTML
window.handleLogin    = handleLogin;
window.handleRegister = handleRegister;
window.handleLogout   = handleLogout;

// ============ NAVEGACIÓN ============

function setView(v) {
  document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  document.getElementById('view-' + v).classList.add('active');
  event.currentTarget.classList.add('active');
  currentView = v;

  const titles = {
    dashboard:   'Dashboard',
    pedidos:     'Pedidos activos',
    historial:   'Historial de pedidos',
    materiales:  'Inventario de materiales',
    gastos:      'Gastos variables',
    calculadora: 'Calculadora de precios'
  };
  document.getElementById('topbar-title').textContent = titles[v];

  if (v === 'pedidos')    renderCalendar();
  if (v === 'historial')  renderHistorial();
  if (v === 'materiales') renderMateriales();
  if (v === 'gastos')     renderGastos();
}
window.setView = setView;

// ============ FECHA ============

function daysUntil(dateStr) {
  const d     = new Date(dateStr + 'T00:00:00');
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.floor((d - today) / 86400000);
}

// ============ GASTOS: helpers ============

function calcularGastosMes(refDate) {
  const monthStart = new Date(refDate.getFullYear(), refDate.getMonth(), 1);
  const monthEnd   = new Date(refDate.getFullYear(), refDate.getMonth() + 1, 0);

  const puntuales = DB.gastos
    .filter(g => !g.recurrente && new Date(g.fecha) >= monthStart && new Date(g.fecha) <= monthEnd)
    .reduce((s, g) => s + g.monto, 0);

  const recurrentes = DB.gastos
    .filter(g => g.recurrente)
    .reduce((s, g) => s + g.monto, 0);

  return puntuales + recurrentes;
}

// ============ MÉTRICAS ============

function renderMetrics() {
  const today      = new Date();
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

  const entregados    = DB.pedidos.filter(p => p.estado === 'Entregado');
  const activos       = DB.pedidos.filter(p => p.estado !== 'Entregado' && p.estado !== 'Cancelado');
  const totalIngresos = entregados.reduce((s, p) => s + (p.precio - p.costo), 0);
  const mesIngresos   = entregados
    .filter(p => new Date(p.fecha) >= monthStart)
    .reduce((s, p) => s + (p.precio - p.costo), 0);
  const gastosMes     = calcularGastosMes(today);
  const mesNeto       = mesIngresos - gastosMes;
  const urgentes      = activos.filter(p => daysUntil(p.fecha) <= 2).length;

  document.getElementById('metrics-container').innerHTML = `
    <div class="metric-card">
      <div class="metric-label">Ingresos totales</div>
      <div class="metric-value" style="color:var(--green)">$${totalIngresos.toLocaleString('es-AR')}</div>
      <div class="metric-delta delta-up">↑ Acumulado</div>
    </div>
    <div class="metric-card">
      <div class="metric-label">Neto este mes</div>
      <div class="metric-value" style="color:${mesNeto>=0?'var(--green)':'var(--red)'}">$${mesNeto.toLocaleString('es-AR')}</div>
      <div class="metric-delta" style="color:var(--text3)">Ingresos − gastos</div>
    </div>
    <div class="metric-card">
      <div class="metric-label">Gastos del mes</div>
      <div class="metric-value" style="color:var(--amber)">$${gastosMes.toLocaleString('es-AR')}</div>
      <div class="metric-delta" style="color:var(--text3)">${today.toLocaleString('es-AR',{month:'long'})}</div>
    </div>
    <div class="metric-card">
      <div class="metric-label">Pedidos activos</div>
      <div class="metric-value" style="color:var(--accent)">${activos.length}</div>
      <div class="metric-delta" style="color:${urgentes>0?'var(--red)':'var(--text3)'}">
        ${urgentes > 0 ? `⚠ ${urgentes} urgente${urgentes>1?'s':''}` : `${activos.filter(p=>p.estado==='Imprimiendo').length} imprimiendo`}
      </div>
    </div>
  `;

  const badge = document.getElementById('badge-urgentes');
  if (urgentes > 0) { badge.style.display = 'inline'; badge.textContent = urgentes; }
  else              { badge.style.display = 'none'; }
}

// ============ GRÁFICO TORTA ============

let pieChart;
let currentPeriod = 'semana';

function getPeriodPedidos(period) {
  const today = new Date(); today.setHours(23, 59, 59);
  const start = new Date();
  if      (period === 'semana') start.setDate(today.getDate() - 7);
  else if (period === 'mes')    start.setDate(1);
  else                          start.setMonth(0, 1);
  return DB.pedidos.filter(p =>
    p.estado === 'Entregado' && new Date(p.fecha) >= start && new Date(p.fecha) <= today
  );
}

function renderPieChart(period) {
  const pedidos = getPeriodPedidos(period);
  const byMat   = {};
  pedidos.forEach(p => {
    if (!byMat[p.material]) byMat[p.material] = 0;
    byMat[p.material] += p.precio - p.costo;
  });
  const labels = Object.keys(byMat);
  const values = Object.values(byMat);
  const colors = ['#7c6dfa','#3dd68c','#38bdf8','#f5a623','#f05252','#e879f9'];
  const legend = document.getElementById('pie-legend');

  if (!labels.length) {
    legend.innerHTML = '<div style="color:var(--text3);font-size:13px">Sin datos en este período</div>';
    if (pieChart) { pieChart.data.labels=[]; pieChart.data.datasets[0].data=[]; pieChart.update(); }
    return;
  }
  legend.innerHTML = labels.map((l, i) => `
    <div class="legend-item">
      <div class="legend-dot" style="background:${colors[i%colors.length]}"></div>
      <span class="legend-name">${l}</span>
      <span class="legend-val">$${values[i].toLocaleString('es-AR')}</span>
    </div>`).join('');

  const ctx = document.getElementById('pieChart').getContext('2d');
  if (pieChart) pieChart.destroy();
  pieChart = new Chart(ctx, {
    type: 'doughnut',
    data: { labels, datasets: [{ data: values, backgroundColor: colors.slice(0, labels.length), borderWidth: 0, hoverOffset: 4 }] },
    options: {
      cutout: '65%',
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ` $${c.parsed.toLocaleString('es-AR')}` } } },
      animation: { animateRotate: true, duration: 500 }
    }
  });
}

function setPeriod(p, btn) {
  currentPeriod = p;
  document.querySelectorAll('#view-dashboard .period-selector:first-of-type .period-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderPieChart(p);
}
window.setPeriod = setPeriod;

// ============ GRÁFICO LÍNEA ============

let lineChart;
let currentLinePeriod = 'semana';

function getLineData(period) {
  if (period === 'semana') {
    const days = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
    const today = new Date();
    const labels = [], data = [];
    for (let i = 6; i >= 0; i--) {
      const d  = new Date(today); d.setDate(today.getDate() - i);
      const ds = d.toISOString().slice(0, 10);
      labels.push(days[d.getDay()]);
      data.push(DB.pedidos.filter(p => p.estado === 'Entregado' && p.fecha === ds).reduce((s,p)=>s+p.precio-p.costo,0));
    }
    return { labels, data };
  } else {
    const today = new Date();
    const labels = [], data = [];
    for (let i = 3; i >= 0; i--) {
      const w  = new Date(today); w.setDate(today.getDate() - i*7);
      const ws = new Date(w);     ws.setDate(w.getDate() - 6);
      labels.push(`Sem ${4-i}`);
      data.push(DB.pedidos.filter(p => { const fd = new Date(p.fecha); return p.estado==='Entregado' && fd>=ws && fd<=w; }).reduce((s,p)=>s+p.precio-p.costo,0));
    }
    return { labels, data };
  }
}

function renderLineChart(period) {
  const { labels, data } = getLineData(period);
  const ctx = document.getElementById('lineChart').getContext('2d');
  if (lineChart) lineChart.destroy();
  lineChart = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets: [{ data, borderColor:'#7c6dfa', backgroundColor:'rgba(124,109,250,0.08)', borderWidth:2, fill:true, tension:0.4, pointBackgroundColor:'#7c6dfa', pointRadius:4 }] },
    options: {
      plugins: { legend:{display:false}, tooltip:{callbacks:{label:c=>` $${c.parsed.y.toLocaleString('es-AR')}`}} },
      scales: {
        x: { grid:{color:'#2a2a32'}, ticks:{color:'#9896a0',font:{size:11}} },
        y: { grid:{color:'#2a2a32'}, ticks:{color:'#9896a0',font:{size:11},callback:v=>'$'+v.toLocaleString('es-AR')} }
      },
      animation: { duration:400 }
    }
  });
}

function setLinePeriod(p, btn) {
  currentLinePeriod = p;
  document.querySelectorAll('#view-dashboard .card:nth-child(2) .period-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  renderLineChart(p);
}
window.setLinePeriod = setLinePeriod;

// ============ PRÓXIMOS VENCIMIENTOS ============

function renderUpcoming() {
  const activos = DB.pedidos.filter(p=>p.estado!=='Entregado'&&p.estado!=='Cancelado').sort((a,b)=>new Date(a.fecha)-new Date(b.fecha)).slice(0,4);
  const ul = document.getElementById('upcoming-list');
  if (!activos.length) { ul.innerHTML='<div style="color:var(--text3);font-size:13px;padding:8px">Sin pedidos activos</div>'; return; }
  ul.innerHTML = activos.map(p => {
    const d=daysUntil(p.fecha), cls=d<=1?'urgente':d<=4?'proximo':'ok', av=d<=1?'av-red':d<=4?'av-amber':'av-green';
    const fCls=d<=1?'fecha-urgente':d<=4?'fecha-proximo':'fecha-ok';
    const label=d<0?`${Math.abs(d)}d vencido`:d===0?'Hoy':d===1?'Mañana':`${d} días`;
    const ini=p.cliente.split(' ').map(x=>x[0]).join('').slice(0,2).toUpperCase();
    return `<div class="pedido-card ${cls}" onclick="editPedido('${p.id}')">
      <div class="pedido-avatar ${av}">${ini}</div>
      <div class="pedido-info">
        <div class="pedido-nombre">${p.cliente}</div>
        <div class="pedido-meta"><span>${p.material} · ${p.color}</span><span>${(p.stl||'').split('/').pop()}</span></div>
      </div>
      <span class="pedido-fecha ${fCls}">${label}</span>
      <span class="pedido-precio">$${(p.precio-p.costo).toLocaleString('es-AR')}</span>
    </div>`;
  }).join('');
}

// ============ CALENDARIO ============

let calDate = new Date();

function renderCalendar() {
  const months=['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  document.getElementById('cal-month-title').textContent=`${months[calDate.getMonth()]} ${calDate.getFullYear()}`;
  const headers=document.getElementById('cal-headers');
  headers.innerHTML=['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'].map(d=>`<div class="cal-header">${d}</div>`).join('');
  const first=new Date(calDate.getFullYear(),calDate.getMonth(),1);
  const last=new Date(calDate.getFullYear(),calDate.getMonth()+1,0);
  const startDay=first.getDay();
  const today=new Date(); today.setHours(0,0,0,0);
  const grid=document.getElementById('calendar-grid');
  let html='';
  for(let i=0;i<startDay;i++){const d=new Date(first);d.setDate(d.getDate()-(startDay-i));html+=`<div class="cal-day other-month"><span>${d.getDate()}</span></div>`;}
  for(let d=1;d<=last.getDate();d++){
    const thisDate=new Date(calDate.getFullYear(),calDate.getMonth(),d);
    const dateStr=thisDate.toISOString().slice(0,10);
    const isToday=thisDate.getTime()===today.getTime();
    const pedidosDay=DB.pedidos.filter(p=>p.fecha===dateStr&&p.estado!=='Entregado'&&p.estado!=='Cancelado');
    const urgent=pedidosDay.some(p=>daysUntil(p.fecha)<=1);
    const dots=pedidosDay.map(p=>{const dd=daysUntil(p.fecha);const c=dd<=1?'var(--red)':dd<=4?'var(--amber)':'var(--green)';return`<div class="cal-dot" style="background:${c}"></div>`;}).join('');
    html+=`<div class="cal-day${isToday?' today':''}${pedidosDay.length?' has-order':''}${urgent?' urgent':''}"><span>${d}</span><div class="cal-dots">${dots}</div></div>`;
  }
  grid.innerHTML=html;
  renderActivePedidos();
  renderAlertBanner();
}

function changeMonth(dir){calDate.setMonth(calDate.getMonth()+dir);renderCalendar();}
window.changeMonth=changeMonth;

function renderActivePedidos(){
  const activos=DB.pedidos.filter(p=>p.estado!=='Entregado'&&p.estado!=='Cancelado').sort((a,b)=>new Date(a.fecha)-new Date(b.fecha));
  const list=document.getElementById('active-pedidos');
  if(!activos.length){list.innerHTML='<div style="color:var(--text3);font-size:13px;padding:8px">Sin pedidos activos</div>';return;}
  list.innerHTML=activos.map(p=>{
    const d=daysUntil(p.fecha),cls=d<=1?'urgente':d<=4?'proximo':'ok',av=d<=1?'av-red':d<=4?'av-amber':'av-green';
    const fCls=d<=1?'fecha-urgente':d<=4?'fecha-proximo':'fecha-ok';
    const label=d<0?`${Math.abs(d)}d vencido`:d===0?'Hoy':d===1?'Mañana':`${d} días`;
    const ini=p.cliente.split(' ').map(x=>x[0]).join('').slice(0,2).toUpperCase();
    return`<div class="pedido-card ${cls}" onclick="editPedido('${p.id}')"><div class="pedido-avatar ${av}">${ini}</div><div class="pedido-info"><div class="pedido-nombre">${p.cliente}</div><div class="pedido-meta"><span>${p.material} · ${p.color}</span></div></div><span class="pedido-fecha ${fCls}">${label}</span></div>`;
  }).join('');
}

function renderAlertBanner(){
  const urgentes=DB.pedidos.filter(p=>p.estado!=='Entregado'&&p.estado!=='Cancelado'&&daysUntil(p.fecha)<=1);
  const banner=document.getElementById('alert-urgentes');
  if(urgentes.length){banner.style.display='flex';document.getElementById('alert-text').textContent=`⚠ Tenés ${urgentes.length} pedido(s) con entrega en menos de 2 días: ${urgentes.map(p=>p.cliente).join(', ')}`;}
  else banner.style.display='none';
}

// ============ HISTORIAL ============

function renderHistorial(){
  const search=document.getElementById('search-input').value.toLowerCase();
  const status=document.getElementById('filter-status').value;
  let pedidos=[...DB.pedidos];
  if(search) pedidos=pedidos.filter(p=>p.cliente.toLowerCase().includes(search)||(p.stl||'').toLowerCase().includes(search));
  if(status) pedidos=pedidos.filter(p=>p.estado===status);
  const statusMap={'Entregado':'s-entregado','Imprimiendo':'s-imprimiendo','Pendiente':'s-pendiente','Cancelado':'s-cancelado','Urgente':'s-cancelado'};
  document.getElementById('historial-body').innerHTML=pedidos.map(p=>`
    <tr onclick="editPedido('${p.id}')">
      <td><div style="font-weight:500;font-size:13px">${p.cliente}</div><div style="font-size:11px;color:var(--text3)">${p.contacto||''}</div></td>
      <td><span class="stl-path" title="${p.stl||''}">${p.stl||''}</span></td>
      <td><span class="mat-chip">${p.material} · ${p.color}</span></td>
      <td class="td-mono" style="color:var(--green)">$${(p.precio||0).toLocaleString('es-AR')}</td>
      <td class="td-mono">${p.fecha||''}</td>
      <td><span class="status-badge ${statusMap[p.estado]||'s-pendiente'}">${p.estado}</span></td>
    </tr>`).join('');
}
function filterHistorial(){renderHistorial();}
window.filterHistorial=filterHistorial;

// ============ MATERIALES ============

function renderMateriales(){
  const grid=document.getElementById('mat-grid');
  if(!DB.materiales.length){grid.innerHTML='<div style="color:var(--text3);font-size:13px;padding:8px">Sin materiales cargados</div>';return;}
  grid.innerHTML=DB.materiales.map(m=>`
    <div class="mat-card" onclick="openMatModal('${m.id}')" style="cursor:pointer;transition:border-color 0.15s" onmouseover="this.style.borderColor='var(--border2)'" onmouseout="this.style.borderColor='var(--border)'">
      <div class="mat-header">
        <div style="flex:1"><div class="mat-name">${m.tipo} · ${m.color}</div><div class="mat-type">Stock: ${m.stock}g</div></div>
        <span style="font-size:11px;color:var(--text3);background:var(--bg4);padding:3px 8px;border-radius:4px">editar</span>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:4px">
        <span style="font-size:11px;color:var(--text3)">Precio / kg</span>
        <span style="font-family:'Space Mono',monospace;font-size:14px;font-weight:700;color:var(--green)">$${(m.precio_kg||0).toLocaleString('es-AR')}</span>
      </div>
    </div>`).join('');
}

// ============ GASTOS ============

function renderGastos(){
  const gastos = DB.gastos;
  const today  = new Date();
  const mesTotal = calcularGastosMes(today);

  // Resumen arriba
  const puntualesMes = gastos.filter(g=>!g.recurrente && new Date(g.fecha) >= new Date(today.getFullYear(),today.getMonth(),1)).reduce((s,g)=>s+g.monto,0);
  const recMes       = gastos.filter(g=>g.recurrente).reduce((s,g)=>s+g.monto,0);

  document.getElementById('gastos-summary').innerHTML=`
    <div class="metric-card">
      <div class="metric-label">Total este mes</div>
      <div class="metric-value" style="color:var(--amber)">$${mesTotal.toLocaleString('es-AR')}</div>
      <div class="metric-delta" style="color:var(--text3)">${today.toLocaleString('es-AR',{month:'long'})}</div>
    </div>
    <div class="metric-card">
      <div class="metric-label">Gastos puntuales</div>
      <div class="metric-value">$${puntualesMes.toLocaleString('es-AR')}</div>
      <div class="metric-delta" style="color:var(--text3)">Este mes</div>
    </div>
    <div class="metric-card">
      <div class="metric-label">Recurrentes / mes</div>
      <div class="metric-value" style="color:var(--cyan)">$${recMes.toLocaleString('es-AR')}</div>
      <div class="metric-delta" style="color:var(--text3)">Se suman todos los meses</div>
    </div>`;

  // Lista gastos puntuales
  const puntuales = gastos.filter(g=>!g.recurrente);
  document.getElementById('gastos-puntuales-body').innerHTML = puntuales.length
    ? puntuales.map(g=>`
      <tr onclick="editGasto('${g.id}')">
        <td class="td-mono">${g.fecha}</td>
        <td><span class="mat-chip">${g.categoria}</span></td>
        <td style="font-size:13px">${g.descripcion}</td>
        <td class="td-mono" style="color:var(--amber)">$${g.monto.toLocaleString('es-AR')}</td>
      </tr>`).join('')
    : '<tr><td colspan="4" style="color:var(--text3);font-size:13px;padding:16px">Sin gastos puntuales</td></tr>';

  // Lista recurrentes
  const recurrentes = gastos.filter(g=>g.recurrente);
  document.getElementById('gastos-recurrentes-body').innerHTML = recurrentes.length
    ? recurrentes.map(g=>`
      <tr onclick="editGasto('${g.id}')">
        <td><span class="mat-chip">${g.categoria}</span></td>
        <td style="font-size:13px">${g.descripcion}</td>
        <td class="td-mono" style="color:var(--cyan)">$${g.monto.toLocaleString('es-AR')}/mes</td>
      </tr>`).join('')
    : '<tr><td colspan="3" style="color:var(--text3);font-size:13px;padding:16px">Sin gastos recurrentes</td></tr>';
}

// ============ MODAL PEDIDO ============

function openModal(mode, id){
  editingId = id || null;
  const modal=document.getElementById('pedido-modal');
  const delBtn=document.getElementById('btn-delete-pedido');
  document.getElementById('modal-title-text').textContent=mode==='nuevo'?'Nuevo pedido':'Editar pedido';
  if(mode==='nuevo'){
    ['f-cliente','f-contacto','f-stl','f-color','f-precio','f-costo','f-fecha','f-horas','f-notas'].forEach(fid=>document.getElementById(fid).value='');
    document.getElementById('f-material').value='PLA';
    document.getElementById('f-estado').value='Pendiente';
    delBtn.style.display='none';
  } else {
    const p=DB.pedidos.find(x=>x.id===id);
    if(!p) return;
    document.getElementById('f-cliente').value  =p.cliente;
    document.getElementById('f-contacto').value =p.contacto||'';
    document.getElementById('f-stl').value      =p.stl||'';
    document.getElementById('f-material').value =p.material;
    document.getElementById('f-color').value    =p.color;
    document.getElementById('f-precio').value   =p.precio;
    document.getElementById('f-costo').value    =p.costo;
    document.getElementById('f-fecha').value    =p.fecha;
    document.getElementById('f-horas').value    =p.horas||0;
    document.getElementById('f-estado').value   =p.estado==='Urgente'?'Pendiente':p.estado;
    document.getElementById('f-notas').value    =p.notas||'';
    delBtn.style.display='inline-block';
  }
  modal.classList.add('open');
}
window.openModal=openModal;

function editPedido(id){openModal('edit',id);}
window.editPedido=editPedido;

function closeModal(){document.getElementById('pedido-modal').classList.remove('open');}
window.closeModal=closeModal;

async function savePedido(){
  const p={
    cliente:  document.getElementById('f-cliente').value||'Sin nombre',
    contacto: document.getElementById('f-contacto').value,
    stl:      document.getElementById('f-stl').value||'',
    material: document.getElementById('f-material').value,
    color:    document.getElementById('f-color').value,
    precio:   parseFloat(document.getElementById('f-precio').value)||0,
    costo:    parseFloat(document.getElementById('f-costo').value)||0,
    fecha:    document.getElementById('f-fecha').value||new Date().toISOString().slice(0,10),
    horas:    parseFloat(document.getElementById('f-horas').value)||0,
    estado:   document.getElementById('f-estado').value,
    notas:    document.getElementById('f-notas').value
  };
  try {
    if(editingId){
      await updateDoc(userDoc('pedidos', editingId), p);
    } else {
      await addDoc(userCol('pedidos'), p);
    }
    closeModal();
    showToast('Pedido guardado');
  } catch(e){ showToast('Error: '+e.message); }
}
window.savePedido=savePedido;

async function deletePedido(){
  if(!confirm('¿Eliminar este pedido?')) return;
  try {
    await deleteDoc(userDoc('pedidos', editingId));
    closeModal();
    showToast('Pedido eliminado');
  } catch(e){ showToast('Error: '+e.message); }
}
window.deletePedido=deletePedido;

// ============ MODAL MATERIAL ============

function openMatModal(id){
  editingMatId=id||null;
  const delBtn=document.getElementById('btn-delete-mat');
  const title=document.querySelector('#mat-modal .modal-title');
  if(id){
    const m=DB.materiales.find(x=>x.id===id);
    if(!m) return;
    document.getElementById('mf-tipo').value      =m.tipo;
    document.getElementById('mf-color').value     =m.color;
    document.getElementById('mf-stock').value     =m.stock;
    document.getElementById('mf-precio-kg').value =m.precio_kg||'';
    title.textContent='Editar material';
    delBtn.style.display='inline-block';
  } else {
    ['mf-color','mf-precio-kg'].forEach(f=>document.getElementById(f).value='');
    document.getElementById('mf-stock').value='';
    document.getElementById('mf-tipo').value='PLA';
    title.textContent='Agregar material';
    delBtn.style.display='none';
  }
  document.getElementById('mat-modal').classList.add('open');
}
window.openMatModal=openMatModal;

function closeMatModal(){document.getElementById('mat-modal').classList.remove('open');}
window.closeMatModal=closeMatModal;

async function saveMaterial(){
  const data={
    tipo:      document.getElementById('mf-tipo').value,
    color:     document.getElementById('mf-color').value||'Sin color',
    stock:     parseFloat(document.getElementById('mf-stock').value)||0,
    precio_kg: parseFloat(document.getElementById('mf-precio-kg').value)||0,
  };
  try {
    if(editingMatId){
      await updateDoc(userDoc('materiales',editingMatId), data);
      showToast('Material actualizado');
    } else {
      await addDoc(userCol('materiales'), data);
      showToast('Material agregado');
    }
    closeMatModal();
  } catch(e){ showToast('Error: '+e.message); }
}
window.saveMaterial=saveMaterial;

async function deleteMaterial(){
  if(!confirm('¿Eliminar este material?')) return;
  try {
    await deleteDoc(userDoc('materiales',editingMatId));
    closeMatModal();
    showToast('Material eliminado');
  } catch(e){ showToast('Error: '+e.message); }
}
window.deleteMaterial=deleteMaterial;

// ============ MODAL GASTO ============

function openGastoModal(id){
  editingGastoId=id||null;
  const delBtn=document.getElementById('btn-delete-gasto');
  const title=document.querySelector('#gasto-modal .modal-title');
  if(id){
    const g=DB.gastos.find(x=>x.id===id);
    if(!g) return;
    document.getElementById('g-descripcion').value =g.descripcion;
    document.getElementById('g-categoria').value   =g.categoria;
    document.getElementById('g-monto').value       =g.monto;
    document.getElementById('g-fecha').value       =g.fecha||'';
    document.getElementById('g-recurrente').checked=!!g.recurrente;
    toggleFechaGasto();
    title.textContent='Editar gasto';
    delBtn.style.display='inline-block';
  } else {
    ['g-descripcion','g-monto'].forEach(f=>document.getElementById(f).value='');
    document.getElementById('g-categoria').value  ='Filamento';
    document.getElementById('g-fecha').value      =new Date().toISOString().slice(0,10);
    document.getElementById('g-recurrente').checked=false;
    toggleFechaGasto();
    title.textContent='Nuevo gasto';
    delBtn.style.display='none';
  }
  document.getElementById('gasto-modal').classList.add('open');
}
window.openGastoModal=openGastoModal;

function editGasto(id){openGastoModal(id);}
window.editGasto=editGasto;

function closeGastoModal(){document.getElementById('gasto-modal').classList.remove('open');}
window.closeGastoModal=closeGastoModal;

function toggleFechaGasto(){
  const rec=document.getElementById('g-recurrente').checked;
  document.getElementById('g-fecha-group').style.display=rec?'none':'block';
}
window.toggleFechaGasto=toggleFechaGasto;

async function saveGasto(){
  const rec=document.getElementById('g-recurrente').checked;
  const data={
    descripcion: document.getElementById('g-descripcion').value||'Sin descripción',
    categoria:   document.getElementById('g-categoria').value,
    monto:       parseFloat(document.getElementById('g-monto').value)||0,
    recurrente:  rec,
    fecha:       rec ? '' : document.getElementById('g-fecha').value||new Date().toISOString().slice(0,10),
  };
  try {
    if(editingGastoId){
      await updateDoc(userDoc('gastos',editingGastoId), data);
      showToast('Gasto actualizado');
    } else {
      await addDoc(userCol('gastos'), data);
      showToast('Gasto guardado');
    }
    closeGastoModal();
  } catch(e){ showToast('Error: '+e.message); }
}
window.saveGasto=saveGasto;

async function deleteGasto(){
  if(!confirm('¿Eliminar este gasto?')) return;
  try {
    await deleteDoc(userDoc('gastos',editingGastoId));
    closeGastoModal();
    showToast('Gasto eliminado');
  } catch(e){ showToast('Error: '+e.message); }
}
window.deleteGasto=deleteGasto;

// ============ TOAST ============

function showToast(msg){
  const t=document.getElementById('toast');
  document.getElementById('toast-msg').textContent=msg;
  t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'),2500);
}

// ============ CALCULADORA ============

function toggleAvanzados(){
  const panel=document.getElementById('avanzados-panel');
  const icon=document.getElementById('avanzados-toggle-icon');
  const open=panel.style.display==='none';
  panel.style.display=open?'block':'none';
  icon.textContent=open?'▲ ocultar':'▼ ver';
}
window.toggleAvanzados=toggleAvanzados;

function updateMargenLabel(){document.getElementById('c-margen-label').textContent=document.getElementById('c-margen').value+'%';}
window.updateMargenLabel=updateMargenLabel;

function calcular(){
  const peso    =parseFloat(document.getElementById('c-peso').value)||0;
  const horas   =parseFloat(document.getElementById('c-horas').value)||0;
  const filKg   =parseFloat(document.getElementById('c-filamento').value)||0;
  const kwh     =parseFloat(document.getElementById('c-kwh').value)||0;
  const watts   =parseFloat(document.getElementById('c-watts').value)||95;
  const amort   =parseFloat(document.getElementById('c-amort').value)||0;
  const fallaPct=parseFloat(document.getElementById('c-falla').value)||0;
  const manoHora=parseFloat(document.getElementById('c-mano').value)||0;
  const minutos =parseFloat(document.getElementById('c-minutos').value)||0;
  const margen  =parseFloat(document.getElementById('c-margen').value)||0;

  const costoFil  =(peso/1000)*filKg;
  const costoElec =horas*(watts/1000)*kwh;
  const costoAmort=horas*amort;
  const costoFalla=(costoFil+costoElec+costoAmort)*(fallaPct/100);
  const costoMano =(minutos/60)*manoHora;
  const costoTotal=costoFil+costoElec+costoAmort+costoFalla+costoMano;
  const precio    =costoTotal*(1+margen/100);
  const ganancia  =precio-costoTotal;

  document.getElementById('c-resultado').textContent    ='$'+Math.round(precio).toLocaleString('es-AR');
  document.getElementById('c-ganancia-neta').textContent='Ganancia neta: $'+Math.round(ganancia).toLocaleString('es-AR');
  document.getElementById('c-total-costo').textContent  ='$'+Math.round(costoTotal).toLocaleString('es-AR');

  const items=[
    {label:'Filamento PLA',val:costoFil,icon:'◎'},
    {label:`Electricidad (${watts}W · ${horas}hs)`,val:costoElec,icon:'⚡'},
    {label:'Amortización impresora',val:costoAmort,icon:'◷'},
    {label:`Reserva fallas (${fallaPct}%)`,val:costoFalla,icon:'⚠'},
    {label:'Mano de obra / prep.',val:costoMano,icon:'◈'},
  ];
  document.getElementById('c-desglose').innerHTML=items.map(it=>{
    const pct=costoTotal>0?Math.round((it.val/costoTotal)*100):0;
    return`<div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--border)">
      <span style="font-size:13px;width:18px;text-align:center;color:var(--text3)">${it.icon}</span>
      <span style="flex:1;font-size:13px;color:var(--text2)">${it.label}</span>
      <div style="width:80px;height:4px;background:var(--bg4);border-radius:2px;overflow:hidden;margin-right:8px"><div style="height:100%;width:${pct}%;background:var(--accent);border-radius:2px"></div></div>
      <span style="font-family:'Space Mono',monospace;font-size:12px;color:var(--text);min-width:70px;text-align:right">$${Math.round(it.val).toLocaleString('es-AR')}</span>
    </div>`;
  }).join('');

  const rangos=[
    {label:'Mínimo (sin margen)',pct:0,color:'var(--red)'},
    {label:'Conservador',pct:20,color:'var(--amber)'},
    {label:'Recomendado',pct:40,color:'var(--green)'},
    {label:'Premium',pct:80,color:'var(--accent)'},
    {label:'Lujo',pct:150,color:'var(--cyan)'},
  ];
  document.getElementById('c-rangos').innerHTML=rangos.map(r=>{
    const p=costoTotal*(1+r.pct/100);
    const isActive=Math.abs(r.pct-margen)<15;
    return`<div style="display:flex;align-items:center;gap:12px;padding:8px 10px;border-radius:6px;background:${isActive?'rgba(124,109,250,0.08)':'transparent'};border:1px solid ${isActive?'var(--border2)':'transparent'}">
      <div style="width:8px;height:8px;border-radius:50%;background:${r.color};flex-shrink:0"></div>
      <span style="flex:1;font-size:13px;color:var(--text2)">${r.label} (+${r.pct}%)</span>
      <span style="font-family:'Space Mono',monospace;font-size:13px;font-weight:700;color:${r.color}">$${Math.round(p).toLocaleString('es-AR')}</span>
    </div>`;
  }).join('');
}
window.calcular=calcular;

// ============ REFRESH GLOBAL ============

function refreshAll(){
  renderMetrics();
  renderPieChart(currentPeriod);
  renderLineChart(currentLinePeriod);
  renderUpcoming();
  if(currentView==='pedidos')    renderCalendar();
  if(currentView==='historial')  renderHistorial();
  if(currentView==='materiales') renderMateriales();
  if(currentView==='gastos')     renderGastos();
}

// Calcular al cargar
calcular();


// ============ EXPORTACIÓN ============

function getFechaHoy() {
  return new Date().toLocaleDateString('es-AR').replace(/\//g, '-');
}

// ---- PDF ----
window.exportarPDF = function(tipo) {
  const { jsPDF } = window.jspdf;
  if (!jsPDF) { alert('Librería PDF no cargada todavía, esperá un segundo.'); return; }
  const doc = new jsPDF();

  // Header con nombre del emprendimiento
  doc.setFillColor(20, 20, 22);
  doc.rect(0, 0, 220, 22, 'F');
  doc.setTextColor(124, 109, 250);
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('PrintControl — Tatu3D', 14, 14);
  doc.setTextColor(150, 150, 160);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text(`Exportado: ${getFechaHoy()}`, 150, 14);

  doc.setTextColor(30, 30, 30);

  if (tipo === 'pedidos') {
    doc.setFontSize(13);
    doc.setFont('helvetica', 'bold');
    doc.text('Historial de pedidos', 14, 34);

    const rows = DB.pedidos.map(p => [
      p.cliente,
      p.material + ' · ' + p.color,
      '$' + (p.precio || 0).toLocaleString('es-AR'),
      '$' + ((p.precio||0) - (p.costo||0)).toLocaleString('es-AR'),
      p.fecha || '',
      p.estado
    ]);

    doc.autoTable({
      startY: 40,
      head: [['Cliente', 'Material', 'Precio', 'Ganancia', 'Entrega', 'Estado']],
      body: rows,
      styles: { fontSize: 9, cellPadding: 4 },
      headStyles: { fillColor: [124, 109, 250], textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [245, 245, 250] },
      columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' } }
    });

    // Totales al pie
    const totalIngresos = DB.pedidos.filter(p=>p.estado==='Entregado').reduce((s,p)=>s+(p.precio||0),0);
    const totalGanancia = DB.pedidos.filter(p=>p.estado==='Entregado').reduce((s,p)=>s+(p.precio||0)-(p.costo||0),0);
    const finalY = doc.lastAutoTable.finalY + 8;
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text(`Total ingresos (entregados): $${totalIngresos.toLocaleString('es-AR')}`, 14, finalY);
    doc.text(`Ganancia neta total: $${totalGanancia.toLocaleString('es-AR')}`, 14, finalY + 7);

    doc.save(`pedidos_${getFechaHoy()}.pdf`);

  } else if (tipo === 'materiales') {
    doc.setFontSize(13);
    doc.setFont('helvetica', 'bold');
    doc.text('Inventario de materiales', 14, 34);

    const rows = DB.materiales.map(m => [
      m.tipo,
      m.color,
      m.stock + 'g',
      '$' + (m.precio_kg || 0).toLocaleString('es-AR') + '/kg'
    ]);

    doc.autoTable({
      startY: 40,
      head: [['Tipo', 'Color', 'Stock', 'Precio/kg']],
      body: rows,
      styles: { fontSize: 10, cellPadding: 4 },
      headStyles: { fillColor: [124, 109, 250], textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [245, 245, 250] }
    });

    doc.save(`materiales_${getFechaHoy()}.pdf`);

  } else if (tipo === 'gastos-puntuales') {
    doc.setFontSize(13);
    doc.setFont('helvetica', 'bold');
    doc.text('Gastos puntuales', 14, 34);

    const puntuales = DB.gastos.filter(g => !g.recurrente);
    const rows = puntuales.map(g => [g.fecha || '', g.categoria, g.descripcion, '$' + (g.monto||0).toLocaleString('es-AR')]);
    const total = puntuales.reduce((s,g)=>s+(g.monto||0),0);

    doc.autoTable({
      startY: 40,
      head: [['Fecha', 'Categoría', 'Descripción', 'Monto']],
      body: rows,
      styles: { fontSize: 9, cellPadding: 4 },
      headStyles: { fillColor: [245, 166, 35], textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [245, 245, 250] },
      columnStyles: { 3: { halign: 'right' } }
    });

    const finalY = doc.lastAutoTable.finalY + 8;
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text(`Total gastos puntuales: $${total.toLocaleString('es-AR')}`, 14, finalY);
    doc.save(`gastos_puntuales_${getFechaHoy()}.pdf`);

  } else if (tipo === 'gastos-recurrentes') {
    doc.setFontSize(13);
    doc.setFont('helvetica', 'bold');
    doc.text('Gastos recurrentes mensuales', 14, 34);

    const recurrentes = DB.gastos.filter(g => g.recurrente);
    const rows = recurrentes.map(g => [g.categoria, g.descripcion, '$' + (g.monto||0).toLocaleString('es-AR') + '/mes']);
    const total = recurrentes.reduce((s,g)=>s+(g.monto||0),0);

    doc.autoTable({
      startY: 40,
      head: [['Categoría', 'Descripción', 'Monto/mes']],
      body: rows,
      styles: { fontSize: 9, cellPadding: 4 },
      headStyles: { fillColor: [56, 189, 248], textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [245, 245, 250] },
      columnStyles: { 2: { halign: 'right' } }
    });

    const finalY = doc.lastAutoTable.finalY + 8;
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text(`Total recurrente/mes: $${total.toLocaleString('es-AR')}`, 14, finalY);
    doc.save(`gastos_recurrentes_${getFechaHoy()}.pdf`);
  }
};

// ---- EXCEL ----
window.exportarExcel = function(tipo) {
  if (typeof XLSX === 'undefined') { alert('Librería Excel no cargada todavía, esperá un segundo.'); return; }
  const wb = XLSX.utils.book_new();

  if (tipo === 'pedidos') {
    const data = [
      ['Cliente', 'Contacto', 'Archivo STL', 'Material', 'Color', 'Precio', 'Costo', 'Ganancia', 'Fecha entrega', 'Horas', 'Estado', 'Notas'],
      ...DB.pedidos.map(p => [
        p.cliente, p.contacto||'', p.stl||'',
        p.material, p.color,
        p.precio||0, p.costo||0, (p.precio||0)-(p.costo||0),
        p.fecha||'', p.horas||0, p.estado, p.notas||''
      ])
    ];
    // Fila resumen al final
    data.push([]);
    const entregados = DB.pedidos.filter(p=>p.estado==='Entregado');
    data.push(['TOTAL INGRESOS', '', '', '', '', entregados.reduce((s,p)=>s+(p.precio||0),0), '', entregados.reduce((s,p)=>s+(p.precio||0)-(p.costo||0),0)]);

    const ws = XLSX.utils.aoa_to_sheet(data);
    ws['!cols'] = [20,20,30,10,10,12,12,12,14,8,14,30].map(w=>({wch:w}));
    XLSX.utils.book_append_sheet(wb, ws, 'Pedidos');
    XLSX.writeFile(wb, `pedidos_${getFechaHoy()}.xlsx`);

  } else if (tipo === 'materiales') {
    const data = [
      ['Tipo', 'Color', 'Stock (g)', 'Precio/kg ($)'],
      ...DB.materiales.map(m => [m.tipo, m.color, m.stock||0, m.precio_kg||0])
    ];
    const ws = XLSX.utils.aoa_to_sheet(data);
    ws['!cols'] = [12, 15, 12, 15].map(w=>({wch:w}));
    XLSX.utils.book_append_sheet(wb, ws, 'Materiales');
    XLSX.writeFile(wb, `materiales_${getFechaHoy()}.xlsx`);

  } else if (tipo === 'gastos-puntuales') {
    const puntuales = DB.gastos.filter(g => !g.recurrente);
    const data = [
      ['Fecha', 'Categoría', 'Descripción', 'Monto ($)'],
      ...puntuales.map(g => [g.fecha||'', g.categoria, g.descripcion, g.monto||0])
    ];
    data.push([]);
    data.push(['TOTAL', '', '', puntuales.reduce((s,g)=>s+(g.monto||0),0)]);

    const ws = XLSX.utils.aoa_to_sheet(data);
    ws['!cols'] = [14, 18, 35, 14].map(w=>({wch:w}));
    XLSX.utils.book_append_sheet(wb, ws, 'Gastos puntuales');
    XLSX.writeFile(wb, `gastos_puntuales_${getFechaHoy()}.xlsx`);

  } else if (tipo === 'gastos-recurrentes') {
    const recurrentes = DB.gastos.filter(g => g.recurrente);
    const data = [
      ['Categoría', 'Descripción', 'Monto/mes ($)'],
      ...recurrentes.map(g => [g.categoria, g.descripcion, g.monto||0])
    ];
    data.push([]);
    data.push(['TOTAL/MES', '', recurrentes.reduce((s,g)=>s+(g.monto||0),0)]);

    const ws = XLSX.utils.aoa_to_sheet(data);
    ws['!cols'] = [18, 35, 15].map(w=>({wch:w}));
    XLSX.utils.book_append_sheet(wb, ws, 'Gastos recurrentes');
    XLSX.writeFile(wb, `gastos_recurrentes_${getFechaHoy()}.xlsx`);
  }
};
