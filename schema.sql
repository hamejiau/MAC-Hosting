-- Usuarios (login)
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL
);

-- Servicios que se muestran en módulos
CREATE TABLE IF NOT EXISTS services (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  price TEXT NOT NULL,
  summary TEXT NOT NULL
);

-- Mensajes de contacto
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  message TEXT NOT NULL,
  topics TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
