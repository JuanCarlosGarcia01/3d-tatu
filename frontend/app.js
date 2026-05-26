/* ============================================================
   PrintControl — Lógica de la aplicación
   ============================================================ */

// ============ FIREBASE ============

import { initializeApp }                          from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore, doc, getDoc, setDoc }      from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey:            "AIzaSyCscW8GmWeFverwZmUH9Vdw0co_XIf-Fmk",
  authDomain:        "tatu3d-cd25b.firebaseapp.com",
  projectId:         "tatu3d-cd25b",
  storageBucket:     "tatu3d-cd25b.firebasestorage.app",
  messagingSenderId: "897677948498",
  appId:             "1:897677948498:web:bf4a444f7f3c263bb9518b"
};

const firebaseApp = initializeApp(firebaseConfig);
const db          = getFirestore(firebaseApp);
const DB_DOC      = doc(db, 'printcontrol', 'data');

const DEFAULT_DATA = {
  pedidos:    [],
  materiales: [],
  gastos:     []
};

let DB = JSON.parse(JSON.stringify(DEFAULT_DATA));

// Guarda en Firestore (sin bloquear la UI)
async function saveData() {
  try {
    await setDoc(DB_DOC, DB);
  } catch(e) {
    console.error('Error guardando en Firebase:', e);
    showToast('⚠ Error al guardar en la nube');
  }
}

// Carga desde Firestore al iniciar
async function loadData() {
  try {
    const snap = await getDoc(DB_DOC);
    if (snap.exists()) {
      DB = snap.data();
      if (!DB.gastos)     DB.gastos     = [];
      if (!DB.pedidos)    DB.pedidos    = [];
      if (!DB.materiales) DB.materiales = [];
    }
  } catch(e) {
    console.error('Error cargando desde Firebase:', e);
  }
  // Inicializar la app una vez que los datos están listos
  initApp();
}

loadData();


// ============ NAVEGACIÓN ============

let currentView    = 'dashboard';
let editingId      = null;
let editingMatId   = null;

function setView(v) {
  document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  document.getElementById('view-' + v).classList.add('active');
  event.currentTarget.classList.add('active');
  currentView = v;

  const titles = {
    dashboard:    'Dashboard',
    pedidos:      'Pedidos activos',
    historial:    'Historial de pedidos',
    materiales:   'Inventario de materiales',
    calculadora:  'Calculadora de precios',
    gastos:       'Registro de gastos'
  };
  document.getElementById('topbar-title').textContent = titles[v] || v;

  if (v === 'pedidos')    renderCalendar();
  if (v === 'historial')  renderHistorial();
  if (v === 'materiales') renderMateriales();
  if (v === 'gastos')     renderGastos();
}


// ============ FECHA ============

const NOW = new Date();
document.getElementById('topbar-date').textContent =
  NOW.toLocaleDateString('es-AR', { weekday:'long', year:'numeric', month:'long', day:'numeric' });

function daysUntil(dateStr) {
  const d     = new Date(dateStr + 'T00:00:00');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.floor((d - today) / 86400000);
}


// ============ MÉTRICAS (Dashboard) ============

function renderMetrics() {
  const pedidos    = DB.pedidos;
  const today      = new Date();
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

  const entregados  = pedidos.filter(p => p.estado === 'Entregado');
  const activos     = pedidos.filter(p => p.estado !== 'Entregado' && p.estado !== 'Cancelado');
  const totalGan    = entregados.reduce((s, p) => s + (p.precio - p.costo), 0);
  const mesGan      = entregados
    .filter(p => new Date(p.fecha) >= monthStart)
    .reduce((s, p) => s + (p.precio - p.costo), 0);
  const urgentes    = activos.filter(p => daysUntil(p.fecha) <= 2).length;

  document.getElementById('metrics-container').innerHTML = `
    <div class="metric-card">
      <div class="metric-label">Ganancia total</div>
      <div class="metric-value" style="color:var(--green)">$${totalGan.toLocaleString('es-AR')}</div>
      <div class="metric-delta delta-up">↑ Acumulado</div>
    </div>
    <div class="metric-card">
      <div class="metric-label">Este mes</div>
      <div class="metric-value">$${mesGan.toLocaleString('es-AR')}</div>
      <div class="metric-delta" style="color:var(--text3)">Ganancias ${today.toLocaleString('es-AR',{month:'long'})}</div>
    </div>
    <div class="metric-card">
      <div class="metric-label">Pedidos activos</div>
      <div class="metric-value" style="color:var(--accent)">${activos.length}</div>
      <div class="metric-delta" style="color:var(--text3)">${activos.filter(p=>p.estado==='Imprimiendo').length} imprimiendo</div>
    </div>
    <div class="metric-card">
      <div class="metric-label">Urgentes</div>
      <div class="metric-value" style="color:${urgentes>0?'var(--red)':'var(--text2)'}">${urgentes}</div>
      <div class="metric-delta" style="color:var(--text3)">Próximos 2 días</div>
    </div>
  `;

  const badge = document.getElementById('badge-urgentes');
  if (urgentes > 0) { badge.style.display = 'inline'; badge.textContent = urgentes; }
  else              { badge.style.display = 'none'; }
}


// ============ GRÁFICO TORTA ============

let pieChart;
let currentPeriod = 'semana';

function getPeriodRange(period) {
  const today = new Date(); today.setHours(23, 59, 59);
  const start = new Date();
  if      (period === 'semana') start.setDate(today.getDate() - 7);
  else if (period === 'mes')    start.setDate(1);
  else                          start.setMonth(0, 1);
  start.setHours(0, 0, 0, 0);
  return { start, today };
}

function getPeriodPedidos(period) {
  const { start, today } = getPeriodRange(period);
  return DB.pedidos.filter(p =>
    p.estado === 'Entregado' && new Date(p.fecha) >= start && new Date(p.fecha) <= today
  );
}

function getPeriodGastos(period) {
  const { start, today } = getPeriodRange(period);
  if (!DB.gastos) return [];
  return DB.gastos.filter(g => {
    const d = new Date(g.fecha);
    return d >= start && d <= today;
  });
}

function renderPieChart(period) {
  const pedidos = getPeriodPedidos(period);
  const gastos  = getPeriodGastos(period);
  const legend  = document.getElementById('pie-legend');

  // ---- Ganancias por material (anillo exterior) ----
  const byMat = {};
  pedidos.forEach(p => {
    if (!byMat[p.material]) byMat[p.material] = 0;
    byMat[p.material] += p.precio - p.costo;
  });
  const ganLabels = Object.keys(byMat);
  const ganValues = Object.values(byMat);
  const totalGan  = ganValues.reduce((s, v) => s + v, 0);

  // ---- Gastos por categoría (anillo interior) ----
  const GASTO_META_LOCAL = {
    repuesto:  { label: 'Repuesto',       color: '#f5a623' },
    filamento: { label: 'Más filamento',  color: '#38bdf8' },
    curso:     { label: 'Curso',          color: '#e879f9' },
    modelo3d:  { label: 'Modelo 3D pago', color: '#3dd68c' },
    urgencia:  { label: 'Urgencia',       color: '#f05252' },
  };
  const byCat = {};
  gastos.forEach(g => {
    if (!byCat[g.categoria]) byCat[g.categoria] = 0;
    byCat[g.categoria] += g.monto;
  });
  const gastLabels = Object.keys(byCat);
  const gastValues = Object.values(byCat);
  const totalGast  = gastValues.reduce((s, v) => s + v, 0);

  const balance = totalGan - totalGast;

  // Centro del donut
  const centerVal = document.getElementById('pie-center-val');
  if (centerVal) {
    centerVal.textContent = (balance >= 0 ? '+' : '') + '$' + Math.round(balance).toLocaleString('es-AR');
    centerVal.style.color = balance >= 0 ? 'var(--green)' : 'var(--red)';
  }

  // Sin datos
  if (!ganLabels.length && !gastLabels.length) {
    legend.innerHTML = '<div style="color:var(--text3);font-size:13px">Sin datos en este período</div>';
    if (pieChart) pieChart.destroy();
    return;
  }

  // Colores ganancias
  const ganColors = ['#7c6dfa','#3dd68c','#38bdf8','#f5a623','#a78bfa','#34d399'];

  // Dataset exterior: ganancias (o placeholder si no hay)
  const outerData   = ganValues.length ? ganValues   : [1];
  const outerColors = ganValues.length
    ? ganLabels.map((_, i) => ganColors[i % ganColors.length])
    : ['#2a2a32'];

  // Dataset interior: gastos (o placeholder si no hay)
  const innerData   = gastValues.length ? gastValues  : [1];
  const innerColors = gastValues.length
    ? gastLabels.map(cat => GASTO_META_LOCAL[cat]?.color || '#9896a0')
    : ['#2a2a32'];

  // Leyenda unificada
  let legendHtml = '';
  if (ganLabels.length) {
    legendHtml += `<div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:0.8px;margin-bottom:4px">Ganancias</div>`;
    legendHtml += ganLabels.map((l, i) => `
      <div class="legend-item">
        <div class="legend-dot" style="background:${ganColors[i % ganColors.length]}"></div>
        <span class="legend-name">${l}</span>
        <span class="legend-val" style="color:var(--green)">+$${ganValues[i].toLocaleString('es-AR')}</span>
      </div>`).join('');
  }
  if (gastLabels.length) {
    legendHtml += `<div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:0.8px;margin-top:8px;margin-bottom:4px">Gastos</div>`;
    legendHtml += gastLabels.map((cat, i) => {
      const m = GASTO_META_LOCAL[cat] || { label: cat, color: '#9896a0' };
      return `<div class="legend-item">
        <div class="legend-dot" style="background:${m.color}"></div>
        <span class="legend-name">${m.label}</span>
        <span class="legend-val" style="color:var(--red)">-$${gastValues[i].toLocaleString('es-AR')}</span>
      </div>`;
    }).join('');
  }
  legend.innerHTML = legendHtml;

  const ctx = document.getElementById('pieChart').getContext('2d');
  if (pieChart) pieChart.destroy();
  pieChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      datasets: [
        {
          // exterior = ganancias
          label: 'Ganancias',
          data: outerData,
          backgroundColor: outerColors,
          borderWidth: 2,
          borderColor: '#141416',
          hoverOffset: 4,
        },
        {
          // interior = gastos
          label: 'Gastos',
          data: innerData,
          backgroundColor: innerColors,
          borderWidth: 2,
          borderColor: '#141416',
          hoverOffset: 4,
        }
      ]
    },
    options: {
      cutout: '50%',
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => {
              const prefix = ctx.datasetIndex === 0 ? '+' : '-';
              return ` ${prefix}$${ctx.parsed.toLocaleString('es-AR')}`;
            }
          }
        }
      },
      animation: { animateRotate: true, duration: 500 }
    }
  });
}

function setPeriod(p, btn) {
  currentPeriod = p;
  document.querySelectorAll('#view-dashboard .period-selector:first-of-type .period-btn')
    .forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderPieChart(p);
}


// ============ GRÁFICO LÍNEA ============

let lineChart;
let currentLinePeriod = 'semana';

function getLineData(period) {
  if (period === 'semana') {
    const days  = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
    const today = new Date();
    const labels = [], data = [];
    for (let i = 6; i >= 0; i--) {
      const d  = new Date(today); d.setDate(today.getDate() - i);
      const ds = d.toISOString().slice(0, 10);
      labels.push(days[d.getDay()]);
      data.push(DB.pedidos
        .filter(p => p.estado === 'Entregado' && p.fecha === ds)
        .reduce((s, p) => s + p.precio - p.costo, 0));
    }
    return { labels, data };
  } else {
    const today  = new Date();
    const labels = [], data = [];
    for (let i = 3; i >= 0; i--) {
      const w  = new Date(today); w.setDate(today.getDate() - i * 7);
      const ws = new Date(w);     ws.setDate(w.getDate() - 6);
      labels.push(`Sem ${4 - i}`);
      data.push(DB.pedidos
        .filter(p => { const fd = new Date(p.fecha); return p.estado === 'Entregado' && fd >= ws && fd <= w; })
        .reduce((s, p) => s + p.precio - p.costo, 0));
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
    data: {
      labels,
      datasets: [{
        data,
        borderColor: '#7c6dfa',
        backgroundColor: 'rgba(124,109,250,0.08)',
        borderWidth: 2,
        fill: true,
        tension: 0.4,
        pointBackgroundColor: '#7c6dfa',
        pointRadius: 4
      }]
    },
    options: {
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => ` $${ctx.parsed.y.toLocaleString('es-AR')}` } }
      },
      scales: {
        x: { grid: { color: '#2a2a32' }, ticks: { color: '#9896a0', font: { size: 11 } } },
        y: { grid: { color: '#2a2a32' }, ticks: { color: '#9896a0', font: { size: 11 }, callback: v => '$' + v.toLocaleString('es-AR') } }
      },
      animation: { duration: 400 }
    }
  });
}

function setLinePeriod(p, btn) {
  currentLinePeriod = p;
  document.querySelectorAll('#view-dashboard .card:nth-child(2) .period-btn')
    .forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderLineChart(p);
}


// ============ PRÓXIMOS VENCIMIENTOS ============

function renderUpcoming() {
  const activos = DB.pedidos
    .filter(p => p.estado !== 'Entregado' && p.estado !== 'Cancelado')
    .sort((a, b) => new Date(a.fecha) - new Date(b.fecha))
    .slice(0, 4);

  const ul = document.getElementById('upcoming-list');
  if (!activos.length) {
    ul.innerHTML = '<div style="color:var(--text3);font-size:13px;padding:8px">Sin pedidos activos</div>';
    return;
  }

  ul.innerHTML = activos.map(p => {
    const d       = daysUntil(p.fecha);
    const cls     = d <= 1 ? 'urgente' : d <= 4 ? 'proximo' : 'ok';
    const av      = d <= 1 ? 'av-red'  : d <= 4 ? 'av-amber' : 'av-green';
    const fCls    = d <= 1 ? 'fecha-urgente' : d <= 4 ? 'fecha-proximo' : 'fecha-ok';
    const label   = d < 0  ? `${Math.abs(d)}d vencido` : d === 0 ? 'Hoy' : d === 1 ? 'Mañana' : `${d} días`;
    const initials = p.cliente.split(' ').map(x => x[0]).join('').slice(0, 2).toUpperCase();
    return `<div class="pedido-card ${cls}" onclick="editPedido(${p.id})">
      <div class="pedido-avatar ${av}">${initials}</div>
      <div class="pedido-info">
        <div class="pedido-nombre">${p.cliente}</div>
        <div class="pedido-meta">
          <span>${p.material} · ${p.color}</span>
          <span>${p.stl.split('/').pop()}</span>
        </div>
      </div>
      <span class="pedido-fecha ${fCls}">${label}</span>
      <span class="pedido-precio">$${(p.precio - p.costo).toLocaleString('es-AR')}</span>
    </div>`;
  }).join('');
}


// ============ CALENDARIO ============

let calDate = new Date();

function renderCalendar() {
  const months = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  document.getElementById('cal-month-title').textContent = `${months[calDate.getMonth()]} ${calDate.getFullYear()}`;

  const headers  = document.getElementById('cal-headers');
  const dias     = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
  headers.innerHTML = dias.map(d => `<div class="cal-header">${d}</div>`).join('');

  const first    = new Date(calDate.getFullYear(), calDate.getMonth(), 1);
  const last     = new Date(calDate.getFullYear(), calDate.getMonth() + 1, 0);
  const startDay = first.getDay();
  const today    = new Date(); today.setHours(0, 0, 0, 0);

  const grid = document.getElementById('calendar-grid');
  let html = '';

  for (let i = 0; i < startDay; i++) {
    const d = new Date(first); d.setDate(d.getDate() - (startDay - i));
    html += `<div class="cal-day other-month"><span>${d.getDate()}</span></div>`;
  }

  for (let d = 1; d <= last.getDate(); d++) {
    const thisDate   = new Date(calDate.getFullYear(), calDate.getMonth(), d);
    const dateStr    = thisDate.toISOString().slice(0, 10);
    const isToday    = thisDate.getTime() === today.getTime();
    const pedidosDay = DB.pedidos.filter(p => p.fecha === dateStr && p.estado !== 'Entregado' && p.estado !== 'Cancelado');
    const urgent     = pedidosDay.some(p => daysUntil(p.fecha) <= 1);
    const dots       = pedidosDay.map(p => {
      const dd = daysUntil(p.fecha);
      const c  = dd <= 1 ? 'var(--red)' : dd <= 4 ? 'var(--amber)' : 'var(--green)';
      return `<div class="cal-dot" style="background:${c}"></div>`;
    }).join('');

    html += `<div class="cal-day${isToday ? ' today' : ''}${pedidosDay.length ? ' has-order' : ''}${urgent ? ' urgent' : ''}">
      <span>${d}</span>
      <div class="cal-dots">${dots}</div>
    </div>`;
  }

  grid.innerHTML = html;
  renderActivePedidos();
  renderAlertBanner();
}

function changeMonth(dir) {
  calDate.setMonth(calDate.getMonth() + dir);
  renderCalendar();
}

function renderActivePedidos() {
  const activos = DB.pedidos
    .filter(p => p.estado !== 'Entregado' && p.estado !== 'Cancelado')
    .sort((a, b) => new Date(a.fecha) - new Date(b.fecha));

  const list = document.getElementById('active-pedidos');
  if (!activos.length) {
    list.innerHTML = '<div style="color:var(--text3);font-size:13px;padding:8px">Sin pedidos activos</div>';
    return;
  }

  list.innerHTML = activos.map(p => {
    const d       = daysUntil(p.fecha);
    const cls     = d <= 1 ? 'urgente' : d <= 4 ? 'proximo' : 'ok';
    const av      = d <= 1 ? 'av-red'  : d <= 4 ? 'av-amber' : 'av-green';
    const fCls    = d <= 1 ? 'fecha-urgente' : d <= 4 ? 'fecha-proximo' : 'fecha-ok';
    const label   = d < 0  ? `${Math.abs(d)}d vencido` : d === 0 ? 'Hoy' : d === 1 ? 'Mañana' : `${d} días`;
    const initials = p.cliente.split(' ').map(x => x[0]).join('').slice(0, 2).toUpperCase();
    return `<div class="pedido-card ${cls}" onclick="editPedido(${p.id})">
      <div class="pedido-avatar ${av}">${initials}</div>
      <div class="pedido-info">
        <div class="pedido-nombre">${p.cliente}</div>
        <div class="pedido-meta"><span>${p.material} · ${p.color}</span></div>
      </div>
      <span class="pedido-fecha ${fCls}">${label}</span>
    </div>`;
  }).join('');
}

function renderAlertBanner() {
  const urgentes = DB.pedidos.filter(p =>
    p.estado !== 'Entregado' && p.estado !== 'Cancelado' && daysUntil(p.fecha) <= 1
  );
  const banner = document.getElementById('alert-urgentes');
  if (urgentes.length) {
    banner.style.display = 'flex';
    document.getElementById('alert-text').textContent =
      `⚠ Tenés ${urgentes.length} pedido(s) con entrega en menos de 2 días: ${urgentes.map(p => p.cliente).join(', ')}`;
  } else {
    banner.style.display = 'none';
  }
}


// ============ HISTORIAL ============

function renderHistorial() {
  const search = document.getElementById('search-input').value.toLowerCase();
  const status = document.getElementById('filter-status').value;

  let pedidos = [...DB.pedidos].reverse();
  if (search) pedidos = pedidos.filter(p =>
    p.cliente.toLowerCase().includes(search) || p.stl.toLowerCase().includes(search)
  );
  if (status) pedidos = pedidos.filter(p => p.estado === status);

  const statusMap = {
    'Entregado':   's-entregado',
    'Imprimiendo': 's-imprimiendo',
    'Pendiente':   's-pendiente',
    'Cancelado':   's-cancelado',
    'Urgente':     's-cancelado'
  };

  document.getElementById('historial-body').innerHTML = pedidos.map(p => `
    <tr onclick="editPedido(${p.id})">
      <td class="td-mono">#${p.id}</td>
      <td>
        <div style="font-weight:500;font-size:13px">${p.cliente}</div>
        <div style="font-size:11px;color:var(--text3)">${p.contacto}</div>
      </td>
      <td><span class="stl-path" title="${p.stl}">${p.stl}</span></td>
      <td><span class="mat-chip">${p.material} · ${p.color}</span></td>
      <td class="td-mono" style="color:var(--green)">$${p.precio.toLocaleString('es-AR')}</td>
      <td class="td-mono">${p.fecha}</td>
      <td><span class="status-badge ${statusMap[p.estado] || 's-pendiente'}">${p.estado}</span></td>
    </tr>`).join('');
}

function filterHistorial() { renderHistorial(); }


// ============ MATERIALES ============

function renderMateriales() {
  const grid = document.getElementById('mat-grid');
  grid.innerHTML = DB.materiales.map(m => {
    return `<div class="mat-card"
      onclick="openMatModal(${m.id})"
      style="cursor:pointer;transition:border-color 0.15s"
      onmouseover="this.style.borderColor='var(--border2)'"
      onmouseout="this.style.borderColor='var(--border)'">
      <div class="mat-header">
        <div style="flex:1">
          <div class="mat-name">${m.tipo} · ${m.color}</div>
          <div class="mat-type">Stock: ${m.stock}g</div>
        </div>
        <span style="font-size:11px;color:var(--text3);background:var(--bg4);padding:3px 8px;border-radius:4px">editar</span>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:4px">
        <span style="font-size:11px;color:var(--text3)">Precio / kg</span>
        <span style="font-family:'Space Mono',monospace;font-size:14px;font-weight:700;color:var(--green)">
          $${(m.precio_kg || 0).toLocaleString('es-AR')}
        </span>
      </div>
    </div>`;
  }).join('');
}


// ============ MODAL PEDIDO ============

function openModal(mode, id) {
  editingId = id || null;
  const modal  = document.getElementById('pedido-modal');
  const delBtn = document.getElementById('btn-delete-pedido');
  document.getElementById('modal-title-text').textContent = mode === 'nuevo' ? 'Nuevo pedido' : 'Editar pedido';

  if (mode === 'nuevo') {
    ['f-cliente','f-contacto','f-stl','f-color','f-precio','f-costo','f-fecha','f-horas','f-notas']
      .forEach(fid => document.getElementById(fid).value = '');
    document.getElementById('f-material').value = 'PLA';
    document.getElementById('f-estado').value   = 'Pendiente';
    delBtn.style.display = 'none';
  } else {
    const p = DB.pedidos.find(x => x.id === id);
    if (!p) return;
    document.getElementById('f-cliente').value   = p.cliente;
    document.getElementById('f-contacto').value  = p.contacto;
    document.getElementById('f-stl').value       = p.stl;
    document.getElementById('f-material').value  = p.material;
    document.getElementById('f-color').value     = p.color;
    document.getElementById('f-precio').value    = p.precio;
    document.getElementById('f-costo').value     = p.costo;
    document.getElementById('f-fecha').value     = p.fecha;
    document.getElementById('f-horas').value     = p.horas;
    document.getElementById('f-estado').value    = p.estado === 'Urgente' ? 'Pendiente' : p.estado;
    document.getElementById('f-notas').value     = p.notas;
    delBtn.style.display = 'inline-block';
  }
  modal.classList.add('open');
}

function editPedido(id) { openModal('edit', id); }

function closeModal() { document.getElementById('pedido-modal').classList.remove('open'); }

function savePedido() {
  const p = {
    cliente:  document.getElementById('f-cliente').value  || 'Sin nombre',
    contacto: document.getElementById('f-contacto').value,
    stl:      document.getElementById('f-stl').value      || '/modelos/sin_archivo.stl',
    material: document.getElementById('f-material').value,
    color:    document.getElementById('f-color').value,
    precio:   parseFloat(document.getElementById('f-precio').value) || 0,
    costo:    parseFloat(document.getElementById('f-costo').value)  || 0,
    fecha:    document.getElementById('f-fecha').value    || new Date().toISOString().slice(0, 10),
    horas:    parseFloat(document.getElementById('f-horas').value)  || 0,
    estado:   document.getElementById('f-estado').value,
    notas:    document.getElementById('f-notas').value
  };

  if (editingId) {
    const idx = DB.pedidos.findIndex(x => x.id === editingId);
    DB.pedidos[idx] = { ...DB.pedidos[idx], ...p };
  } else {
    p.id = Date.now();
    DB.pedidos.push(p);
  }

  saveData();
  closeModal();
  showToast('Pedido guardado correctamente');
  refreshAll();
}

function deletePedido() {
  if (!confirm('¿Eliminar este pedido?')) return;
  DB.pedidos = DB.pedidos.filter(x => x.id !== editingId);
  saveData();
  closeModal();
  showToast('Pedido eliminado');
  refreshAll();
}


// ============ MODAL MATERIAL ============

function openMatModal(id) {
  editingMatId = id || null;
  const delBtn = document.getElementById('btn-delete-mat');
  const title  = document.querySelector('#mat-modal .modal-title');

  if (id) {
    const m = DB.materiales.find(x => x.id === id);
    if (!m) return;
    document.getElementById('mf-tipo').value      = m.tipo;
    document.getElementById('mf-color').value     = m.color;
    document.getElementById('mf-stock').value     = m.stock;
    document.getElementById('mf-precio-kg').value = m.precio_kg || '';
    title.textContent        = 'Editar material';
    delBtn.style.display     = 'inline-block';
  } else {
    ['mf-color','mf-precio-kg'].forEach(f => document.getElementById(f).value = '');
    document.getElementById('mf-stock').value = '';
    document.getElementById('mf-tipo').value  = 'PLA';
    title.textContent    = 'Agregar material';
    delBtn.style.display = 'none';
  }
  document.getElementById('mat-modal').classList.add('open');
}

function closeMatModal() { document.getElementById('mat-modal').classList.remove('open'); }

function saveMaterial() {
  const data = {
    tipo:      document.getElementById('mf-tipo').value,
    color:     document.getElementById('mf-color').value     || 'Sin color',
    stock:     parseFloat(document.getElementById('mf-stock').value)     || 0,
    precio_kg: parseFloat(document.getElementById('mf-precio-kg').value) || 0,
  };

  if (editingMatId) {
    const idx = DB.materiales.findIndex(x => x.id === editingMatId);
    DB.materiales[idx] = { ...DB.materiales[idx], ...data };
    showToast('Material actualizado');
  } else {
    DB.materiales.push({ id: Date.now(), ...data });
    showToast('Material agregado');
  }

  saveData();
  closeMatModal();
  renderMateriales();
}

function deleteMaterial() {
  if (!confirm('¿Eliminar este material?')) return;
  DB.materiales = DB.materiales.filter(x => x.id !== editingMatId);
  saveData();
  closeMatModal();
  showToast('Material eliminado');
  renderMateriales();
}


// ============ GASTOS ============

const GASTO_META = {
  repuesto:  { label: 'Repuesto',       icon: '🔧', color: 'var(--amber)',  bg: 'rgba(245,166,35,0.12)' },
  filamento: { label: 'Más filamento',  icon: '◎',  color: 'var(--cyan)',   bg: 'rgba(56,189,248,0.12)' },
  curso:     { label: 'Curso',          icon: '📚', color: 'var(--accent)', bg: 'rgba(124,109,250,0.12)' },
  modelo3d:  { label: 'Modelo 3D pago', icon: '◈',  color: 'var(--green)',  bg: 'rgba(61,214,140,0.12)' },
  urgencia:  { label: 'Urgencia',       icon: '⚠',  color: 'var(--red)',    bg: 'rgba(240,82,82,0.12)' },
};

let editingGastoId = null;

function openGastoModal(id) {
  editingGastoId = id || null;
  const delBtn = document.getElementById('btn-delete-gasto');
  document.getElementById('gasto-modal-title').textContent = id ? 'Editar gasto' : 'Registrar gasto';

  // Resetear selección de categoría
  document.querySelectorAll('.gasto-cat-btn').forEach(b => b.classList.remove('selected'));
  document.getElementById('gf-urgencia-wrap').style.display = 'none';

  if (id) {
    const g = DB.gastos.find(x => x.id === id);
    if (!g) return;
    document.getElementById('gf-monto').value = g.monto;
    document.getElementById('gf-fecha').value = g.fecha;
    document.getElementById('gf-nota').value  = g.nota || '';
    document.getElementById('gf-urgencia-desc').value = g.urgencia_desc || '';
    // Marcar categoría
    const catBtn = document.querySelector(`.gasto-cat-btn[data-cat="${g.categoria}"]`);
    if (catBtn) {
      catBtn.classList.add('selected');
      catBtn.querySelector('input').checked = true;
    }
    if (g.categoria === 'urgencia') document.getElementById('gf-urgencia-wrap').style.display = 'block';
    delBtn.style.display = 'inline-block';
  } else {
    document.getElementById('gf-monto').value = '';
    document.getElementById('gf-nota').value  = '';
    document.getElementById('gf-urgencia-desc').value = '';
    document.getElementById('gf-fecha').value = new Date().toISOString().slice(0, 10);
    document.querySelectorAll('input[name="gasto-cat"]').forEach(r => r.checked = false);
    delBtn.style.display = 'none';
  }
  document.getElementById('gasto-modal').classList.add('open');
}

function closeGastoModal() {
  document.getElementById('gasto-modal').classList.remove('open');
}

// Interacción de botones de categoría
document.querySelectorAll('.gasto-cat-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.gasto-cat-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    btn.querySelector('input').checked = true;
    const isUrgencia = btn.dataset.cat === 'urgencia';
    document.getElementById('gf-urgencia-wrap').style.display = isUrgencia ? 'block' : 'none';
    if (!isUrgencia) document.getElementById('gf-urgencia-desc').value = '';
  });
});

function saveGasto() {
  const monto = parseFloat(document.getElementById('gf-monto').value) || 0;
  const fecha = document.getElementById('gf-fecha').value || new Date().toISOString().slice(0, 10);
  const nota  = document.getElementById('gf-nota').value;
  const catInput = document.querySelector('input[name="gasto-cat"]:checked');

  if (!monto) { alert('Ingresá un monto'); return; }
  if (!catInput) { alert('Elegí una categoría'); return; }

  const categoria = catInput.value;
  const urgencia_desc = categoria === 'urgencia'
    ? document.getElementById('gf-urgencia-desc').value
    : '';

  if (categoria === 'urgencia' && !urgencia_desc.trim()) {
    alert('Describí el motivo de la urgencia'); return;
  }

  const g = { monto, fecha, nota, categoria, urgencia_desc };

  if (editingGastoId) {
    const idx = DB.gastos.findIndex(x => x.id === editingGastoId);
    DB.gastos[idx] = { ...DB.gastos[idx], ...g };
    showToast('Gasto actualizado');
  } else {
    DB.gastos.push({ id: Date.now(), ...g });
    showToast('Gasto registrado');
  }

  saveData();
  closeGastoModal();
  renderGastos();
}

function deleteGasto() {
  if (!confirm('¿Eliminar este gasto?')) return;
  DB.gastos = DB.gastos.filter(x => x.id !== editingGastoId);
  saveData();
  closeGastoModal();
  showToast('Gasto eliminado');
  renderGastos();
}

function renderGastos() {
  if (!DB.gastos) DB.gastos = [];

  const gastos = DB.gastos;
  const total  = gastos.reduce((s, g) => s + g.monto, 0);
  const hoy    = new Date().toISOString().slice(0, 10);
  const mesStart = new Date(); mesStart.setDate(1);

  const esMes  = g => new Date(g.fecha) >= mesStart;
  const totalMes = gastos.filter(esMes).reduce((s, g) => s + g.monto, 0);
  const cantMes  = gastos.filter(esMes).length;

  // Métricas
  document.getElementById('gastos-metrics').innerHTML = `
    <div class="metric-card">
      <div class="metric-label">Total gastado</div>
      <div class="metric-value" style="color:var(--red)">$${total.toLocaleString('es-AR')}</div>
      <div class="metric-delta" style="color:var(--text3)">Acumulado</div>
    </div>
    <div class="metric-card">
      <div class="metric-label">Este mes</div>
      <div class="metric-value">$${totalMes.toLocaleString('es-AR')}</div>
      <div class="metric-delta" style="color:var(--text3)">${cantMes} gasto(s)</div>
    </div>
    <div class="metric-card">
      <div class="metric-label">Total registros</div>
      <div class="metric-value" style="color:var(--accent)">${gastos.length}</div>
      <div class="metric-delta" style="color:var(--text3)">Histórico</div>
    </div>
    <div class="metric-card">
      <div class="metric-label">Urgencias</div>
      <div class="metric-value" style="color:${gastos.filter(g=>g.categoria==='urgencia').length ? 'var(--red)':'var(--text2)'}">
        ${gastos.filter(g => g.categoria === 'urgencia').length}
      </div>
      <div class="metric-delta" style="color:var(--text3)">Gastos imprevistos</div>
    </div>
  `;

  // Por categoría
  const catEl = document.getElementById('gastos-por-categoria');
  if (!gastos.length) {
    catEl.innerHTML = '<div style="color:var(--text3);font-size:13px;padding:8px">Sin gastos registrados</div>';
  } else {
    const totCats = {};
    gastos.forEach(g => { totCats[g.categoria] = (totCats[g.categoria] || 0) + g.monto; });
    const maxVal = Math.max(...Object.values(totCats));

    catEl.innerHTML = Object.entries(totCats)
      .sort((a, b) => b[1] - a[1])
      .map(([cat, val]) => {
        const m   = GASTO_META[cat] || { label: cat, icon: '●', color: 'var(--accent)', bg: '' };
        const pct = maxVal > 0 ? Math.round((val / maxVal) * 100) : 0;
        return `<div class="cat-bar-row">
          <span style="font-size:15px;width:20px;text-align:center">${m.icon}</span>
          <span class="cat-bar-label">${m.label}</span>
          <div class="cat-bar-bg">
            <div class="cat-bar-fill" style="width:${pct}%;background:${m.color}"></div>
          </div>
          <span class="cat-bar-val">$${val.toLocaleString('es-AR')}</span>
        </div>`;
      }).join('');
  }

  // Últimos gastos
  const recEl = document.getElementById('gastos-recientes');
  if (!gastos.length) {
    recEl.innerHTML = '<div style="color:var(--text3);font-size:13px;padding:8px">Sin gastos aún</div>';
  } else {
    recEl.innerHTML = [...gastos]
      .sort((a, b) => new Date(b.fecha) - new Date(a.fecha))
      .slice(0, 8)
      .map(g => {
        const m    = GASTO_META[g.categoria] || { label: g.categoria, icon: '●', color: 'var(--accent)', bg: '' };
        const desc = g.categoria === 'urgencia' && g.urgencia_desc
          ? g.urgencia_desc
          : g.nota || '';
        return `<div class="gasto-item" onclick="openGastoModal(${g.id})">
          <div class="gasto-cat-icon" style="background:${m.bg};color:${m.color}">${m.icon}</div>
          <div class="gasto-item-info">
            <div class="gasto-item-cat">${m.label}</div>
            ${desc ? `<div class="gasto-item-desc">${desc}</div>` : ''}
          </div>
          <div style="text-align:right">
            <div class="gasto-item-monto">-$${g.monto.toLocaleString('es-AR')}</div>
            <div class="gasto-item-fecha">${g.fecha}</div>
          </div>
        </div>`;
      }).join('');
  }
}


// ============ TOAST ============

function showToast(msg) {
  const t = document.getElementById('toast');
  document.getElementById('toast-msg').textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}


// ============ CALCULADORA ============

function toggleAvanzados() {
  const panel = document.getElementById('avanzados-panel');
  const icon  = document.getElementById('avanzados-toggle-icon');
  const open  = panel.style.display === 'none';
  panel.style.display = open ? 'block' : 'none';
  icon.textContent    = open ? '▲ ocultar' : '▼ ver';
}

function updateMargenLabel() {
  document.getElementById('c-margen-label').textContent =
    document.getElementById('c-margen').value + '%';
}

function calcular() {
  const peso     = parseFloat(document.getElementById('c-peso').value)      || 0;
  const horas    = parseFloat(document.getElementById('c-horas').value)     || 0;
  const filKg    = parseFloat(document.getElementById('c-filamento').value) || 0;
  const kwh      = parseFloat(document.getElementById('c-kwh').value)       || 0;
  const watts    = parseFloat(document.getElementById('c-watts').value)     || 95;
  const amort    = parseFloat(document.getElementById('c-amort').value)     || 0;
  const fallaPct = parseFloat(document.getElementById('c-falla').value)     || 0;
  const manoHora = parseFloat(document.getElementById('c-mano').value)      || 0;
  const minutos  = parseFloat(document.getElementById('c-minutos').value)   || 0;
  const margen   = parseFloat(document.getElementById('c-margen').value)    || 0;

  const costoFil   = (peso / 1000) * filKg;
  const costoElec  = horas * (watts / 1000) * kwh;
  const costoAmort = horas * amort;
  const costoFalla = (costoFil + costoElec + costoAmort) * (fallaPct / 100);
  const costoMano  = (minutos / 60) * manoHora;
  const costoTotal = costoFil + costoElec + costoAmort + costoFalla + costoMano;
  const precio     = costoTotal * (1 + margen / 100);
  const ganancia   = precio - costoTotal;

  document.getElementById('c-resultado').textContent    = '$' + Math.round(precio).toLocaleString('es-AR');
  document.getElementById('c-ganancia-neta').textContent = 'Ganancia neta: $' + Math.round(ganancia).toLocaleString('es-AR');
  document.getElementById('c-total-costo').textContent  = '$' + Math.round(costoTotal).toLocaleString('es-AR');

  const items = [
    { label: 'Filamento PLA',                      val: costoFil,   icon: '◎' },
    { label: `Electricidad (${watts}W · ${horas}hs)`, val: costoElec,  icon: '⚡' },
    { label: 'Amortización impresora',              val: costoAmort, icon: '◷' },
    { label: `Reserva fallas (${fallaPct}%)`,       val: costoFalla, icon: '⚠' },
    { label: 'Mano de obra / prep.',                val: costoMano,  icon: '◈' },
  ];

  document.getElementById('c-desglose').innerHTML = items.map(it => {
    const pct = costoTotal > 0 ? Math.round((it.val / costoTotal) * 100) : 0;
    return `<div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--border)">
      <span style="font-size:13px;width:18px;text-align:center;color:var(--text3)">${it.icon}</span>
      <span style="flex:1;font-size:13px;color:var(--text2)">${it.label}</span>
      <div style="width:80px;height:4px;background:var(--bg4);border-radius:2px;overflow:hidden;margin-right:8px">
        <div style="height:100%;width:${pct}%;background:var(--accent);border-radius:2px"></div>
      </div>
      <span style="font-family:'Space Mono',monospace;font-size:12px;color:var(--text);min-width:70px;text-align:right">
        $${Math.round(it.val).toLocaleString('es-AR')}
      </span>
    </div>`;
  }).join('');

  const rangos = [
    { label: 'Mínimo (sin margen)', pct: 0,   color: 'var(--red)'   },
    { label: 'Conservador',         pct: 20,  color: 'var(--amber)' },
    { label: 'Recomendado',         pct: 40,  color: 'var(--green)' },
    { label: 'Premium',             pct: 80,  color: 'var(--accent)'},
    { label: 'Lujo',                pct: 150, color: 'var(--cyan)'  },
  ];

  document.getElementById('c-rangos').innerHTML = rangos.map(r => {
    const p        = costoTotal * (1 + r.pct / 100);
    const isActive = Math.abs(r.pct - margen) < 15;
    return `<div style="display:flex;align-items:center;gap:12px;padding:8px 10px;border-radius:6px;
      background:${isActive ? 'rgba(124,109,250,0.08)' : 'transparent'};
      border:1px solid ${isActive ? 'var(--border2)' : 'transparent'}">
      <div style="width:8px;height:8px;border-radius:50%;background:${r.color};flex-shrink:0"></div>
      <span style="flex:1;font-size:13px;color:var(--text2)">${r.label} (+${r.pct}%)</span>
      <span style="font-family:'Space Mono',monospace;font-size:13px;font-weight:700;color:${r.color}">
        $${Math.round(p).toLocaleString('es-AR')}
      </span>
    </div>`;
  }).join('');
}


// ============ REFRESH GLOBAL ============

function refreshAll() {
  renderMetrics();
  renderPieChart(currentPeriod);
  renderLineChart(currentLinePeriod);
  renderUpcoming();
  if (currentView === 'pedidos')    renderCalendar();
  if (currentView === 'historial')  renderHistorial();
  if (currentView === 'materiales') renderMateriales();
}


// ============ INIT ============

function initApp() {
  renderMetrics();
  renderPieChart('semana');
  renderLineChart('semana');
  renderUpcoming();
  calcular();
}
