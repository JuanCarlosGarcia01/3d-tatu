const TelegramBot = require('node-telegram-bot-api');
const mysql       = require('mysql2/promise');
require('dotenv').config();

const bot     = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

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

function esFechaValida(str) {
  return /^\d{4}-\d{2}-\d{2}$/.test(str) && !isNaN(new Date(str + 'T00:00:00').getTime());
}

// ============ STOCK HELPERS ============

async function descontarStock(material, color, gramos) {
  if (!gramos || gramos <= 0) return;
  await db.execute(
    'UPDATE materiales SET stock = stock - ? WHERE LOWER(tipo) = LOWER(?) AND LOWER(color) = LOWER(?)',
    [gramos, material, color]
  );
}

async function getColoresPorMaterial(material) {
  const [rows] = await db.execute(
    'SELECT color FROM materiales WHERE LOWER(tipo) = LOWER(?) ORDER BY color ASC',
    [material]
  );
  return rows.map(r => r.color);
}

// ============ HELPERS DE INLINE KEYBOARD ============

const TIPOS_MATERIAL = ['PLA', 'ABS', 'PETG', 'TPU', 'Resina'];
const ESTADOS_PEDIDO = ['Pendiente', 'Imprimiendo', 'Entregado', 'Cancelado'];

function kbMaterial() {
  // Filas de 3 botones
  const filas = [];
  for (let i = 0; i < TIPOS_MATERIAL.length; i += 3) {
    filas.push(TIPOS_MATERIAL.slice(i, i + 3).map(t => ({ text: t, callback_data: `mat:${t}` })));
  }
  return { inline_keyboard: filas };
}

function kbColores(colores) {
  if (!colores.length) return null;
  const filas = [];
  for (let i = 0; i < colores.length; i += 2) {
    filas.push(colores.slice(i, i + 2).map(c => ({ text: c, callback_data: `color:${c}` })));
  }
  return { inline_keyboard: filas };
}

function kbEstado() {
  return {
    inline_keyboard: ESTADOS_PEDIDO.map(e => [{ text: e, callback_data: `estado:${e}` }])
  };
}

// ============ ESTADO DE CONVERSACIÓN ============
const session = {};

function resetSession(chatId) { delete session[chatId]; }

// ============ FLUJO: NUEVO PEDIDO ============
// Pasos: 0-cliente 1-contacto 2-stl 3-material(kb) 4-color(kb) 5-gramos 6-precio 7-costo 8-fecha 9-horas 10-estado(kb) 11-notas

async function iniciarPedido(chatId) {
  session[chatId] = { flow: 'pedido', step: 0, data: {} };
  bot.sendMessage(chatId,
    '🆕 *Nuevo pedido*\n\n¿Nombre del cliente?\n\n_(Escribí /cancelar en cualquier momento para salir)_',
    { parse_mode: 'Markdown' }
  );
}

async function manejarPasoPedido(chatId, texto) {
  const s = session[chatId];
  const d = s.data;

  switch (s.step) {
    case 0: // cliente
      d.cliente = texto;
      s.step = 1;
      bot.sendMessage(chatId, '📞 ¿Contacto (tel/email)?');
      break;

    case 1: // contacto
      d.contacto = texto;
      s.step = 2;
      bot.sendMessage(chatId, '📄 ¿Nombre del archivo STL?\n_(Si no tenés, escribí "-")_', { parse_mode: 'Markdown' });
      break;

    case 2: // stl
      d.stl = texto === '-' ? '/modelos/sin_archivo.stl' : texto;
      s.step = 3;
      // Paso 3: material con botones
      bot.sendMessage(chatId, '🧵 ¿Material principal? Elegí uno:', { reply_markup: kbMaterial() });
      break;

    // Paso 3 (material) y 4 (color) se manejan desde callback_query

    case 5: { // gramos (después de que color ya fue elegido por botón)
      const gramos = parseFloat(texto);
      if (isNaN(gramos) || gramos <= 0) { bot.sendMessage(chatId, '⚠️ Ingresá un número válido de gramos.'); return; }
      d.gramos = gramos;
      s.step = 6;
      bot.sendMessage(chatId, '💰 ¿Precio de venta ($)?');
      break;
    }

    case 6: { // precio
      const precio = parseFloat(texto);
      if (isNaN(precio)) { bot.sendMessage(chatId, '⚠️ Ingresá un número válido.'); return; }
      d.precio = precio;
      s.step = 7;
      bot.sendMessage(chatId, '🧾 ¿Costo de materiales ($)?');
      break;
    }

    case 7: { // costo
      const costo = parseFloat(texto);
      if (isNaN(costo)) { bot.sendMessage(chatId, '⚠️ Ingresá un número válido.'); return; }
      d.costo = costo;
      s.step = 8;
      bot.sendMessage(chatId, '📅 ¿Fecha de entrega? (formato AAAA-MM-DD, ej: 2026-06-30)');
      break;
    }

    case 8: // fecha
      if (!esFechaValida(texto)) { bot.sendMessage(chatId, '⚠️ Formato inválido. Usá AAAA-MM-DD, ej: 2026-06-30'); return; }
      d.fecha = texto;
      s.step = 9;
      bot.sendMessage(chatId, '⏱️ ¿Tiempo estimado de impresión (hs)?');
      break;

    case 9: { // horas
      const horas = parseFloat(texto);
      if (isNaN(horas)) { bot.sendMessage(chatId, '⚠️ Ingresá un número válido.'); return; }
      d.horas = horas;
      s.step = 10;
      // Paso 10: estado con botones
      bot.sendMessage(chatId, '📌 ¿Estado del pedido?', { reply_markup: kbEstado() });
      break;
    }

    // Paso 10 (estado) se maneja desde callback_query

    case 11: { // notas + guardar
      d.notas = texto === '-' ? '' : texto;
      await guardarPedido(chatId, d);
      break;
    }

    default:
      bot.sendMessage(chatId, '⚠️ Usá los botones para elegir esta opción.');
  }
}

async function guardarPedido(chatId, d) {
  try {
    const [result] = await db.execute(
      'INSERT INTO pedidos (cliente,contacto,stl,material,color,precio,costo,fecha,horas,estado,notas) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      [d.cliente, d.contacto, d.stl, d.material, d.color, d.precio, d.costo, d.fecha, d.horas, d.estado, d.notas]
    );
    const pedidoId = result.insertId;

    if (d.estado !== 'Cancelado') {
      await db.execute(
        'INSERT INTO pedido_consumos (pedido_id, material, color, gramos, devuelto) VALUES (?,?,?,?,0)',
        [pedidoId, d.material, d.color, d.gramos]
      );
      await descontarStock(d.material, d.color, d.gramos);
    }

    bot.sendMessage(chatId,
      `✅ *Pedido creado*\n\n` +
      `👤 ${d.cliente}\n` +
      `🧵 ${d.material} · ${d.color} · ${d.gramos}g\n` +
      `💰 $${d.precio.toLocaleString('es-AR')}\n` +
      `📅 ${d.fecha}\n` +
      `📌 ${d.estado}`,
      { parse_mode: 'Markdown' }
    );
  } catch(e) {
    console.error('Error guardando pedido:', e.message);
    bot.sendMessage(chatId, '❌ Hubo un error guardando el pedido.');
  }
  resetSession(chatId);
}

// ============ FLUJO: NUEVO MATERIAL ============
// Pasos: 0-tipo(kb) 1-color(texto libre, es nuevo) 2-stock 3-precio_kg

async function iniciarMaterial(chatId) {
  session[chatId] = { flow: 'material', step: 0, data: {} };
  bot.sendMessage(chatId,
    '🧵 *Nuevo material*\n\n¿Qué tipo?\n\n_(Escribí /cancelar para salir)_',
    { parse_mode: 'Markdown', reply_markup: kbMaterial() }
  );
}

async function manejarPasoMaterial(chatId, texto) {
  const s = session[chatId];
  const d = s.data;

  switch (s.step) {
    // Paso 0 (tipo) se maneja desde callback_query

    case 1: // color (texto libre porque puede ser uno nuevo)
      d.color = texto;
      s.step = 2;
      bot.sendMessage(chatId, '⚖️ ¿Stock inicial (gramos)?');
      break;

    case 2: { // stock
      const stock = parseFloat(texto);
      if (isNaN(stock) || stock < 0) { bot.sendMessage(chatId, '⚠️ Ingresá un número válido.'); return; }
      d.stock = stock;
      s.step = 3;
      bot.sendMessage(chatId, '💰 ¿Precio por kg ($)?');
      break;
    }

    case 3: { // precio_kg + guardar
      const precio_kg = parseFloat(texto);
      if (isNaN(precio_kg)) { bot.sendMessage(chatId, '⚠️ Ingresá un número válido.'); return; }
      d.precio_kg = precio_kg;

      try {
        const [existentes] = await db.execute(
          'SELECT * FROM materiales WHERE LOWER(tipo) = LOWER(?) AND LOWER(color) = LOWER(?)',
          [d.tipo, d.color]
        );

        if (existentes.length) {
          const mat = existentes[0];
          await db.execute(
            'UPDATE materiales SET stock = stock + ?, precio_kg = ? WHERE id = ?',
            [d.stock, d.precio_kg, mat.id]
          );
          bot.sendMessage(chatId,
            `✅ *Material actualizado* (ya existía)\n\n🧵 ${d.tipo} ${d.color}\n⚖️ Stock nuevo: ${Number(mat.stock) + d.stock}g\n💰 $${d.precio_kg.toLocaleString('es-AR')}/kg`,
            { parse_mode: 'Markdown' }
          );
        } else {
          await db.execute(
            'INSERT INTO materiales (tipo,color,stock,precio_kg) VALUES (?,?,?,?)',
            [d.tipo, d.color, d.stock, d.precio_kg]
          );
          bot.sendMessage(chatId,
            `✅ *Material agregado*\n\n🧵 ${d.tipo} ${d.color}\n⚖️ ${d.stock}g\n💰 $${d.precio_kg.toLocaleString('es-AR')}/kg`,
            { parse_mode: 'Markdown' }
          );
        }
      } catch(e) {
        console.error('Error guardando material:', e.message);
        bot.sendMessage(chatId, '❌ Hubo un error guardando el material.');
      }

      resetSession(chatId);
      break;
    }

    default:
      bot.sendMessage(chatId, '⚠️ Usá los botones para elegir esta opción.');
  }
}

// ============ CALLBACK QUERY (botones inline) ============

bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  if (chatId.toString() !== CHAT_ID) return;

  const data = query.data;
  const s    = session[chatId];

  // Confirmar que Telegram recibió el tap
  bot.answerCallbackQuery(query.id);

  if (!s) return;

  // ---- Material elegido (paso 3 de pedido, paso 0 de material) ----
  if (data.startsWith('mat:')) {
    const material = data.replace('mat:', '');

    if (s.flow === 'pedido' && s.step === 3) {
      s.data.material = material;
      s.step = 4;
      // Buscar colores disponibles en la DB para este material
      const colores = await getColoresPorMaterial(material);
      if (!colores.length) {
        bot.sendMessage(chatId,
          `⚠️ No tenés *${material}* cargado en Materiales.\nEscribí el color manualmente o cargá el material primero.`,
          { parse_mode: 'Markdown' }
        );
        // Permitir que escriba el color a mano como fallback
        s.step = 4;
      } else {
        bot.sendMessage(chatId,
          `🎨 Material: *${material}*\n\n¿Qué color?`,
          { parse_mode: 'Markdown', reply_markup: kbColores(colores) }
        );
      }
    }

    if (s.flow === 'material' && s.step === 0) {
      s.data.tipo = material;
      s.step = 1;
      bot.sendMessage(chatId, `🎨 Tipo: *${material}*\n\n¿De qué color es? (escribilo, puede ser uno nuevo)`, { parse_mode: 'Markdown' });
    }
    return;
  }

  // ---- Color elegido (paso 4 de pedido) ----
  if (data.startsWith('color:') && s.flow === 'pedido' && s.step === 4) {
    const color = data.replace('color:', '');
    s.data.color = color;
    s.step = 5;
    bot.sendMessage(chatId,
      `⚖️ Material: *${s.data.material}* · Color: *${color}*\n\n¿Cuántos gramos se usaron? _(se va a descontar del stock)_`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  // ---- Estado elegido (paso 10 de pedido) ----
  if (data.startsWith('estado:') && s.flow === 'pedido' && s.step === 10) {
    const estado = data.replace('estado:', '');
    s.data.estado = estado;
    s.step = 11;
    bot.sendMessage(chatId,
      `📌 Estado: *${estado}*\n\n📝 ¿Notas u observaciones?\n_(Si no hay, escribí "-")_`,
      { parse_mode: 'Markdown' }
    );
    return;
  }
});

// ============ REPORTES ============

async function sendDailyReport() {
  const [pedidos]    = await db.execute('SELECT * FROM pedidos');
  const [materiales] = await db.execute('SELECT * FROM materiales');

  const activos  = pedidos.filter(p => p.estado !== 'Entregado' && p.estado !== 'Cancelado');
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

// ============ MENSAJES DE TEXTO ============

bot.on('message', async (msg) => {
  if (msg.chat.id.toString() !== CHAT_ID) return;
  const chatId = msg.chat.id;
  const texto  = msg.text?.trim();
  if (!texto) return;

  // Cancelar en cualquier momento
  if (texto.toLowerCase() === '/cancelar' || texto.toLowerCase() === 'cancelar') {
    if (session[chatId]) {
      resetSession(chatId);
      bot.sendMessage(chatId, '❌ Operación cancelada.');
    } else {
      bot.sendMessage(chatId, 'No hay ninguna operación en curso.');
    }
    return;
  }

  // Si hay sesión activa, continuar el flujo
  if (session[chatId]) {
    const s = session[chatId];
    if (s.flow === 'pedido')   return manejarPasoPedido(chatId, texto);
    if (s.flow === 'material') return manejarPasoMaterial(chatId, texto);
  }

  const cmd = texto.toLowerCase();

  if (cmd === '/nuevopedido')   return iniciarPedido(chatId);
  if (cmd === '/nuevomaterial') return iniciarMaterial(chatId);

  if (cmd === '/pedidos') {
    const [pedidos] = await db.execute("SELECT * FROM pedidos WHERE estado NOT IN ('Entregado','Cancelado') ORDER BY fecha ASC");
    if (!pedidos.length) return bot.sendMessage(chatId, '✅ Sin pedidos activos');
    let m = `*📦 Pedidos activos (${pedidos.length})*\n\n`;
    pedidos.forEach(p => {
      const d = daysUntil(p.fecha);
      const emoji = d <= 1 ? '🔴' : d <= 3 ? '🟡' : '🟢';
      const label = d < 0 ? `⚠️ VENCIDO` : d === 0 ? 'Hoy' : d === 1 ? 'Mañana' : `en ${d} días`;
      m += `${emoji} *${p.cliente}* — ${label}\n`;
      m += `   ${p.material} · ${p.color} · $${Number(p.precio).toLocaleString('es-AR')}\n\n`;
    });
    return bot.sendMessage(chatId, m, { parse_mode: 'Markdown' });
  }

  if (cmd === '/stock') {
    const [materiales] = await db.execute('SELECT * FROM materiales ORDER BY stock ASC');
    if (!materiales.length) return bot.sendMessage(chatId, 'Sin materiales cargados');
    let m = `*🧵 Stock de materiales*\n\n`;
    materiales.forEach(mat => {
      const emoji = mat.stock < 100 ? '🔴' : mat.stock < 200 ? '🟡' : '🟢';
      m += `${emoji} ${mat.tipo} ${mat.color} — *${mat.stock}g*\n`;
    });
    return bot.sendMessage(chatId, m, { parse_mode: 'Markdown' });
  }

  if (cmd === '/resumen') return sendDailyReport();

  if (cmd === '/ayuda' || cmd === '/start') {
    return bot.sendMessage(chatId,
      `*Comandos disponibles:*\n\n` +
      `/nuevopedido — Crear un pedido nuevo\n` +
      `/nuevomaterial — Agregar/sumar stock de material\n` +
      `/pedidos — Ver pedidos activos\n` +
      `/stock — Ver stock de materiales\n` +
      `/resumen — Reporte completo ahora\n` +
      `/cancelar — Cancelar la operación en curso\n` +
      `/ayuda — Esta lista`,
      { parse_mode: 'Markdown' }
    );
  }
});

bot.on('polling_error', (err) => {
  console.error('Polling error:', err.message);
});

console.log('🤖 Bot corriendo — comandos interactivos activos');
