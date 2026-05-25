const express = require('express');
const mysql   = require('mysql2/promise');
const jwt     = require('jsonwebtoken');
const bcrypt  = require('bcryptjs');
const cors    = require('cors');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors({ origin: process.env.FRONTEND_URL || '*' }));

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

  // Crear tablas si no existen
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

  console.log('✅ MySQL conectado y tablas listas');
}

connectDB().catch(err => {
  console.error('❌ Error MySQL:', err);
  process.exit(1);
});

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
  res.json(rows);
});

app.post('/api/pedidos', authMiddleware, async (req, res) => {
  const { cliente, contacto, stl, material, color, precio, costo, fecha, horas, estado, notas } = req.body;
  const [result] = await db.execute(
    'INSERT INTO pedidos (cliente,contacto,stl,material,color,precio,costo,fecha,horas,estado,notas) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    [cliente, contacto, stl, material, color, precio, costo, fecha, horas, estado, notas]
  );
  const [rows] = await db.execute('SELECT * FROM pedidos WHERE id = ?', [result.insertId]);
  res.json(rows[0]);
});

app.put('/api/pedidos/:id', authMiddleware, async (req, res) => {
  const { cliente, contacto, stl, material, color, precio, costo, fecha, horas, estado, notas } = req.body;
  await db.execute(
    'UPDATE pedidos SET cliente=?,contacto=?,stl=?,material=?,color=?,precio=?,costo=?,fecha=?,horas=?,estado=?,notas=? WHERE id=?',
    [cliente, contacto, stl, material, color, precio, costo, fecha, horas, estado, notas, req.params.id]
  );
  const [rows] = await db.execute('SELECT * FROM pedidos WHERE id = ?', [req.params.id]);
  res.json(rows[0]);
});

app.delete('/api/pedidos/:id', authMiddleware, async (req, res) => {
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

// ============ START ============
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Servidor corriendo en puerto ${PORT}`));
