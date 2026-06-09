/* ============================================================
   PrintControl — Firebase Cloud Functions
   Alertas automáticas via Telegram
   ============================================================ */

const { onSchedule }    = require('firebase-functions/v2/scheduler');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore }  = require('firebase-admin/firestore');
const https             = require('https');

initializeApp();
const db = getFirestore();

// ── Configuración Telegram ──────────────────────────────────
const TELEGRAM_TOKEN   = '8935855020:AAFnmtOp0OF11Hn-wdpbB_sIBLj0aoXkDpk';
const TELEGRAM_CHAT_ID = '921937825';

// ── Helper: mandar mensaje a Telegram ──────────────────────
function sendTelegram(mensaje) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      chat_id:    TELEGRAM_CHAT_ID,
      text:       mensaje,
      parse_mode: 'HTML'
    });
    const options = {
      hostname: 'api.telegram.org',
      path:     `/bot${TELEGRAM_TOKEN}/sendMessage`,
      method:   'POST',
      headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── Helper: días hasta una fecha ───────────────────────────
function daysUntil(dateStr) {
  const d     = new Date(dateStr + 'T00:00:00');
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.floor((d - today) / 86400000);
}

// ── Obtener todos los usuarios ──────────────────────────────
async function getAllUsers() {
  const usersSnap = await db.collection('users').listDocuments();
  return usersSnap;
}

// ══════════════════════════════════════════════════════════════
//  FUNCIÓN 1 — Alertas de pedidos (cada mañana a las 8:00 AM)
// ══════════════════════════════════════════════════════════════
exports.alertasPedidos = onSchedule(
  { schedule: '0 8 * * *', timeZone: 'America/Argentina/Buenos_Aires' },
  async () => {
    const users = await getAllUsers();

    for (const userRef of users) {
      const pedidosSnap = await userRef.collection('pedidos').get();
      const pedidos = pedidosSnap.docs.map(d => ({ id: d.id, ...d.data() }));

      const activos = pedidos.filter(p => p.estado !== 'Entregado' && p.estado !== 'Cancelado');
      if (!activos.length) continue;

      const vencenHoy     = activos.filter(p => daysUntil(p.fecha) === 0);
      const vencenManiana = activos.filter(p => daysUntil(p.fecha) === 1);
      const vencidos      = activos.filter(p => daysUntil(p.fecha) < 0);

      let alertas = [];

      if (vencidos.length) {
        alertas.push(`🔴 <b>VENCIDOS (${vencidos.length})</b>`);
        vencidos.forEach(p => {
          const dias = Math.abs(daysUntil(p.fecha));
          alertas.push(`  • ${p.cliente} — venció hace ${dias} día${dias>1?'s':''}`);
        });
      }

      if (vencenHoy.length) {
        alertas.push(`🟠 <b>VENCEN HOY (${vencenHoy.length})</b>`);
        vencenHoy.forEach(p => alertas.push(`  • ${p.cliente} — ${p.material} ${p.color}`));
      }

      if (vencenManiana.length) {
        alertas.push(`🟡 <b>VENCEN MAÑANA (${vencenManiana.length})</b>`);
        vencenManiana.forEach(p => alertas.push(`  • ${p.cliente} — ${p.material} ${p.color}`));
      }

      if (alertas.length) {
        const msg = `🖨️ <b>PrintControl — Alertas de pedidos</b>\n\n` + alertas.join('\n');
        await sendTelegram(msg);
      }
    }
  }
);

// ══════════════════════════════════════════════════════════════
//  FUNCIÓN 2 — Stock bajo de materiales (cada mañana a las 8:00 AM)
// ══════════════════════════════════════════════════════════════
const STOCK_MINIMO_G = 200; // Alerta si queda menos de 200g

exports.alertasMateriales = onSchedule(
  { schedule: '0 8 * * *', timeZone: 'America/Argentina/Buenos_Aires' },
  async () => {
    const users = await getAllUsers();

    for (const userRef of users) {
      const matsSnap = await userRef.collection('materiales').get();
      const materiales = matsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

      const bajosStock = materiales.filter(m => (m.stock || 0) < STOCK_MINIMO_G);
      if (!bajosStock.length) continue;

      let lineas = bajosStock.map(m =>
        `  • ${m.tipo} ${m.color}: <b>${m.stock}g restantes</b>`
      );

      const msg =
        `📦 <b>PrintControl — Stock bajo de materiales</b>\n\n` +
        `Los siguientes materiales tienen menos de ${STOCK_MINIMO_G}g:\n\n` +
        lineas.join('\n') +
        `\n\n💡 Acordate de reponer antes de tu próxima impresión.`;

      await sendTelegram(msg);
    }
  }
);

// ══════════════════════════════════════════════════════════════
//  FUNCIÓN 3 — Resumen semanal (lunes a las 9:00 AM)
// ══════════════════════════════════════════════════════════════
exports.resumenSemanal = onSchedule(
  { schedule: '0 9 * * 1', timeZone: 'America/Argentina/Buenos_Aires' },
  async () => {
    const users = await getAllUsers();

    for (const userRef of users) {
      const [pedidosSnap, gastosSnap] = await Promise.all([
        userRef.collection('pedidos').get(),
        userRef.collection('gastos').get()
      ]);

      const pedidos  = pedidosSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      const gastos   = gastosSnap.docs.map(d => ({ id: d.id, ...d.data() }));

      // Semana actual
      const hoy       = new Date(); hoy.setHours(23,59,59);
      const semStart  = new Date(); semStart.setDate(hoy.getDate() - 7); semStart.setHours(0,0,0,0);

      const entregados = pedidos.filter(p =>
        p.estado === 'Entregado' && new Date(p.fecha) >= semStart && new Date(p.fecha) <= hoy
      );
      const activos = pedidos.filter(p => p.estado !== 'Entregado' && p.estado !== 'Cancelado');

      const ingresos  = entregados.reduce((s,p) => s + (p.precio||0), 0);
      const ganancia  = entregados.reduce((s,p) => s + (p.precio||0) - (p.costo||0), 0);

      const gastosSem = gastos
        .filter(g => !g.recurrente && new Date(g.fecha) >= semStart)
        .reduce((s,g) => s + (g.monto||0), 0);
      const gastosRec = gastos
        .filter(g => g.recurrente)
        .reduce((s,g) => s + (g.monto||0), 0);

      const neto = ganancia - gastosSem - gastosRec;

      const proximos = activos
        .sort((a,b) => new Date(a.fecha) - new Date(b.fecha))
        .slice(0, 3)
        .map(p => {
          const d = daysUntil(p.fecha);
          const label = d < 0 ? `vencido hace ${Math.abs(d)}d` : d === 0 ? 'hoy' : d === 1 ? 'mañana' : `en ${d} días`;
          return `  • ${p.cliente} (${label})`;
        });

      const msg =
        `📊 <b>PrintControl — Resumen semanal</b>\n` +
        `<i>${semStart.toLocaleDateString('es-AR')} al ${hoy.toLocaleDateString('es-AR')}</i>\n\n` +
        `💰 Ingresos: <b>$${ingresos.toLocaleString('es-AR')}</b>\n` +
        `📈 Ganancia bruta: <b>$${ganancia.toLocaleString('es-AR')}</b>\n` +
        `💸 Gastos: <b>$${(gastosSem + gastosRec).toLocaleString('es-AR')}</b>\n` +
        `✅ Neto real: <b>$${neto.toLocaleString('es-AR')}</b>\n\n` +
        `🖨️ Pedidos entregados esta semana: ${entregados.length}\n` +
        `⏳ Pedidos activos: ${activos.length}\n` +
        (proximos.length ? `\n📅 Próximos vencimientos:\n${proximos.join('\n')}` : '');

      await sendTelegram(msg);
    }
  }
);
