'use strict';
// Uses Node's built-in SQLite (Node 22.13+). No npm packages needed.
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

const file = process.env.DB_FILE || path.join(__dirname, 'data', 'velora.db');
fs.mkdirSync(path.dirname(file), { recursive: true });
const db = new DatabaseSync(file);

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL,
  pw TEXT, google_id TEXT, role TEXT NOT NULL DEFAULT 'user', created INTEGER NOT NULL);

-- Per-user JSON documents: prefs, looks (try-on), plan (weekly planner), trends, chatprefs
CREATE TABLE IF NOT EXISTS kv(
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  k TEXT NOT NULL, v TEXT NOT NULL, PRIMARY KEY(user_id, k));

CREATE TABLE IF NOT EXISTS items(
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL, category TEXT NOT NULL, color TEXT, occasion TEXT, season TEXT, style TEXT,
  image TEXT, fav INTEGER NOT NULL DEFAULT 0, worn INTEGER NOT NULL DEFAULT 0,
  last_worn INTEGER, created INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS items_user ON items(user_id);

CREATE TABLE IF NOT EXISTS chat(
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL, text TEXT NOT NULL, created INTEGER NOT NULL);

CREATE TABLE IF NOT EXISTS posts(
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category TEXT NOT NULL, text TEXT NOT NULL, palette TEXT, created INTEGER NOT NULL,
  hidden INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS comments(
  id INTEGER PRIMARY KEY, post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, text TEXT NOT NULL, created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS likes(
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, PRIMARY KEY(post_id, user_id));
CREATE TABLE IF NOT EXISTS saves(
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, PRIMARY KEY(post_id, user_id));
CREATE TABLE IF NOT EXISTS reports(
  id INTEGER PRIMARY KEY, post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'open', created INTEGER NOT NULL, UNIQUE(post_id, user_id));

CREATE TABLE IF NOT EXISTS notifications(
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL, body TEXT, action TEXT, is_read INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL);
`);

// Upgrade older databases: library photo key and bottom (trouser/shalwar) style
for (const col of ['lib', 'bottom']) {
  if (!db.prepare('PRAGMA table_info(items)').all().some((c) => c.name === col)) db.exec(`ALTER TABLE items ADD COLUMN ${col} TEXT`);
}

// Profile fields, session version (to sign out all devices) and the support inbox
for (const [col, def] of [['phone', 'TEXT'], ['city', 'TEXT'], ['bio', 'TEXT'], ['avatar', 'TEXT'], ['sv', 'INTEGER NOT NULL DEFAULT 0']]) {
  if (!db.prepare('PRAGMA table_info(users)').all().some((c) => c.name === col)) db.exec(`ALTER TABLE users ADD COLUMN ${col} ${def}`);
}
if (!db.prepare('PRAGMA table_info(users)').all().some((c) => c.name === 'tryon_photo')) db.exec('ALTER TABLE users ADD COLUMN tryon_photo TEXT');
db.exec(`CREATE TABLE IF NOT EXISTS tryon_log(user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, created INTEGER NOT NULL);`);
db.exec(`CREATE TABLE IF NOT EXISTS notif_sent(user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, k TEXT NOT NULL, created INTEGER NOT NULL, UNIQUE(user_id,k));`);
db.exec(`CREATE TABLE IF NOT EXISTS support(
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject TEXT NOT NULL, message TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', created INTEGER NOT NULL);`);

module.exports = db;
