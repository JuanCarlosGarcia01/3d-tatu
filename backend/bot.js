const TelegramBot = require('node-telegram-bot-api');
const cron = require('node-cron');
const { initializeApp } = require('firebase/app');
const { getFirestore, doc, getDoc } = require('firebase/firestore');

const bot = new TelegramBot('8935855020:AAFnmtOp0OF11Hn-wdpbB_sIBLj0aoXkDpk');
const CHAT_ID = '921937825';

const firebaseConfig = {
  apiKey:            "AIzaSyCscW8GmWeFverwZmUH9Vdw0co_XIf-Fmk",
  authDomain:        "tatu3d-cd25b.firebaseapp.com",
  projectId:         "tatu3d-cd25b",
  storageBucket:     "tatu3d-cd25b.firebasestorage.app",
  messagingSenderId: "897677948498",
  appId:             "1:897677948498:web:bf4a444f7f3c263bb9518b"
};

const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);

function daysUntil(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const today = new Date(); today.setHours(0,0,0,0);
  return Math.floor((d - today) / 86400000);
}

async function sendDailyReport() {
  const snap = await getDoc(doc(db, 'printcontrol', 'data'));
  if (!snap.exists()) return;
  const { pedidos = [], materiales = [] } = snap.data();

  // Pedidos próximos (7 días)
  const proximos = pedidos
    .filter(p => p.estado !== 'Entregado' && p.estado !== 'Cancelado')
    .map(p => ({ ...p, dias: daysUntil(p.fecha) }))
    .filter(p => p.dias <= 7)
    .sort((a, b) => a.dias - b.dias);

  // Stock bajo (menos de 200g)
  const stockBajo = materiales.filter(m => m.stock < 200);

  let msg = `📊 *Resumen diario — Tatú 3D*\n`;
  msg += `_${new Date().toLocaleDateString('es-AR', { weekday:'long', day:'numeric', month:'long' })}_\n\n`;

  // Pedidos
  msg += `*📦 Pedidos próximos (7 días)*\n`;
  if (!proximos.length) {
    msg += `✅ Sin vencimientos cercanos\n`;
  } else {
    proximos.forEach(p => {
      const emoji = p.dias <= 1 ? '🔴' : p.dias <= 3 ? '🟡' : '🟢';
      const label = p.dias < 0 ? `⚠️ VENCIDO` : p.dias === 0 ? 'Hoy' : p.dias === 1 ? 'Mañana' : `en ${p.dias} días`;
      msg += `${emoji} *${p.cliente}* — ${label}\n`;
      msg += `   ${p.material} · ${p.color} · $${p.precio.toLocaleString('es-AR')}\n`;
    });
  }

  // Stock
  msg += `\n*🧵 Stock de materiales*\n`;
  if (!materiales.length) {
    msg += `Sin materiales cargados\n`;
  } else {
    materiales.forEach(m => {
      const emoji = m.stock < 100 ? '🔴' : m.stock < 200 ? '🟡' : '🟢';
      msg += `${emoji} ${m.tipo} ${m.color} — *${m.stock}g*\n`;
    });
  }

  if (stockBajo.length) {
    msg += `\n⚠️ *${stockBajo.length} material(es) con stock bajo*`;
  }

  bot.sendMessage(CHAT_ID, msg, { parse_mode: 'Markdown' });
}

bot.on('message', async (msg) => {
  if (msg.chat.id.toString() !== CHAT_ID) return; // solo vos

  const texto = msg.text?.toLowerCase();

  if (texto === '/pedidos') {
    const snap = await getDoc(doc(db, 'printcontrol', 'data'));
    const { pedidos = [] } = snap.data();
    const activos = pedidos
      .filter(p => p.estado !== 'Entregado' && p.estado !== 'Cancelado')
      .sort((a, b) => new Date(a.fecha) - new Date(b.fecha));

    if (!activos.length) return bot.sendMessage(CHAT_ID, '✅ Sin pedidos activos');

    let msg2 = `*📦 Pedidos activos (${activos.length})*\n\n`;
    activos.forEach(p => {
      const d = daysUntil(p.fecha);
      const emoji = d <= 1 ? '🔴' : d <= 3 ? '🟡' : '🟢';
      const label = d < 0 ? `⚠️ VENCIDO` : d === 0 ? 'Hoy' : d === 1 ? 'Mañana' : `en ${d} días`;
      msg2 += `${emoji} *${p.cliente}* — ${label}\n`;
      msg2 += `   ${p.material} · ${p.color} · $${p.precio.toLocaleString('es-AR')}\n\n`;
    });
    bot.sendMessage(CHAT_ID, msg2, { parse_mode: 'Markdown' });
  }

  else if (texto === '/stock') {
    const snap = await getDoc(doc(db, 'printcontrol', 'data'));
    const { materiales = [] } = snap.data();

    if (!materiales.length) return bot.sendMessage(CHAT_ID, 'Sin materiales cargados');

    let msg2 = `*🧵 Stock de materiales*\n\n`;
    materiales.forEach(m => {
      const emoji = m.stock < 100 ? '🔴' : m.stock < 200 ? '🟡' : '🟢';
      msg2 += `${emoji} ${m.tipo} ${m.color} — *${m.stock}g*\n`;
    });
    bot.sendMessage(CHAT_ID, msg2, { parse_mode: 'Markdown' });
  }

  else if (texto === '/ayuda') {
    bot.sendMessage(CHAT_ID,
      `*Comandos disponibles:*\n\n` +
      `/pedidos — Ver pedidos activos\n` +
      `/stock — Ver stock de materiales\n` +
      `/resumen — Reporte completo ahora\n` +
      `/ayuda — Esta lista`,
      { parse_mode: 'Markdown' }
    );
  }

  else if (texto === '/resumen') {
    sendDailyReport();
  }
});

// Todos los días a las 8:00 AM (hora Argentina)
cron.schedule('0 8 * * *', sendDailyReport, {
  timezone: 'America/Argentina/Buenos_Aires'
});

console.log('🤖 Bot corriendo — reporte diario a las 8:00 AM');
sendDailyReport(); // borrar después de probar