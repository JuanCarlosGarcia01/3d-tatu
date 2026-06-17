const express = require('express');
const mysql   = require('mysql2/promise');
const jwt     = require('jsonwebtoken');
const bcrypt  = require('bcryptjs');
const cors    = require('cors');
const cron    = require('node-cron');
const https   = require('https');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors({ origin: process.env.FRONTEND_URL || '*' }));

// ============ TELEGRAM ============
const TELEGRAM_TOKEN   = '8935855020:AAFnmtOp0OF11Hn-wdpbB_sIBLj0aoXkDpk';
const TELEGRAM_CHAT_ID = '921937825';
const STOCK_MINIMO_G   = 200;

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

function daysUntil(dateStr) {
  const d     = new Date(dateStr + 'T00:00:00');
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.floor((d - today) / 86400000);
}

// ============ CONEXIÓN MYSQL ============
let db;
async function connectDB() {
  db = await mysql.createPool({
    host:     process.env.MYSQL_HOST,
    port:     parseInt(process.env.MYSQL_PORT) || 3306,
    user:     process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    waitForConnections: true,
    connectionLimit: 10,
  });

  await db.execute(`
    CREATE TABLE IF NOT EXISTS pedidos (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      cliente     VARCHAR(255),
      contacto    VARCHAR(255),
      stl         VARCHAR(500),
      material    VARCHAR(100),
      color       VARCHAR(100),
      precio      DECIMAL(10,2),
      costo       DECIMAL(10,2),
      fecha       VARCHAR(20),
      horas       DECIMAL(6,2),
      estado      VARCHAR(50),
      notas       TEXT,
      created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS materiales (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      tipo        VARCHAR(100),
      color       VARCHAR(100),
      stock       DECIMAL(10,2),
      precio_kg   DECIMAL(10,2),
      created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS gastos (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      descripcion VARCHAR(255),
      categoria   VARCHAR(100),
      monto       DECIMAL(10,2),
      fecha       VARCHAR(20),
      recurrente  TINYINT(1) DEFAULT 0,
      created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS pedido_consumos (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      pedido_id   INT NOT NULL,
      material    VARCHAR(100),
      color       VARCHAR(100),
      gramos      DECIMAL(10,2),
      devuelto    TINYINT(1) DEFAULT 0,
      FOREIGN KEY (pedido_id) REFERENCES pedidos(id) ON DELETE CASCADE
    )
  `);

  console.log('✅ MySQL conectado y tablas listas');
  iniciarCrons();
}

// ============ HELPERS STOCK ============

async function descontarStock(material, color, gramos) {
  if (!gramos || gramos <= 0) return;
  await db.execute(
    'UPDATE materiales SET stock = stock - ? WHERE LOWER(tipo) = LOWER(?) AND LOWER(color) = LOWER(?)',
    [gramos, material, color]
  );
}

async function devolverStock(material, color, gramos) {
  if (!gramos || gramos <= 0) return;
  await db.execute(
    'UPDATE materiales SET stock = stock + ? WHERE LOWER(tipo) = LOWER(?) AND LOWER(color) = LOWER(?)',
    [gramos, material, color]
  );
}

async function devolverConsumosPedido(pedidoId) {
  const [consumos] = await db.execute(
    'SELECT * FROM pedido_consumos WHERE pedido_id = ? AND devuelto = 0', [pedidoId]
  );
  for (const c of consumos) {
    await devolverStock(c.material, c.color, c.gramos);
  }
  await db.execute('UPDATE pedido_consumos SET devuelto = 1 WHERE pedido_id = ?', [pedidoId]);
}

async function aplicarConsumosPedido(pedidoId, consumos) {
  if (!Array.isArray(consumos)) return;
  for (const c of consumos) {
    if (!c.material || !c.color || !c.gramos) continue;
    await db.execute(
      'INSERT INTO pedido_consumos (pedido_id, material, color, gramos, devuelto) VALUES (?,?,?,?,0)',
      [pedidoId, c.material, c.color, c.gramos]
    );
    await descontarStock(c.material, c.color, c.gramos);
  }
}

connectDB().catch(err => {
  console.error('❌ Error MySQL:', err);
  process.exit(1);
});

// ============ CRON JOBS ============
function iniciarCrons() {

  // ── Alertas pedidos: todos los días a las 8:00 AM ──
  cron.schedule('0 8 * * *', async () => {
    try {
      const [pedidos] = await db.execute(
        "SELECT * FROM pedidos WHERE estado NOT IN ('Entregado','Cancelado')"
      );

      const vencidos      = pedidos.filter(p => daysUntil(p.fecha) < 0);
      const vencenHoy     = pedidos.filter(p => daysUntil(p.fecha) === 0);
      const vencenManiana = pedidos.filter(p => daysUntil(p.fecha) === 1);

      if (!vencidos.length && !vencenHoy.length && !vencenManiana.length) return;

      let lineas = [];

      if (vencidos.length) {
        lineas.push(`🔴 <b>VENCIDOS (${vencidos.length})</b>`);
        vencidos.forEach(p => {
          const dias = Math.abs(daysUntil(p.fecha));
          lineas.push(`  • ${p.cliente} — venció hace ${dias} día${dias>1?'s':''}`);
        });
      }
      if (vencenHoy.length) {
        lineas.push(`🟠 <b>VENCEN HOY (${vencenHoy.length})</b>`);
        vencenHoy.forEach(p => lineas.push(`  • ${p.cliente} — ${p.material} ${p.color}`));
      }
      if (vencenManiana.length) {
        lineas.push(`🟡 <b>VENCEN MAÑANA (${vencenManiana.length})</b>`);
        vencenManiana.forEach(p => lineas.push(`  • ${p.cliente} — ${p.material} ${p.color}`));
      }

      const msg = `🖨️ <b>PrintControl — Alertas de pedidos</b>\n\n` + lineas.join('\n');
      await sendTelegram(msg);
      console.log('✅ Alerta pedidos enviada');
    } catch(e) { console.error('❌ Cron pedidos:', e.message); }

  }, { timezone: 'America/Argentina/Buenos_Aires' });


  // ── Stock bajo: todos los días a las 8:00 AM ──
  cron.schedule('0 8 * * *', async () => {
    try {
      const [materiales] = await db.execute(
        'SELECT * FROM materiales WHERE stock < ?', [STOCK_MINIMO_G]
      );
      if (!materiales.length) return;

      const lineas = materiales.map(m =>
        `  • ${m.tipo} ${m.color}: <b>${m.stock}g restantes</b>`
      );

      const msg =
        `📦 <b>PrintControl — Stock bajo</b>\n\n` +
        `Menos de ${STOCK_MINIMO_G}g disponibles:\n\n` +
        lineas.join('\n') +
        `\n\n💡 Acordate de reponer antes de tu próxima impresión.`;

      await sendTelegram(msg);
      console.log('✅ Alerta stock enviada');
    } catch(e) { console.error('❌ Cron stock:', e.message); }

  }, { timezone: 'America/Argentina/Buenos_Aires' });


  // ── Resumen semanal: lunes a las 9:00 AM ──
  cron.schedule('0 9 * * 1', async () => {
    try {
      const hoy      = new Date(); hoy.setHours(23,59,59);
      const semStart = new Date(); semStart.setDate(hoy.getDate()-7); semStart.setHours(0,0,0,0);
      const semStr   = semStart.toISOString().slice(0,10);

      const [pedidos]   = await db.execute('SELECT * FROM pedidos');
      const [gastos]    = await db.execute('SELECT * FROM gastos');

      const entregados  = pedidos.filter(p =>
        p.estado === 'Entregado' && p.fecha >= semStr
      );
      const activos     = pedidos.filter(p =>
        p.estado !== 'Entregado' && p.estado !== 'Cancelado'
      );

      const ingresos    = entregados.reduce((s,p) => s + parseFloat(p.precio||0), 0);
      const ganancia    = entregados.reduce((s,p) => s + parseFloat(p.precio||0) - parseFloat(p.costo||0), 0);
      const gastosSem   = gastos.filter(g => !g.recurrente && g.fecha >= semStr).reduce((s,g) => s + parseFloat(g.monto||0), 0);
      const gastosRec   = gastos.filter(g => g.recurrente).reduce((s,g) => s + parseFloat(g.monto||0), 0);
      const neto        = ganancia - gastosSem - gastosRec;

      const proximos    = activos
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
        `💸 Gastos: <b>$${(gastosSem+gastosRec).toLocaleString('es-AR')}</b>\n` +
        `✅ Neto real: <b>$${neto.toLocaleString('es-AR')}</b>\n\n` +
        `🖨️ Entregados esta semana: ${entregados.length}\n` +
        `⏳ Pedidos activos: ${activos.length}` +
        (proximos.length ? `\n\n📅 Próximos vencimientos:\n${proximos.join('\n')}` : '');

      await sendTelegram(msg);
      console.log('✅ Resumen semanal enviado');
    } catch(e) { console.error('❌ Cron semanal:', e.message); }

  }, { timezone: 'America/Argentina/Buenos_Aires' });

  console.log('⏰ Cron jobs iniciados');
}

// ============ MIDDLEWARE AUTH ============
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token requerido' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido' });
  }
}

// ============ AUTH ============
app.post('/api/login', async (req, res) => {
  try {
    const { password } = req.body;
    const ok = await bcrypt.compare(password, process.env.ADMIN_PASSWORD_HASH);
    if (!ok) return res.status(401).json({ error: 'Contraseña incorrecta' });
    const token = jwt.sign({ admin: true }, process.env.JWT_SECRET, { expiresIn: '30d' });
    res.json({ token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============ PEDIDOS ============
app.get('/api/pedidos', authMiddleware, async (req, res) => {
  const [rows] = await db.execute('SELECT * FROM pedidos ORDER BY created_at DESC');
  for (const p of rows) {
    const [consumos] = await db.execute(
      'SELECT material, color, gramos FROM pedido_consumos WHERE pedido_id = ? AND devuelto = 0', [p.id]
    );
    p.consumos = consumos;
  }
  res.json(rows);
});

app.post('/api/pedidos', authMiddleware, async (req, res) => {
  const { cliente, contacto, stl, material, color, precio, costo, fecha, horas, estado, notas, consumos } = req.body;
  const [result] = await db.execute(
    'INSERT INTO pedidos (cliente,contacto,stl,material,color,precio,costo,fecha,horas,estado,notas) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    [cliente, contacto, stl, material, color, precio, costo, fecha, horas, estado, notas]
  );
  const pedidoId = result.insertId;

  // Si el pedido ya nace Cancelado, no se descuenta stock
  if (estado !== 'Cancelado') {
    await aplicarConsumosPedido(pedidoId, consumos);
  }

  const [rows] = await db.execute('SELECT * FROM pedidos WHERE id = ?', [pedidoId]);
  const [consumosGuardados] = await db.execute(
    'SELECT material, color, gramos FROM pedido_consumos WHERE pedido_id = ? AND devuelto = 0', [pedidoId]
  );
  res.json({ ...rows[0], consumos: consumosGuardados });
});

app.put('/api/pedidos/:id', authMiddleware, async (req, res) => {
  const { cliente, contacto, stl, material, color, precio, costo, fecha, horas, estado, notas, consumos } = req.body;
  const pedidoId = req.params.id;

  await db.execute(
    'UPDATE pedidos SET cliente=?,contacto=?,stl=?,material=?,color=?,precio=?,costo=?,fecha=?,horas=?,estado=?,notas=? WHERE id=?',
    [cliente, contacto, stl, material, color, precio, costo, fecha, horas, estado, notas, pedidoId]
  );

  // Devolver al stock los consumos previos (si los había y no fueron devueltos)
  await devolverConsumosPedido(pedidoId);

  // Si el nuevo estado no es Cancelado, aplicar los consumos actuales
  if (estado !== 'Cancelado') {
    await aplicarConsumosPedido(pedidoId, consumos);
  }

  const [rows] = await db.execute('SELECT * FROM pedidos WHERE id = ?', [pedidoId]);
  const [consumosGuardados] = await db.execute(
    'SELECT material, color, gramos FROM pedido_consumos WHERE pedido_id = ? AND devuelto = 0', [pedidoId]
  );
  res.json({ ...rows[0], consumos: consumosGuardados });
});

app.delete('/api/pedidos/:id', authMiddleware, async (req, res) => {
  await devolverConsumosPedido(req.params.id);
  await db.execute('DELETE FROM pedidos WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
});

// ============ MATERIALES ============
app.get('/api/materiales', authMiddleware, async (req, res) => {
  const [rows] = await db.execute('SELECT * FROM materiales ORDER BY created_at DESC');
  res.json(rows);
});

app.post('/api/materiales', authMiddleware, async (req, res) => {
  const { tipo, color, stock, precio_kg } = req.body;
  const [result] = await db.execute(
    'INSERT INTO materiales (tipo,color,stock,precio_kg) VALUES (?,?,?,?)',
    [tipo, color, stock, precio_kg]
  );
  const [rows] = await db.execute('SELECT * FROM materiales WHERE id = ?', [result.insertId]);
  res.json(rows[0]);
});

app.put('/api/materiales/:id', authMiddleware, async (req, res) => {
  const { tipo, color, stock, precio_kg } = req.body;
  await db.execute(
    'UPDATE materiales SET tipo=?,color=?,stock=?,precio_kg=? WHERE id=?',
    [tipo, color, stock, precio_kg, req.params.id]
  );
  const [rows] = await db.execute('SELECT * FROM materiales WHERE id = ?', [req.params.id]);
  res.json(rows[0]);
});

app.delete('/api/materiales/:id', authMiddleware, async (req, res) => {
  await db.execute('DELETE FROM materiales WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
});

// ============ GASTOS ============
app.get('/api/gastos', authMiddleware, async (req, res) => {
  const [rows] = await db.execute('SELECT * FROM gastos ORDER BY created_at DESC');
  res.json(rows);
});

app.post('/api/gastos', authMiddleware, async (req, res) => {
  const { descripcion, categoria, monto, fecha, recurrente } = req.body;
  const [result] = await db.execute(
    'INSERT INTO gastos (descripcion,categoria,monto,fecha,recurrente) VALUES (?,?,?,?,?)',
    [descripcion, categoria, monto, fecha, recurrente ? 1 : 0]
  );
  const [rows] = await db.execute('SELECT * FROM gastos WHERE id = ?', [result.insertId]);
  res.json(rows[0]);
});

app.put('/api/gastos/:id', authMiddleware, async (req, res) => {
  const { descripcion, categoria, monto, fecha, recurrente } = req.body;
  await db.execute(
    'UPDATE gastos SET descripcion=?,categoria=?,monto=?,fecha=?,recurrente=? WHERE id=?',
    [descripcion, categoria, monto, fecha, recurrente ? 1 : 0, req.params.id]
  );
  const [rows] = await db.execute('SELECT * FROM gastos WHERE id = ?', [req.params.id]);
  res.json(rows[0]);
});

app.delete('/api/gastos/:id', authMiddleware, async (req, res) => {
  await db.execute('DELETE FROM gastos WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
});

// ============ START ============
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Servidor corriendo en puerto ${PORT}`));
