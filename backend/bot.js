const TelegramBot = require('node-telegram-bot-api');
const cron        = require('node-cron');
const mysql       = require('mysql2/promise');
require('dotenv').config();

const bot     = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// Reusar el pool de MySQL
const db = mysql.createPool({
  host:     process.env.MYSQL_HOST,
  port:     parseInt(process.env.MYSQL_PORT) || 3306,
  user:     process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
});

function daysUntil(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const today = new Date(); today.setHours(0,0,0,0);
  return Math.floor((d - today) / 86400000);
}

async function sendDailyReport() {
  const [pedidos]    = await db.execute('SELECT * FROM pedidos');
  const [materiales] = await db.execute('SELECT * FROM materiales');

  const activos = pedidos.filter(p => p.estado !== 'Entregado' && p.estado !== 'Cancelado');
  const proximos = activos
    .map(p => ({ ...p, dias: daysUntil(p.fecha) }))
    .filter(p => p.dias <= 7)
    .sort((a, b) => a.dias - b.dias);

  let msg = `📊 *Resumen diario — Tatú 3D*\n`;
  msg += `_${new Date().toLocaleDateString('es-AR', { weekday:'long', day:'numeric', month:'long' })}_\n\n`;

  msg += `*📦 Pedidos próximos (7 días)*\n`;
  if (!proximos.length) {
    msg += `✅ Sin vencimientos cercanos\n`;
  } else {
    proximos.forEach(p => {
      const emoji = p.dias <= 1 ? '🔴' : p.dias <= 3 ? '🟡' : '🟢';
      const label = p.dias < 0 ? `⚠️ VENCIDO` : p.dias === 0 ? 'Hoy' : p.dias === 1 ? 'Mañana' : `en ${p.dias} días`;
      msg += `${emoji} *${p.cliente}* — ${label}\n`;
      msg += `   ${p.material} · ${p.color} · $${Number(p.precio).toLocaleString('es-AR')}\n`;
    });
  }

  msg += `\n*🧵 Stock de materiales*\n`;
  if (!materiales.length) {
    msg += `Sin materiales cargados\n`;
  } else {
    materiales.forEach(m => {
      const emoji = m.stock < 100 ? '🔴' : m.stock < 200 ? '🟡' : '🟢';
      msg += `${emoji} ${m.tipo} ${m.color} — *${m.stock}g*\n`;
    });
  }

  const stockBajo = materiales.filter(m => m.stock < 200);
  if (stockBajo.length) msg += `\n⚠️ *${stockBajo.length} material(es) con stock bajo*`;

  bot.sendMessage(CHAT_ID, msg, { parse_mode: 'Markdown' });
}

bot.on('message', async (msg) => {
  if (msg.chat.id.toString() !== CHAT_ID) return;
  const texto = msg.text?.toLowerCase();

  if (texto === '/pedidos') {
    const [pedidos] = await db.execute("SELECT * FROM pedidos WHERE estado NOT IN ('Entregado','Cancelado') ORDER BY fecha ASC");
    if (!pedidos.length) return bot.sendMessage(CHAT_ID, '✅ Sin pedidos activos');
    let m = `*📦 Pedidos activos (${pedidos.length})*\n\n`;
    pedidos.forEach(p => {
      const d = daysUntil(p.fecha);
      const emoji = d <= 1 ? '🔴' : d <= 3 ? '🟡' : '🟢';
      const label = d < 0 ? `⚠️ VENCIDO` : d === 0 ? 'Hoy' : d === 1 ? 'Mañana' : `en ${d} días`;
      m += `${emoji} *${p.cliente}* — ${label}\n`;
      m += `   ${p.material} · ${p.color} · $${Number(p.precio).toLocaleString('es-AR')}\n\n`;
    });
    bot.sendMessage(CHAT_ID, m, { parse_mode: 'Markdown' });
  }

  else if (texto === '/stock') {
    const [materiales] = await db.execute('SELECT * FROM materiales ORDER BY stock ASC');
    if (!materiales.length) return bot.sendMessage(CHAT_ID, 'Sin materiales cargados');
    let m = `*🧵 Stock de materiales*\n\n`;
    materiales.forEach(mat => {
      const emoji = mat.stock < 100 ? '🔴' : mat.stock < 200 ? '🟡' : '🟢';
      m += `${emoji} ${mat.tipo} ${mat.color} — *${mat.stock}g*\n`;
    });
    bot.sendMessage(CHAT_ID, m, { parse_mode: 'Markdown' });
  }

  else if (texto === '/resumen') {
    sendDailyReport();
  }

  else if (texto === '/ayuda') {
    bot.sendMessage(CHAT_ID,
      `*Comandos disponibles:*\n\n/pedidos — Ver pedidos activos\n/stock — Ver stock de materiales\n/resumen — Reporte completo ahora\n/ayuda — Esta lista`,
      { parse_mode: 'Markdown' }
    );
  }
});

cron.schedule('0 8 * * *', sendDailyReport, {
  timezone: 'America/Argentina/Buenos_Aires'
});
bot.on('polling_error', (err) => {
  console.error('Polling error:', err.message);
});
console.log('🤖 Bot corriendo — reporte diario a las 8:00 AM');