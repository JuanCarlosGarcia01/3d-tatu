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

// ============ INLINE KEYBOARDS ============

const TIPOS_MATERIAL = ['PLA', 'ABS', 'PETG', 'TPU', 'Resina'];
const ESTADOS_PEDIDO = ['Pendiente', 'Imprimiendo', 'Entregado', 'Cancelado'];

function kbMaterial(prefix = 'mat') {
  const filas = [];
  for (let i = 0; i < TIPOS_MATERIAL.length; i += 3)
    filas.push(TIPOS_MATERIAL.slice(i, i+3).map(t => ({ text: t, callback_data: `${prefix}:${t}` })));
  return { inline_keyboard: filas };
}

function kbColores(colores, seleccionados, prefix = 'color') {
  // Cada color muestra ✓ si ya está seleccionado
  const filas = [];
  for (let i = 0; i < colores.length; i += 2) {
    filas.push(colores.slice(i, i+2).map(c => ({
      text: seleccionados.includes(c) ? `✓ ${c}` : c,
      callback_data: `${prefix}:${c}`
    })));
  }
  // Botón de confirmar siempre al final
  if (seleccionados.length > 0) {
    filas.push([{ text: `✅ Confirmar (${seleccionados.length} color${seleccionados.length>1?'es':''})`, callback_data: 'color_ok' }]);
  }
  return { inline_keyboard: filas };
}

function kbEstado() {
  return { inline_keyboard: ESTADOS_PEDIDO.map(e => [{ text: e, callback_data: `estado:${e}` }]) };
}

// ============ ESTADO DE CONVERSACIÓN ============
const session = {};
function resetSession(chatId) { delete session[chatId]; }

// ============ FLUJO: NUEVO PEDIDO ============
// Pasos: 0-cliente 1-contacto 2-stl 3-material(kb) 4-colores(kb,múltiple) 5-gramos_por_color 6-precio 7-costo 8-fecha 9-horas 10-estado(kb) 11-notas

async function iniciarPedido(chatId) {
  session[chatId] = { flow: 'pedido', step: 0, data: { colores: [], gramosMap: {} } };
  bot.sendMessage(chatId,
    '🆕 *Nuevo pedido*\n\n¿Nombre del cliente?\n\n_(Escribí /cancelar en cualquier momento para salir)_',
    { parse_mode: 'Markdown' }
  );
}

// Envía el teclado de colores con el estado actual de selección
async function enviarKbColores(chatId, material, seleccionados) {
  const colores = await getColoresPorMaterial(material);
  if (!colores.length) {
    bot.sendMessage(chatId,
      `⚠️ No tenés *${material}* cargado en Materiales. Escribí el color manualmente:`,
      { parse_mode: 'Markdown' }
    );
    session[chatId].step = '4_manual';
    return;
  }
  const selTxt = seleccionados.length
    ? `\nSeleccionados: *${seleccionados.join(', ')}*`
    : '';
  bot.sendMessage(chatId,
    `🎨 ¿Qué colores se usaron? (máx. 4)${selTxt}\n\nTocá para seleccionar/deseleccionar, luego confirmá:`,
    { parse_mode: 'Markdown', reply_markup: kbColores(colores, seleccionados) }
  );
}

async function manejarPasoPedido(chatId, texto) {
  const s = session[chatId];
  const d = s.data;

  // Paso especial: color manual (fallback cuando no hay material en DB)
  if (s.step === '4_manual') {
    d.colores = [texto];
    d.gramosMap[texto] = null; // se pedirá después
    s.step = '5_gramos';
    s.data._colorActual = texto;
    bot.sendMessage(chatId, `⚖️ ¿Cuántos gramos de *${texto}* se usaron?`, { parse_mode: 'Markdown' });
    return;
  }

  // Paso especial: pedir gramos de cada color uno por uno
  if (s.step === '5_gramos') {
    const gramos = parseFloat(texto);
    if (isNaN(gramos) || gramos <= 0) { bot.sendMessage(chatId, '⚠️ Ingresá un número válido de gramos.'); return; }
    const colorActual = d._colorActual;
    d.gramosMap[colorActual] = gramos;

    // Ver si quedan colores sin gramos
    const pendientes = d.colores.filter(c => !d.gramosMap[c]);
    if (pendientes.length) {
      d._colorActual = pendientes[0];
      bot.sendMessage(chatId, `⚖️ ¿Cuántos gramos de *${pendientes[0]}* se usaron?`, { parse_mode: 'Markdown' });
    } else {
      // Todos los colores tienen gramos, seguir al precio
      s.step = 6;
      bot.sendMessage(chatId, '💰 ¿Precio de venta ($)?');
    }
    return;
  }

  switch (s.step) {
    case 0:
      d.cliente = texto; s.step = 1;
      bot.sendMessage(chatId, '📞 ¿Contacto (tel/email)?');
      break;

    case 1:
      d.contacto = texto; s.step = 2;
      bot.sendMessage(chatId, '📄 ¿Nombre del archivo STL?\n_(Si no tenés, escribí "-")_', { parse_mode: 'Markdown' });
      break;

    case 2:
      d.stl = texto === '-' ? '/modelos/sin_archivo.stl' : texto;
      s.step = 3;
      bot.sendMessage(chatId, '🧵 ¿Material principal?', { reply_markup: kbMaterial() });
      break;

    case 6: {
      const precio = parseFloat(texto);
      if (isNaN(precio)) { bot.sendMessage(chatId, '⚠️ Ingresá un número válido.'); return; }
      d.precio = precio; s.step = 7;
      bot.sendMessage(chatId, '🧾 ¿Costo de materiales ($)?');
      break;
    }

    case 7: {
      const costo = parseFloat(texto);
      if (isNaN(costo)) { bot.sendMessage(chatId, '⚠️ Ingresá un número válido.'); return; }
      d.costo = costo; s.step = 8;
      bot.sendMessage(chatId, '📅 ¿Fecha de entrega? (formato AAAA-MM-DD, ej: 2026-06-30)');
      break;
    }

    case 8:
      if (!esFechaValida(texto)) { bot.sendMessage(chatId, '⚠️ Formato inválido. Usá AAAA-MM-DD, ej: 2026-06-30'); return; }
      d.fecha = texto; s.step = 9;
      bot.sendMessage(chatId, '⏱️ ¿Tiempo estimado de impresión (hs)?');
      break;

    case 9: {
      const horas = parseFloat(texto);
      if (isNaN(horas)) { bot.sendMessage(chatId, '⚠️ Ingresá un número válido.'); return; }
      d.horas = horas; s.step = 10;
      bot.sendMessage(chatId, '📌 ¿Estado del pedido?', { reply_markup: kbEstado() });
      break;
    }

    case 11:
      d.notas = texto === '-' ? '' : texto;
      await guardarPedido(chatId, d);
      break;

    default:
      bot.sendMessage(chatId, '⚠️ Usá los botones para elegir esta opción.');
  }
}

async function guardarPedido(chatId, d) {
  try {
    // Color guardado como string de todos los colores usados
    const colorStr = d.colores.join(', ');

    const [result] = await db.execute(
      'INSERT INTO pedidos (cliente,contacto,stl,material,color,precio,costo,fecha,horas,estado,notas) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      [d.cliente, d.contacto, d.stl, d.material, colorStr, d.precio, d.costo, d.fecha, d.horas, d.estado, d.notas]
    );
    const pedidoId = result.insertId;

    if (d.estado !== 'Cancelado') {
      for (const [color, gramos] of Object.entries(d.gramosMap)) {
        if (!gramos) continue;
        await db.execute(
          'INSERT INTO pedido_consumos (pedido_id, material, color, gramos, devuelto) VALUES (?,?,?,?,0)',
          [pedidoId, d.material, color, gramos]
        );
        await descontarStock(d.material, color, gramos);
      }
    }

    const resumenColores = d.colores.map(c => `  • ${c}: ${d.gramosMap[c] || 0}g`).join('\n');
    bot.sendMessage(chatId,
      `✅ *Pedido creado*\n\n` +
      `👤 ${d.cliente}\n` +
      `🧵 ${d.material}\n${resumenColores}\n` +
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

async function iniciarMaterial(chatId) {
  session[chatId] = { flow: 'material', step: 0, data: {} };
  bot.sendMessage(chatId,
    '🧵 *Nuevo material*\n\n¿Qué tipo?\n\n_(Escribí /cancelar para salir)_',
    { parse_mode: 'Markdown', reply_markup: kbMaterial('mmat') }
  );
}

async function manejarPasoMaterial(chatId, texto) {
  const s = session[chatId];
  const d = s.data;

  switch (s.step) {
    case 1:
      d.color = texto; s.step = 2;
      bot.sendMessage(chatId, '⚖️ ¿Stock inicial (gramos)?');
      break;

    case 2: {
      const stock = parseFloat(texto);
      if (isNaN(stock) || stock < 0) { bot.sendMessage(chatId, '⚠️ Ingresá un número válido.'); return; }
      d.stock = stock; s.step = 3;
      bot.sendMessage(chatId, '💰 ¿Precio por kg ($)?');
      break;
    }

    case 3: {
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
          await db.execute('UPDATE materiales SET stock = stock + ?, precio_kg = ? WHERE id = ?', [d.stock, d.precio_kg, mat.id]);
          bot.sendMessage(chatId,
            `✅ *Material actualizado*\n\n🧵 ${d.tipo} ${d.color}\n⚖️ Stock nuevo: ${Number(mat.stock) + d.stock}g\n💰 $${d.precio_kg.toLocaleString('es-AR')}/kg`,
            { parse_mode: 'Markdown' }
          );
        } else {
          await db.execute('INSERT INTO materiales (tipo,color,stock,precio_kg) VALUES (?,?,?,?)', [d.tipo, d.color, d.stock, d.precio_kg]);
          bot.sendMessage(chatId,
            `✅ *Material agregado*\n\n🧵 ${d.tipo} ${d.color}\n⚖️ ${d.stock}g\n💰 $${d.precio_kg.toLocaleString('es-AR')}/kg`,
            { parse_mode: 'Markdown' }
          );
        }
      } catch(e) {
        console.error('Error guardando material:', e.message);
        bot.sendMessage(chatId, '❌ Hubo un error.');
      }
      resetSession(chatId);
      break;
    }
    default:
      bot.sendMessage(chatId, '⚠️ Usá los botones para elegir el tipo.');
  }
}

// ============ CALLBACK QUERY (botones) ============

bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  if (chatId.toString() !== CHAT_ID) return;
  bot.answerCallbackQuery(query.id);

  const data = query.data;
  const s    = session[chatId];
  if (!s) return;

  // ---- Material del pedido ----
  if (data.startsWith('mat:') && s.flow === 'pedido' && s.step === 3) {
    s.data.material = data.replace('mat:', '');
    s.step = 4;
    s.data.colores = [];
    await enviarKbColores(chatId, s.data.material, []);
    return;
  }

  // ---- Tipo de material nuevo ----
  if (data.startsWith('mmat:') && s.flow === 'material' && s.step === 0) {
    s.data.tipo = data.replace('mmat:', '');
    s.step = 1;
    bot.sendMessage(chatId, `🎨 Tipo: *${s.data.tipo}*\n\n¿De qué color? (escribilo, puede ser nuevo)`, { parse_mode: 'Markdown' });
    return;
  }

  // ---- Selección/deselección de color (múltiple) ----
  if (data.startsWith('color:') && s.flow === 'pedido' && s.step === 4) {
    const color = data.replace('color:', '');
    const colores = s.data.colores;

    if (colores.includes(color)) {
      s.data.colores = colores.filter(c => c !== color);
    } else {
      if (colores.length >= 4) {
        bot.answerCallbackQuery(query.id, { text: 'Máximo 4 colores por pedido', show_alert: true });
        return;
      }
      s.data.colores.push(color);
    }

    // Editar el mensaje existente con el teclado actualizado
    const todosColores = await getColoresPorMaterial(s.data.material);
    const selTxt = s.data.colores.length ? `\nSeleccionados: *${s.data.colores.join(', ')}*` : '';
    try {
      bot.editMessageText(
        `🎨 ¿Qué colores se usaron? (máx. 4)${selTxt}\n\nTocá para seleccionar/deseleccionar, luego confirmá:`,
        { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown', reply_markup: kbColores(todosColores, s.data.colores) }
      );
    } catch(e) {}
    return;
  }

  // ---- Confirmar colores ----
  if (data === 'color_ok' && s.flow === 'pedido' && s.step === 4) {
    if (!s.data.colores.length) {
      bot.answerCallbackQuery(query.id, { text: 'Elegí al menos un color', show_alert: true });
      return;
    }
    // Inicializar gramosMap y pedir gramos del primer color
    s.data.gramosMap = {};
    s.data._colorActual = s.data.colores[0];
    s.step = '5_gramos';
    bot.sendMessage(chatId,
      `✅ Colores: *${s.data.colores.join(', ')}*\n\nAhora indicá cuántos gramos se usaron de cada color:\n\n⚖️ ¿Cuántos gramos de *${s.data.colores[0]}*?`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  // ---- Estado del pedido ----
  if (data.startsWith('estado:') && s.flow === 'pedido' && s.step === 10) {
    s.data.estado = data.replace('estado:', '');
    s.step = 11;
    bot.sendMessage(chatId,
      `📌 Estado: *${s.data.estado}*\n\n📝 ¿Notas u observaciones?\n_(Si no hay, escribí "-")_`,
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

  let msg = `📊 *Resumen diario — Tatú 3D*\n_${new Date().toLocaleDateString('es-AR', { weekday:'long', day:'numeric', month:'long' })}_\n\n`;
  msg += `*📦 Pedidos próximos (7 días)*\n`;
  if (!proximos.length) {
    msg += `✅ Sin vencimientos cercanos\n`;
  } else {
    proximos.forEach(p => {
      const emoji = p.dias <= 1 ? '🔴' : p.dias <= 3 ? '🟡' : '🟢';
      const label = p.dias < 0 ? `⚠️ VENCIDO` : p.dias === 0 ? 'Hoy' : p.dias === 1 ? 'Mañana' : `en ${p.dias} días`;
      msg += `${emoji} *${p.cliente}* — ${label}\n   ${p.material} · ${p.color} · $${Number(p.precio).toLocaleString('es-AR')}\n`;
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

  if (texto.toLowerCase() === '/cancelar' || texto.toLowerCase() === 'cancelar') {
    if (session[chatId]) { resetSession(chatId); bot.sendMessage(chatId, '❌ Operación cancelada.'); }
    else bot.sendMessage(chatId, 'No hay ninguna operación en curso.');
    return;
  }

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
      m += `${emoji} *${p.cliente}* — ${label}\n   ${p.material} · ${p.color} · $${Number(p.precio).toLocaleString('es-AR')}\n\n`;
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
      `*Comandos disponibles:*\n\n/nuevopedido — Crear un pedido nuevo\n/nuevomaterial — Agregar/sumar stock de material\n/pedidos — Ver pedidos activos\n/stock — Ver stock de materiales\n/resumen — Reporte completo ahora\n/cancelar — Cancelar la operación en curso\n/ayuda — Esta lista`,
      { parse_mode: 'Markdown' }
    );
  }
});

bot.on('polling_error', (err) => { console.error('Polling error:', err.message); });
console.log('🤖 Bot corriendo — comandos interactivos activos');
