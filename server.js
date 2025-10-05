// -------------------------------
// server.js
// Sitio en Express con EJS + SQLite, sesiones y formulario de contacto
// -------------------------------

// === Importaciones ===
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

// === Inicialización de la app ===
const app = express();
const DB_PATH = path.join(__dirname, 'data.db');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');
const PORT = process.env.PORT || 3000;

// === Crear DB si no existe ===
if (!fs.existsSync(DB_PATH)) {
  const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
  const dbInit = new sqlite3.Database(DB_PATH);
  dbInit.exec(schema, (err) => {
    if (err) console.error('Error inicializando DB:', err);
    else console.log('DB creada desde schema.sql');
    dbInit.close();
  });
}

// === Conexión a la base de datos ===
const db = new sqlite3.Database(DB_PATH);

// === Funciones de utilidad para SQLite ===
function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err); else resolve(this);
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => err ? reject(err) : resolve(row));
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows));
  });
}

function exec(sql) {
  return new Promise((resolve, reject) => {
    db.exec(sql, (err) => err ? reject(err) : resolve());
  });
}

// === Inicialización del esquema ===
async function ensureSchema() {
  await run('PRAGMA journal_mode = WAL;');
  await run('PRAGMA foreign_keys = ON;');

  if (fs.existsSync(SCHEMA_PATH)) {
    const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
    if (schema.trim()) await exec(schema);
  }

  const needServices = await get("SELECT name FROM sqlite_master WHERE type='table' AND name='services'");
  if (!needServices) {
    await run(`
      CREATE TABLE IF NOT EXISTS services (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        price TEXT NOT NULL,
        summary TEXT NOT NULL
      )
    `);
  }

  const needUsers = await get("SELECT name FROM sqlite_master WHERE type='table' AND name='users'");
  if (!needUsers) {
    await run(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        name TEXT NOT NULL
      )
    `);
  }

  const needMessages = await get("SELECT name FROM sqlite_master WHERE type='table' AND name='messages'");
  if (!needMessages) {
    await run(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        message TEXT NOT NULL,
        topics TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }

  console.log('Esquema verificado/aplicado correctamente.');
}

// === Semillas iniciales ===
async function seedIfEmpty() {
  const row = await get('SELECT COUNT(*) AS c FROM users');
  if (row.c === 0) {
    const hash = await bcrypt.hash('Admin*1234', 10);
    await run(
      'INSERT INTO users (username, password_hash, name) VALUES (?, ?, ?)',
      ['admin', hash, 'Administrador']
    );

    const services = [
      ['Hosting Web Compartido', 'Desde $5.99 Anual', 'Plan rápido, seguro y económico para iniciar tu sitio.'],
      ['Servidores VPS', 'Desde $8.99 Mensual', 'Control total, rendimiento dedicado y escalabilidad.'],
      ['Correo Corporativo', 'Incluido 1er año', 'Dominios y cuentas corporativas con soporte 24/7.']
    ];
    for (const s of services) {
      await run('INSERT INTO services (title, price, summary) VALUES (?, ?, ?)', s);
    }

    console.log('BD inicializada con usuario admin / Admin*1234 y servicios de ejemplo.');
  }
}

// === Inicializar BD y esquemas ===
(async () => {
  try {
    await ensureSchema();
    await seedIfEmpty();
  } catch (e) {
    console.error('Error al inicializar el esquema/seed:', e);
  }
})();

// === Configuración de Express ===
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use('/public', express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: 'mac-site-secret-123',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 } // 1 hora
}));

// === Middleware de autenticación ===
function requireAuth(req, res, next) {
  if (req.session.user) return next();
  return res.redirect('/login');
}

// === Rutas públicas ===
app.get('/', (req, res) => res.redirect('/login'));

app.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/dashboard');
  res.render('login', { error: null });
});

app.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await get('SELECT * FROM users WHERE username = ?', [username]);
    if (!user) return res.render('login', { error: 'Usuario o contraseña inválidos' });

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.render('login', { error: 'Usuario o contraseña inválidos' });

    req.session.user = { id: user.id, name: user.name, username: user.username };
    res.redirect('/dashboard');
  } catch (e) {
    console.error('Error en login:', e);
    res.render('login', { error: 'Error interno. Intenta de nuevo.' });
  }
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

// === Rutas privadas ===
app.get('/dashboard', requireAuth, async (req, res) => {
  try {
    const services = await all('SELECT * FROM services');
    res.render('dashboard', { user: req.session.user, services });
  } catch (e) {
    console.error('Error cargando dashboard:', e);
    res.status(500).send('Error cargando dashboard');
  }
});

app.get('/about', requireAuth, (req, res) => {
  res.render('about', { user: req.session.user });
});

app.get('/contact', requireAuth, (req, res) => {
  res.render('contact', { user: req.session.user, ok: null });
});

app.post('/contact', requireAuth, async (req, res) => {
  try {
    const { name, email, message, topics = [] } = req.body;
    const topicsStr = Array.isArray(topics) ? topics.join(', ') : String(topics || '');
    await run(
      'INSERT INTO messages (name, email, message, topics) VALUES (?, ?, ?, ?)',
      [name, email, message, topicsStr]
    );
    res.render('contact', { user: req.session.user, ok: 'Mensaje enviado correctamente.' });
  } catch (e) {
    console.error('Error guardando mensaje:', e);
    res.render('contact', { user: req.session.user, ok: 'No se pudo enviar. Intenta nuevamente.' });
  }
});

// === Rutas de servicios ===
app.get('/hosting', requireAuth, async (req, res) => {
  try {
    const hosting = await get('SELECT * FROM services WHERE title = ?', ['Hosting Web Compartido']);
    res.render('hosting', { user: req.session.user, hosting });
  } catch (e) {
    console.error('Error cargando hosting:', e);
    res.status(500).send('Error cargando hosting');
  }
});

// Otras páginas
const servicePages = ['vps', 'dedicados', 'dominios', 'ssl', 'backup', 'correo', 'seguridad', 'monitoreo', 'creador'];
for (const page of servicePages) {
  app.get(`/${page}`, requireAuth, (req, res) => {
    res.render(`services/${page}`, { user: req.session.user });
  });
}

// === Arranque del servidor ===
app.listen(PORT, () => console.log(`Servidor listo en el puerto ${PORT}`));
