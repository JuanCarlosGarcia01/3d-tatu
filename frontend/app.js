/* ============================================================
   PrintControl — Lógica de la aplicación
   ============================================================ */

// ============ BASE DE DATOS (localStorage) ============

const STORAGE_KEY = 'printcontrol_v1';

function loadData() {
  try {
    const s = localStorage.getItem(STORAGE_KEY);
    return s ? JSON.parse(s) : null;
  } catch(e) { return null; }
}

function saveData() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(DB));
}

const DEFAULT_DATA = {
  pedidos: [],
  materiales: []
};

let DB = loadData() || JSON.parse(JSON.stringify(DEFAULT_DATA));

// Si quedaron datos de demo guardados, los limpiamos
if (DB.pedidos && DB.pedidos.some(p => p.cliente === 'Martín López')) {
  DB = JSON.parse(JSON.stringify(DEFAULT_DATA));
  saveData();
}


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
    calculadora:  'Calculadora de precios'
  };
  document.getElementById('topbar-title').textContent = titles[v];

  if (v === 'pedidos')   renderCalendar();
  if (v === 'historial') renderHistorial();
  if (v === 'materiales')renderMateriales();
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
    if (pieChart) { pieChart.data.labels = []; pieChart.data.datasets[0].data = []; pieChart.update(); }
    return;
  }

  legend.innerHTML = labels.map((l, i) => `
    <div class="legend-item">
      <div class="legend-dot" style="background:${colors[i % colors.length]}"></div>
      <span class="legend-name">${l}</span>
      <span class="legend-val">$${values[i].toLocaleString('es-AR')}</span>
    </div>`).join('');

  const ctx = document.getElementById('pieChart').getContext('2d');
  if (pieChart) pieChart.destroy();
  pieChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{ data: values, backgroundColor: colors.slice(0, labels.length), borderWidth: 0, hoverOffset: 4 }]
    },
    options: {
      cutout: '65%',
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => ` $${ctx.parsed.toLocaleString('es-AR')}` } }
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

renderMetrics();
renderPieChart('semana');
renderLineChart('semana');
renderUpcoming();
calcular();
