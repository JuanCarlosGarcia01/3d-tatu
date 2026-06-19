/* ============================================================
   PrintControl — Lógica de la aplicación
   Backend: Railway API (MySQL)
   ============================================================ */

const API = 'https://3d-tatu-production.up.railway.app';
let TOKEN = localStorage.getItem('pc_token') || null;

// ============ AUTH ============

async function handleLogin() {
  const password = document.getElementById('auth-pass').value;
  const errEl    = document.getElementById('auth-error');
  errEl.textContent = '';
  try {
    const res  = await fetch(`${API}/api/login`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ password })
    });
    const data = await res.json();
    if (!res.ok) { errEl.textContent = data.error || 'Error al iniciar sesión'; return; }
    TOKEN = data.token;
    localStorage.setItem('pc_token', TOKEN);
    const email = document.getElementById('auth-email').value;
    localStorage.setItem('pc_email', email);
    showApp();
  } catch(e) {
    errEl.textContent = 'No se pudo conectar con el servidor';
  }
}

function handleRegister() {
  document.getElementById('auth-error').textContent = 'Contactá al administrador para obtener acceso.';
}

function handleLogout() {
  TOKEN = null;
  localStorage.removeItem('pc_token');
  localStorage.removeItem('pc_email');
  document.getElementById('app-screen').style.display   = 'none';
  document.getElementById('login-screen').style.display = 'flex';
}

function showApp() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app-screen').style.display   = 'block';
  document.getElementById('user-email').textContent     = localStorage.getItem('pc_email') || '';
  initApp();
}

// Al cargar la página, si hay token saltar login
if (TOKEN) {
  showApp();
}

// ============ API HELPERS ============

async function apiGet(path) {
  const res = await fetch(`${API}${path}`, {
    headers: { 'Authorization': `Bearer ${TOKEN}` }
  });
  if (res.status === 401) { handleLogout(); return []; }
  return res.json();
}

async function apiPost(path, body) {
  const res = await fetch(`${API}${path}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOKEN}` },
    body:    JSON.stringify(body)
  });
  return res.json();
}

async function apiPut(path, body) {
  const res = await fetch(`${API}${path}`, {
    method:  'PUT',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOKEN}` },
    body:    JSON.stringify(body)
  });
  return res.json();
}

async function apiDelete(path) {
  const res = await fetch(`${API}${path}`, {
    method:  'DELETE',
    headers: { 'Authorization': `Bearer ${TOKEN}` }
  });
  return res.json();
}

// ============ CACHÉ LOCAL ============

let DB = { pedidos: [], materiales: [], gastos: [] };

async function loadData() {
  try {
    const [pedidos, materiales] = await Promise.all([
      apiGet('/api/pedidos'),
      apiGet('/api/materiales')
    ]);
    DB.pedidos    = Array.isArray(pedidos)    ? pedidos    : [];
    DB.materiales = Array.isArray(materiales) ? materiales : [];
    DB.gastos     = [];
  } catch(e) {
    console.error('Error cargando datos:', e);
  }
}

// ============ NAVEGACIÓN ============

let currentView        = 'dashboard';
let editingId          = null;
let editingMatId       = null;
let editingGastoId     = null;
let consumoRowCount    = 0;

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
    calculadora: 'Calculadora de precios',
    gastos:      'Registro de gastos'
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

// ============ MÉTRICAS ============

function renderMetrics() {
  const pedidos    = DB.pedidos;
  const today      = new Date();
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

  const entregados = pedidos.filter(p => p.estado === 'Entregado');
  const activos    = pedidos.filter(p => p.estado !== 'Entregado' && p.estado !== 'Cancelado');
  const totalGan   = entregados.reduce((s, p) => s + (p.precio - p.costo), 0);
  const mesGan     = entregados
    .filter(p => new Date(p.fecha) >= monthStart)
    .reduce((s, p) => s + (p.precio - p.costo), 0);
  const urgentes   = activos.filter(p => daysUntil(p.fecha) <= 2).length;

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

function renderPieChart(period) {
  const pedidos = getPeriodPedidos(period);
  const legend  = document.getElementById('pie-legend');

  const byMat = {};
  pedidos.forEach(p => {
    if (!byMat[p.material]) byMat[p.material] = 0;
    byMat[p.material] += p.precio - p.costo;
  });
  const ganLabels = Object.keys(byMat);
  const ganValues = Object.values(byMat);
  const totalGan  = ganValues.reduce((s, v) => s + v, 0);
  const ganColors = ['#7c6dfa','#3dd68c','#38bdf8','#f5a623','#a78bfa','#34d399'];

  if (!ganLabels.length) {
    legend.innerHTML = '<div style="color:var(--text3);font-size:13px">Sin datos en este período</div>';
    if (pieChart) pieChart.destroy();
    return;
  }

  legend.innerHTML = ganLabels.map((l, i) => `
    <div class="legend-item">
      <div class="legend-dot" style="background:${ganColors[i % ganColors.length]}"></div>
      <span class="legend-name">${l}</span>
      <span class="legend-val" style="color:var(--green)">+$${ganValues[i].toLocaleString('es-AR')}</span>
    </div>`).join('');

  const ctx = document.getElementById('pieChart').getContext('2d');
  if (pieChart) pieChart.destroy();
  pieChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      datasets: [{
        data:            ganValues,
        backgroundColor: ganLabels.map((_, i) => ganColors[i % ganColors.length]),
        borderWidth:     2,
        borderColor:     '#141416',
        hoverOffset:     4,
      }]
    },
    options: {
      cutout: '60%',
      plugins: {
        legend:  { display: false },
        tooltip: { callbacks: { label: ctx => ` +$${ctx.parsed.toLocaleString('es-AR')}` } }
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
        borderColor:     '#7c6dfa',
        backgroundColor: 'rgba(124,109,250,0.08)',
        borderWidth:     2,
        fill:            true,
        tension:         0.4,
        pointBackgroundColor: '#7c6dfa',
        pointRadius:     4
      }]
    },
    options: {
      plugins: {
        legend:  { display: false },
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
        <div class="pedido-meta"><span>${p.material} · ${p.color}</span><span>${p.stl.split('/').pop()}</span></div>
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

  const headers = document.getElementById('cal-headers');
  headers.innerHTML = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'].map(d => `<div class="cal-header">${d}</div>`).join('');

  const first    = new Date(calDate.getFullYear(), calDate.getMonth(), 1);
  const last     = new Date(calDate.getFullYear(), calDate.getMonth() + 1, 0);
  const startDay = first.getDay();
  const today    = new Date(); today.setHours(0, 0, 0, 0);
  const grid     = document.getElementById('calendar-grid');
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

    html += `<div class="cal-day${isToday?' today':''}${pedidosDay.length?' has-order':''}${urgent?' urgent':''}">
      <span>${d}</span><div class="cal-dots">${dots}</div>
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
      <td class="td-mono" style="color:var(--green)">$${Number(p.precio).toLocaleString('es-AR')}</td>
      <td class="td-mono">${p.fecha}</td>
      <td><span class="status-badge ${statusMap[p.estado] || 's-pendiente'}">${p.estado}</span></td>
    </tr>`).join('');
}

function filterHistorial() { renderHistorial(); }

// ============ MATERIALES ============

function renderMateriales() {
  const grid = document.getElementById('mat-grid');
  grid.innerHTML = DB.materiales.map(m => `
    <div class="mat-card" onclick="openMatModal(${m.id})" style="cursor:pointer;transition:border-color 0.15s"
      onmouseover="this.style.borderColor='var(--border2)'" onmouseout="this.style.borderColor='var(--border)'">
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
          $${Number(m.precio_kg || 0).toLocaleString('es-AR')}
        </span>
      </div>
    </div>`).join('');
}

// ============ CHIPS DE COLOR (color principal del pedido) ============

let selectedColors = []; // hasta 4 colores seleccionados

function getColoresPorMaterial(material) {
  return DB.materiales
    .filter(m => m.tipo.toLowerCase() === material.toLowerCase())
    .map(m => m.color);
}

function renderColorChips(material, preselected = []) {
  selectedColors = Array.isArray(preselected) ? [...preselected] : [];
  const wrap  = document.getElementById('color-chips-wrap');
  const msg   = document.getElementById('color-chips-msg');
  const input = document.getElementById('f-color');
  const colores = getColoresPorMaterial(material);

  if (!colores.length) {
    wrap.innerHTML = '';
    msg.textContent = `No tenés ${material} cargado en Materiales.`;
    msg.style.display = 'block';
    input.value = '';
    return;
  }

  msg.style.display = 'none';

  function redraw() {
    wrap.innerHTML = colores.map(color => {
      const activo = selectedColors.includes(color);
      return `<button type="button"
        onclick="toggleColorChip('${color}')"
        style="
          padding:5px 12px;border-radius:20px;font-size:12px;cursor:pointer;
          border:1px solid ${activo ? 'var(--accent)' : 'var(--border)'};
          background:${activo ? 'rgba(124,109,250,0.18)' : 'var(--bg4)'};
          color:${activo ? 'var(--accent)' : 'var(--text2)'};
          font-family:'DM Sans',sans-serif;
          font-weight:${activo ? '600' : '400'};
          transition:all 0.12s;
        ">${color}</button>`;
    }).join('');
    input.value = selectedColors.join(', ');
    const label = document.getElementById('color-count-label');
    label.textContent = `(${selectedColors.length}/4 seleccionados)`;
    label.style.color = selectedColors.length >= 4 ? 'var(--amber)' : 'var(--text3)';
  }

  redraw();
  // Guardar redraw en el wrap para reutilizar desde toggleColorChip
  wrap._redraw = redraw;
}

function toggleColorChip(color) {
  if (selectedColors.includes(color)) {
    selectedColors = selectedColors.filter(c => c !== color);
  } else {
    if (selectedColors.length >= 4) {
      showToast('Máximo 4 colores por pedido');
      return;
    }
    selectedColors.push(color);
  }
  const wrap = document.getElementById('color-chips-wrap');
  if (wrap._redraw) wrap._redraw();
}

function onMaterialChange() {
  const material = document.getElementById('f-material').value;
  renderColorChips(material, []);
}

// ============ CONSUMOS DE MATERIAL (filas dinámicas) ============

function agregarConsumoRow(data) {
  consumoRowCount++;
  const rowId    = `consumo-${consumoRowCount}`;
  const matVal   = data?.material || 'PLA';
  const colorVal = data?.color    || '';
  const gramVal  = data?.gramos   || '';

  const wrap = document.createElement('div');
  wrap.id    = rowId;
  wrap.style = 'display:flex;gap:8px;align-items:flex-start;background:var(--bg3);border:1px solid var(--border);border-radius:8px;padding:10px 12px';

  // Colores disponibles para el material seleccionado
  const coloresDispo = getColoresPorMaterial(matVal);

  wrap.innerHTML = `
    <div style="flex:1;display:flex;flex-direction:column;gap:8px">
      <div style="display:flex;gap:8px;align-items:center">
        <select class="form-input consumo-material" style="flex:1;font-size:12px" onchange="onConsumoMaterialChange('${rowId}')">
          ${['PLA','ABS','PETG','TPU','Resina'].map(m => `<option ${m===matVal?'selected':''}>${m}</option>`).join('')}
        </select>
        <input class="form-input consumo-gramos" type="number" placeholder="Gramos" value="${gramVal}"
          style="width:90px;font-size:12px" min="0">
        <button type="button" onclick="document.getElementById('${rowId}').remove()"
          style="background:none;border:1px solid var(--border);border-radius:6px;color:var(--red);width:32px;height:32px;cursor:pointer;flex-shrink:0;font-size:14px">✕</button>
      </div>
      <div class="consumo-color-chips" style="display:flex;flex-wrap:wrap;gap:5px">
        ${coloresDispo.length
          ? coloresDispo.map(c => `
              <button type="button" onclick="toggleConsumoChip('${rowId}','${c}')"
                class="consumo-chip"
                data-color="${c}"
                style="padding:3px 10px;border-radius:14px;font-size:11px;cursor:pointer;
                  border:1px solid ${c===colorVal?'var(--accent)':'var(--border)'};
                  background:${c===colorVal?'rgba(124,109,250,0.18)':'var(--bg4)'};
                  color:${c===colorVal?'var(--accent)':'var(--text2)'};
                  font-family:'DM Sans',sans-serif;transition:all 0.12s">${c}</button>`).join('')
          : `<span style="font-size:11px;color:var(--text3)">No hay colores de ${matVal} en stock</span>`
        }
      </div>
      <input type="hidden" class="consumo-color-value" value="${colorVal}">
    </div>
  `;
  document.getElementById('consumos-list').appendChild(wrap);
}

function toggleConsumoChip(rowId, color) {
  const row   = document.getElementById(rowId);
  const input = row.querySelector('.consumo-color-value');
  const chips = row.querySelectorAll('.consumo-chip');

  // Solo 1 color por fila de consumo (radio behavior)
  const yaSeleccionado = input.value === color;
  input.value = yaSeleccionado ? '' : color;

  chips.forEach(btn => {
    const activo = btn.dataset.color === input.value;
    btn.style.border      = `1px solid ${activo ? 'var(--accent)' : 'var(--border)'}`;
    btn.style.background  = activo ? 'rgba(124,109,250,0.18)' : 'var(--bg4)';
    btn.style.color       = activo ? 'var(--accent)' : 'var(--text2)';
  });
}

function onConsumoMaterialChange(rowId) {
  const row      = document.getElementById(rowId);
  const material = row.querySelector('.consumo-material').value;
  const colores  = getColoresPorMaterial(material);
  const chipsDiv = row.querySelector('.consumo-color-chips');
  const input    = row.querySelector('.consumo-color-value');
  input.value    = '';

  chipsDiv.innerHTML = colores.length
    ? colores.map(c => `
        <button type="button" onclick="toggleConsumoChip('${rowId}','${c}')"
          class="consumo-chip" data-color="${c}"
          style="padding:3px 10px;border-radius:14px;font-size:11px;cursor:pointer;
            border:1px solid var(--border);background:var(--bg4);color:var(--text2);
            font-family:'DM Sans',sans-serif;transition:all 0.12s">${c}</button>`).join('')
    : `<span style="font-size:11px;color:var(--text3)">No hay colores de ${material} en stock</span>`;
}

function limpiarConsumoRows() {
  document.getElementById('consumos-list').innerHTML = '';
  consumoRowCount = 0;
}

function getConsumosFromForm() {
  const rows = document.querySelectorAll('#consumos-list > div');
  const consumos = [];
  rows.forEach(row => {
    const material = row.querySelector('.consumo-material').value;
    const color    = row.querySelector('.consumo-color-value').value.trim();
    const gramos   = parseFloat(row.querySelector('.consumo-gramos').value) || 0;
    if (color && gramos > 0) consumos.push({ material, color, gramos });
  });
  return consumos;
}


// ============ MODAL PEDIDO ============

function openModal(mode, id) {
  editingId = id || null;
  const modal  = document.getElementById('pedido-modal');
  const delBtn = document.getElementById('btn-delete-pedido');
  document.getElementById('modal-title-text').textContent = mode === 'nuevo' ? 'Nuevo pedido' : 'Editar pedido';

  limpiarConsumoRows();
  selectedColors = [];

  if (mode === 'nuevo') {
    ['f-cliente','f-contacto','f-stl','f-precio','f-costo','f-fecha','f-horas','f-notas']
      .forEach(fid => document.getElementById(fid).value = '');
    document.getElementById('f-color').value   = '';
    document.getElementById('f-material').value = 'PLA';
    document.getElementById('f-estado').value   = 'Pendiente';
    renderColorChips('PLA', []);
    agregarConsumoRow();
    delBtn.style.display = 'none';
  } else {
    const p = DB.pedidos.find(x => x.id === id);
    if (!p) return;
    document.getElementById('f-cliente').value  = p.cliente;
    document.getElementById('f-contacto').value = p.contacto;
    document.getElementById('f-stl').value      = p.stl;
    document.getElementById('f-material').value = p.material;
    document.getElementById('f-precio').value   = p.precio;
    document.getElementById('f-costo').value    = p.costo;
    document.getElementById('f-fecha').value    = p.fecha;
    document.getElementById('f-horas').value    = p.horas;
    document.getElementById('f-estado').value   = p.estado;
    document.getElementById('f-notas').value    = p.notas;

    // Cargar colores preseleccionados (pueden venir separados por coma)
    const coloresPre = p.color ? p.color.split(',').map(c => c.trim()).filter(Boolean) : [];
    renderColorChips(p.material, coloresPre);

    if (Array.isArray(p.consumos) && p.consumos.length) {
      p.consumos.forEach(c => agregarConsumoRow(c));
    } else {
      agregarConsumoRow();
    }

    delBtn.style.display = 'inline-block';
  }
  modal.classList.add('open');
}

function editPedido(id) { openModal('edit', id); }
function closeModal()   { document.getElementById('pedido-modal').classList.remove('open'); }

async function savePedido() {
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
    notas:    document.getElementById('f-notas').value,
    consumos: getConsumosFromForm()
  };

  if (editingId) {
    const updated = await apiPut(`/api/pedidos/${editingId}`, p);
    const idx = DB.pedidos.findIndex(x => x.id === editingId);
    DB.pedidos[idx] = updated;
  } else {
    const created = await apiPost('/api/pedidos', p);
    DB.pedidos.push(created);
  }

  // Recargar materiales porque el stock pudo haber cambiado
  DB.materiales = await apiGet('/api/materiales');

  closeModal();
  showToast('Pedido guardado correctamente');
  refreshAll();
}

async function deletePedido() {
  if (!confirm('¿Eliminar este pedido?')) return;
  await apiDelete(`/api/pedidos/${editingId}`);
  DB.pedidos = DB.pedidos.filter(x => x.id !== editingId);
  DB.materiales = await apiGet('/api/materiales');
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
    title.textContent    = 'Editar material';
    delBtn.style.display = 'inline-block';
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

async function saveMaterial() {
  const data = {
    tipo:      document.getElementById('mf-tipo').value,
    color:     document.getElementById('mf-color').value     || 'Sin color',
    stock:     parseFloat(document.getElementById('mf-stock').value)     || 0,
    precio_kg: parseFloat(document.getElementById('mf-precio-kg').value) || 0,
  };

  if (editingMatId) {
    const updated = await apiPut(`/api/materiales/${editingMatId}`, data);
    const idx = DB.materiales.findIndex(x => x.id === editingMatId);
    DB.materiales[idx] = updated;
    showToast('Material actualizado');
  } else {
    const created = await apiPost('/api/materiales', data);
    DB.materiales.push(created);
    showToast('Material agregado');
  }

  closeMatModal();
  renderMateriales();
}

async function deleteMaterial() {
  if (!confirm('¿Eliminar este material?')) return;
  await apiDelete(`/api/materiales/${editingMatId}`);
  DB.materiales = DB.materiales.filter(x => x.id !== editingMatId);
  closeMatModal();
  showToast('Material eliminado');
  renderMateriales();
}

// ============ GASTOS ============

function openGastoModal(id) {
  editingGastoId = id || null;
  const delBtn = document.getElementById('btn-delete-gasto');
  document.querySelector('#gasto-modal .modal-title').textContent = id ? 'Editar gasto' : 'Nuevo gasto';

  if (id) {
    const g = DB.gastos.find(x => x.id === id);
    if (!g) return;
    document.getElementById('g-descripcion').value = g.descripcion || '';
    document.getElementById('g-categoria').value   = g.categoria   || 'Filamento';
    document.getElementById('g-monto').value       = g.monto;
    document.getElementById('g-fecha').value       = g.fecha;
    delBtn.style.display = 'inline-block';
  } else {
    document.getElementById('g-descripcion').value = '';
    document.getElementById('g-monto').value       = '';
    document.getElementById('g-fecha').value       = new Date().toISOString().slice(0, 10);
    document.getElementById('g-categoria').value   = 'Filamento';
    delBtn.style.display = 'none';
  }
  document.getElementById('gasto-modal').classList.add('open');
}

function closeGastoModal() { document.getElementById('gasto-modal').classList.remove('open'); }

function saveGasto() {
  const monto = parseFloat(document.getElementById('g-monto').value) || 0;
  if (!monto) { alert('Ingresá un monto'); return; }

  const g = {
    descripcion: document.getElementById('g-descripcion').value,
    categoria:   document.getElementById('g-categoria').value,
    monto,
    fecha:       document.getElementById('g-fecha').value || new Date().toISOString().slice(0, 10),
  };

  if (editingGastoId) {
    const idx = DB.gastos.findIndex(x => x.id === editingGastoId);
    DB.gastos[idx] = { ...DB.gastos[idx], ...g };
    showToast('Gasto actualizado');
  } else {
    DB.gastos.push({ id: Date.now(), ...g });
    showToast('Gasto registrado');
  }

  closeGastoModal();
  renderGastos();
}

function deleteGasto() {
  if (!confirm('¿Eliminar este gasto?')) return;
  DB.gastos = DB.gastos.filter(x => x.id !== editingGastoId);
  closeGastoModal();
  showToast('Gasto eliminado');
  renderGastos();
}

function renderGastos() {
  if (!DB.gastos) DB.gastos = [];
  const gastos   = DB.gastos;
  const total    = gastos.reduce((s, g) => s + g.monto, 0);
  const mesStart = new Date(); mesStart.setDate(1);
  const totalMes = gastos.filter(g => new Date(g.fecha) >= mesStart).reduce((s, g) => s + g.monto, 0);
  const cantMes  = gastos.filter(g => new Date(g.fecha) >= mesStart).length;

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
    </div>`;

  const recEl = document.getElementById('gastos-recientes');
  if (!gastos.length) {
    recEl.innerHTML = '<div style="color:var(--text3);font-size:13px;padding:8px">Sin gastos aún</div>';
  } else {
    recEl.innerHTML = [...gastos]
      .sort((a, b) => new Date(b.fecha) - new Date(a.fecha))
      .slice(0, 10)
      .map(g => `
        <div class="gasto-item" onclick="openGastoModal(${g.id})" style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--border);cursor:pointer">
          <div style="flex:1">
            <div style="font-size:13px;font-weight:500">${g.descripcion || g.categoria}</div>
            <div style="font-size:11px;color:var(--text3)">${g.categoria} · ${g.fecha}</div>
          </div>
          <div style="font-family:'Space Mono',monospace;font-size:13px;font-weight:700;color:var(--red)">-$${g.monto.toLocaleString('es-AR')}</div>
        </div>`).join('');
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

  document.getElementById('c-resultado').textContent     = '$' + Math.round(precio).toLocaleString('es-AR');
  document.getElementById('c-ganancia-neta').textContent = 'Ganancia neta: $' + Math.round(ganancia).toLocaleString('es-AR');
  document.getElementById('c-total-costo').textContent   = '$' + Math.round(costoTotal).toLocaleString('es-AR');

  const items = [
    { label: 'Filamento',                              val: costoFil,   icon: '◎' },
    { label: `Electricidad (${watts}W · ${horas}hs)`, val: costoElec,  icon: '⚡' },
    { label: 'Amortización impresora',                 val: costoAmort, icon: '◷' },
    { label: `Reserva fallas (${fallaPct}%)`,          val: costoFalla, icon: '⚠' },
    { label: 'Mano de obra / prep.',                   val: costoMano,  icon: '◈' },
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
    { label: 'Mínimo (sin margen)', pct: 0,   color: 'var(--red)'    },
    { label: 'Conservador',         pct: 20,  color: 'var(--amber)'  },
    { label: 'Recomendado',         pct: 40,  color: 'var(--green)'  },
    { label: 'Premium',             pct: 80,  color: 'var(--accent)' },
    { label: 'Lujo',                pct: 150, color: 'var(--cyan)'   },
  ];

  document.getElementById('c-rangos').innerHTML = rangos.map(r => {
    const p        = costoTotal * (1 + r.pct / 100);
    const isActive = Math.abs(r.pct - margen) < 15;
    return `<div style="display:flex;align-items:center;gap:12px;padding:8px 10px;border-radius:6px;
      background:${isActive?'rgba(124,109,250,0.08)':'transparent'};
      border:1px solid ${isActive?'var(--border2)':'transparent'}">
      <div style="width:8px;height:8px;border-radius:50%;background:${r.color};flex-shrink:0"></div>
      <span style="flex:1;font-size:13px;color:var(--text2)">${r.label} (+${r.pct}%)</span>
      <span style="font-family:'Space Mono',monospace;font-size:13px;font-weight:700;color:${r.color}">
        $${Math.round(p).toLocaleString('es-AR')}
      </span>
    </div>`;
  }).join('');
}

// ============ REFRESH ============

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

async function initApp() {
  await loadData();
  renderMetrics();
  renderPieChart('semana');
  renderLineChart('semana');
  renderUpcoming();
  calcular();
}

// ============ EXPONER FUNCIONES ============

window.handleLogin      = handleLogin;
window.handleRegister   = handleRegister;
window.handleLogout     = handleLogout;
window.setView          = setView;
window.setPeriod        = setPeriod;
window.setLinePeriod    = setLinePeriod;
window.openModal        = openModal;
window.closeModal       = closeModal;
window.savePedido       = savePedido;
window.deletePedido     = deletePedido;
window.editPedido       = editPedido;
window.changeMonth      = changeMonth;
window.openMatModal     = openMatModal;
window.closeMatModal    = closeMatModal;
window.saveMaterial     = saveMaterial;
window.deleteMaterial   = deleteMaterial;
window.openGastoModal   = openGastoModal;
window.closeGastoModal  = closeGastoModal;
window.saveGasto        = saveGasto;
window.deleteGasto      = deleteGasto;
window.calcular         = calcular;
window.filterHistorial  = filterHistorial;
window.toggleAvanzados   = toggleAvanzados;
window.updateMargenLabel = updateMargenLabel;
window.agregarConsumoRow     = agregarConsumoRow;
window.toggleColorChip       = toggleColorChip;
window.onMaterialChange      = onMaterialChange;
window.toggleConsumoChip     = toggleConsumoChip;
window.onConsumoMaterialChange = onConsumoMaterialChange;
