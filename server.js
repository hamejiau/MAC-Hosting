// -------------------------------
// server.js
// Sitio en Express con EJS + SQLite, sesiones y formulario de contacto
// -------------------------------
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

const app = express();
const DB_PATH = path.join(__dirname, 'data.db');
const db = new sqlite3.Database(DB_PATH);

// ---------- Utilidades DB ----------
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
// Ejecuta múltiples sentencias (CREATE TABLE ...; CREATE TABLE ...;)
function exec(sql) {
  return new Promise((resolve, reject) => {
    db.exec(sql, (err) => err ? reject(err) : resolve());
  });
}

// ---------- Inicialización ----------
async function ensureSchema() {
  // PRAGMAs
  await run('PRAGMA journal_mode = WAL;');
  await run('PRAGMA foreign_keys = ON;');

  // Cargar y aplicar schema.sql (si existe, permite múltiples sentencias)
  const schemaPath = path.join(__dirname, 'schema.sql');
  if (fs.existsSync(schemaPath)) {
    const schema = fs.readFileSync(schemaPath, 'utf8');
    if (schema.trim()) await exec(schema);
  }

  // Verificación defensiva por si el archivo de esquema fue modificado/recortado
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

// Ejecutar init con --init
(async () => {
  try {
    await ensureSchema();
    if (process.argv.includes('--init')) {
      await seedIfEmpty();
      console.log('Init completo. Puedes cerrar este proceso.');
      process.exit(0);
    } else {
      await seedIfEmpty();
    }
  } catch (e) {
    console.error('Error al inicializar el esquema/seed:', e);
  }
})();

// ---------- App ----------
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

// Middleware de protección
function requireAuth(req, res, next) {
  if (req.session.user) return next();
  return res.redirect('/login');
}

// --------- Rutas públicas ----------
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

// --------- Rutas privadas ----------
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

// ---------- Páginas de servicios ----------
app.get('/hosting', requireAuth, async (req, res) => {
  try {
    const hosting = await get('SELECT * FROM services WHERE title = ?', ['Hosting Web Compartido']);
    res.render('hosting', { user: req.session.user, hosting });
  } catch (e) {
    console.error('Error cargando hosting:', e);
    res.status(500).send('Error cargando hosting');
  }
});

app.get('/vps', requireAuth, (req, res) => {
  res.render('services/vps', { user: req.session.user });
});

app.get('/dedicados', requireAuth, (req, res) => {
  res.render('services/dedicados', { user: req.session.user });
});

app.get('/dominios', requireAuth, (req, res) => {
  res.render('services/dominios', { user: req.session.user });
});

app.get('/ssl', requireAuth, (req, res) => {
  res.render('services/ssl', { user: req.session.user });
});

app.get('/backup', requireAuth, (req, res) => {
  res.render('services/backup', { user: req.session.user });
});

app.get('/correo', requireAuth, (req, res) => {
  res.render('services/correo', { user: req.session.user });
});

app.get('/seguridad', requireAuth, (req, res) => {
  res.render('services/seguridad', { user: req.session.user });
});

app.get('/monitoreo', requireAuth, (req, res) => {
  res.render('services/monitoreo', { user: req.session.user });
});

app.get('/creador', requireAuth, (req, res) => {
  res.render('services/creador', { user: req.session.user });
});

// ---------- Arranque ----------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor listo en http://localhost:${PORT}`))
