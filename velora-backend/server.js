'use strict';
// Velora backend. Zero npm dependencies: Node 22.13+ only.
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
try { process.loadEnvFile(path.join(__dirname, '.env')); } catch {}
const db = require('./db'), ai = require('./ai'), tryon = require('./tryon');

const PORT = +process.env.PORT || 3000, PROD = process.env.NODE_ENV === 'production';
let SECRET = process.env.SESSION_SECRET;
if (!SECRET) {
  if (PROD) { console.error('SESSION_SECRET is required in production.'); process.exit(1); }
  SECRET = crypto.randomBytes(32).toString('hex');
  console.warn('Dev mode: random session secret, so logins reset when the server restarts.');
}
const ADMIN = (process.env.ADMIN_EMAIL || '').toLowerCase();
const CATS = ai.CATS, now = () => Date.now();
const UP = path.join(__dirname, 'uploads');

class HttpError extends Error { constructor(code, msg) { super(msg); this.code = code; } }
const bad = (m) => new HttpError(400, m);

// ---------- sessions and passwords ----------
const sign = (s) => crypto.createHmac('sha256', SECRET).update(s).digest('base64url');
const mkToken = (uid, sv = 0) => { const p = Buffer.from(JSON.stringify({ uid, sv, exp: now() + 30 * 864e5 })).toString('base64url'); return p + '.' + sign(p); };
function readToken(t) {
  if (!t) return null; const [p, s] = t.split('.'); if (!p || !s) return null;
  const e = sign(p); if (s.length !== e.length || !crypto.timingSafeEqual(Buffer.from(s), Buffer.from(e))) return null;
  try { const o = JSON.parse(Buffer.from(p, 'base64url')); return o.exp > now() ? { uid: o.uid, sv: o.sv || 0 } : null; } catch { return null; }
}
const hashPw = (pw) => { const s = crypto.randomBytes(16); return s.toString('hex') + ':' + crypto.scryptSync(pw, s, 64).toString('hex'); };
const checkPw = (pw, h) => { if (!h) return false; const [s, x] = h.split(':'); return crypto.timingSafeEqual(crypto.scryptSync(pw, Buffer.from(s, 'hex'), 64), Buffer.from(x, 'hex')); };
const cookie = (v, age) => `velora=${v}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${age}${PROD ? '; Secure' : ''}`;
const hits = new Map();
function limit(ip) { const t = now(), a = (hits.get(ip) || []).filter((x) => t - x < 9e5); a.push(t); hits.set(ip, a); if (a.length > 20) throw new HttpError(429, 'Too many attempts. Please wait a few minutes and try again.'); }

// ---------- helpers ----------
const q = (sql, ...p) => db.prepare(sql);
const one = (sql, ...p) => db.prepare(sql).get(...p);
const all = (sql, ...p) => db.prepare(sql).all(...p);
const run = (sql, ...p) => db.prepare(sql).run(...p);
const notify = (uid, title, body, action) => run('INSERT INTO notifications(user_id,title,body,action,created) VALUES(?,?,?,?,?)', uid, title, body || null, action || null, now());
const pub = (u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, phone: u.phone || '', city: u.city || '', bio: u.bio || '', avatar: u.avatar || null, tryonPhoto: u.tryon_photo || null, created: u.created, hasPassword: !!u.pw });
const str = (v, max, name) => { if (typeof v !== 'string' || !v.trim()) throw bad(`Please fill in ${name}.`); return v.trim().slice(0, max); };
const hex = (v) => (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v : null);

function saveImage(uid, dataUrl) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl || '');
  if (!m) throw bad('Please choose a JPG, PNG or WebP photo.');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 8 * 1024 * 1024) throw bad('That photo is over 8 MB. Please choose a smaller one.');
  const ok = (m[1] === 'image/jpeg' && buf[0] === 0xff && buf[1] === 0xd8) ||
    (m[1] === 'image/png' && buf.slice(1, 4).toString() === 'PNG') ||
    (m[1] === 'image/webp' && buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP');
  if (!ok) throw bad('That file is not a valid photo.');
  const ext = m[1].split('/')[1], name = crypto.randomBytes(12).toString('hex') + '.' + ext;
  fs.mkdirSync(path.join(UP, String(uid)), { recursive: true });
  fs.writeFileSync(path.join(UP, String(uid), name), buf);
  return { url: `/uploads/${uid}/${name}`, buf, mime: m[1] };
}
const itemOut = (i) => ({ id: i.id, name: i.name, category: i.category, color: i.color, occasion: i.occasion, season: i.season, style: i.style, image: i.image, bottom: i.bottom, lib: i.lib, fav: !!i.fav, worn: i.worn, lastWorn: i.last_worn });

// ---------- routes ----------
const routes = [];
const r = (method, pat, fn, o = {}) => routes.push({ method, re: new RegExp('^' + pat.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), fn, ...o });
const need = { auth: true };
const adminOnly = { auth: true, admin: true };

// auth
r('POST', '/api/auth/signup', (c) => {
  limit(c.ip);
  const name = str(c.body.name, 60, 'your name'), email = str(c.body.email, 120, 'your email').toLowerCase(), pw = c.body.password;
  if (!/^\S+@\S+\.\S+$/.test(email)) throw bad('Check your email address. It should look like name@example.com.');
  if (typeof pw !== 'string' || pw.length < 8 || pw.length > 200) throw bad('Choose a password with at least 8 characters.');
  if (one('SELECT id FROM users WHERE email=?', email)) throw new HttpError(409, 'An account with this email already exists. Try logging in.');
  const res = run('INSERT INTO users(name,email,pw,role,created) VALUES(?,?,?,?,?)', name, email, hashPw(pw), email === ADMIN ? 'admin' : 'user', now());
  const u = one('SELECT * FROM users WHERE id=?', res.lastInsertRowid);
  notify(u.id, 'Welcome to Velora', 'Scan your wardrobe once and your looks are ready.', 'wardrobe');
  return { code: 201, headers: { 'set-cookie': cookie(mkToken(u.id, u.sv || 0), 2592000) }, data: pub(u) };
});
r('POST', '/api/auth/login', (c) => {
  limit(c.ip);
  const u = one('SELECT * FROM users WHERE email=?', String(c.body.email || '').trim().toLowerCase());
  if (!u || !checkPw(String(c.body.password || ''), u.pw)) throw new HttpError(401, 'That email or password does not match.');
  return { headers: { 'set-cookie': cookie(mkToken(u.id, u.sv || 0), 2592000) }, data: pub(u) };
});
r('POST', '/api/auth/google', async (c) => {
  const cid = process.env.GOOGLE_CLIENT_ID;
  if (!cid) throw new HttpError(501, 'Google sign-in is not set up yet. Please use email for now.');
  limit(c.ip);
  const resp = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(String(c.body.credential || '')));
  const g = await resp.json();
  if (!resp.ok || g.aud !== cid || g.email_verified !== 'true') throw new HttpError(401, 'Google sign-in did not work. Please try again.');
  let u = one('SELECT * FROM users WHERE email=?', g.email.toLowerCase());
  if (!u) {
    const res = run('INSERT INTO users(name,email,google_id,role,created) VALUES(?,?,?,?,?)', String(g.name || g.email).slice(0, 60), g.email.toLowerCase(), g.sub, g.email.toLowerCase() === ADMIN ? 'admin' : 'user', now());
    u = one('SELECT * FROM users WHERE id=?', res.lastInsertRowid);
  }
  return { headers: { 'set-cookie': cookie(mkToken(u.id, u.sv || 0), 2592000) }, data: pub(u) };
});
r('POST', '/api/auth/logout', () => ({ headers: { 'set-cookie': cookie('', 0) }, data: { ok: true } }));
const opt = (v, max, name, re) => { if (v === undefined) return undefined; const t = String(v == null ? '' : v).trim().slice(0, max); if (t && re && !re.test(t)) throw bad(`Check ${name}.`); return t; };
r('PATCH', '/api/me', (c) => {
  const u = c.user, b = c.body;
  const name = b.name === undefined ? u.name : str(b.name, 60, 'your name');
  const phone = opt(b.phone, 20, 'your phone number', /^[0-9+()\- ]{7,20}$/), city = opt(b.city, 60, 'your city'), bio = opt(b.bio, 160, 'your bio');
  run('UPDATE users SET name=?,phone=?,city=?,bio=? WHERE id=?', name, phone === undefined ? u.phone : phone, city === undefined ? u.city : city, bio === undefined ? u.bio : bio, u.id);
  return pub(one('SELECT * FROM users WHERE id=?', u.id));
}, need);
const dropFile = (url, uid) => { const m = /^\/uploads\/(\d+)\/([a-f0-9]+\.(?:jpeg|png|webp))$/.exec(url || ''); if (m && +m[1] === uid) try { fs.unlinkSync(path.join(UP, m[1], m[2])); } catch {} };
r('POST', '/api/me/avatar', (c) => {
  const img = saveImage(c.user.id, c.body.image);
  dropFile(c.user.avatar, c.user.id);
  run('UPDATE users SET avatar=? WHERE id=?', img.url, c.user.id);
  return pub(one('SELECT * FROM users WHERE id=?', c.user.id));
}, need);
r('DELETE', '/api/me/avatar', (c) => { dropFile(c.user.avatar, c.user.id); run('UPDATE users SET avatar=NULL WHERE id=?', c.user.id); return pub(one('SELECT * FROM users WHERE id=?', c.user.id)); }, need);
r('POST', '/api/auth/password', (c) => {
  limit(c.ip);
  if (!c.user.pw) throw bad('This account signs in with Google, so there is no Velora password to change.');
  if (!checkPw(String(c.body.current || ''), c.user.pw)) throw new HttpError(401, 'Your current password does not match.');
  const next = c.body.next;
  if (typeof next !== 'string' || next.length < 8 || next.length > 200) throw bad('Choose a new password with at least 8 characters.');
  run('UPDATE users SET pw=?, sv=sv+1 WHERE id=?', hashPw(next), c.user.id);
  const u = one('SELECT * FROM users WHERE id=?', c.user.id);
  return { headers: { 'set-cookie': cookie(mkToken(u.id, u.sv), 2592000) }, data: { ok: true } };   // other devices are signed out
}, need);
r('POST', '/api/auth/logout-all', (c) => { run('UPDATE users SET sv=sv+1 WHERE id=?', c.user.id); return { headers: { 'set-cookie': cookie('', 0) }, data: { ok: true } }; }, need);
r('GET', '/api/me/export', (c) => {
  const id = c.user.id, kvs = {};
  for (const x of all('SELECT k,v FROM kv WHERE user_id=?', id)) kvs[x.k] = JSON.parse(x.v);
  return { headers: { 'content-disposition': 'attachment; filename="velora-my-data.json"' }, data: {
    exportedAt: new Date().toISOString(), account: pub(c.user), wardrobe: all('SELECT name,category,color,occasion,season,style,bottom,fav,worn,created FROM items WHERE user_id=?', id),
    savedDocuments: kvs, chat: all('SELECT role,text,created FROM chat WHERE user_id=? ORDER BY id', id),
    posts: all('SELECT category,text,created FROM posts WHERE user_id=?', id), comments: all('SELECT text,created FROM comments WHERE user_id=?', id),
    notifications: all('SELECT title,body,created FROM notifications WHERE user_id=?', id), supportMessages: all('SELECT subject,message,status,created FROM support WHERE user_id=?', id) } };
}, need);
r('DELETE', '/api/me', (c) => {
  if (c.body.confirm !== 'DELETE') throw bad('Type DELETE to confirm.');
  if (c.user.pw && !checkPw(String(c.body.password || ''), c.user.pw)) throw new HttpError(401, 'Your password does not match.');
  run('DELETE FROM users WHERE id=?', c.user.id);   // wardrobe, chat, posts and the rest are removed with it
  try { fs.rmSync(path.join(UP, String(c.user.id)), { recursive: true, force: true }); } catch {}
  return { headers: { 'set-cookie': cookie('', 0) }, data: { ok: true } };
}, need);
const MODEL_RE = /^(small|medium|large)-(fair|light|tan|deep)\.(jpg|jpeg|png|webp)$/;
function modelFiles() { try { return fs.readdirSync(path.join(__dirname, 'public', 'models')).filter((f) => MODEL_RE.test(f)); } catch { return []; } }
// photo-real try-on: her own photo (saved once, private) + chosen pieces -> AI -> result photo
const own = (url, uid) => { const m = /^\/uploads\/(\d+)\/([a-f0-9]+\.(jpeg|png|webp))$/.exec(url || ''); return m && +m[1] === uid ? { file: path.join(UP, m[1], m[2]), mime: 'image/' + m[3] } : null; };
const readImg = (f) => { try { return { buf: fs.readFileSync(f.file), mime: f.mime }; } catch { return null; } };
r('POST', '/api/tryon/photo', (c) => {
  const img = saveImage(c.user.id, c.body.image);
  dropFile(c.user.tryon_photo, c.user.id);
  run('UPDATE users SET tryon_photo=? WHERE id=?', img.url, c.user.id);
  return pub(one('SELECT * FROM users WHERE id=?', c.user.id));
}, need);
r('DELETE', '/api/tryon/photo', (c) => { dropFile(c.user.tryon_photo, c.user.id); run('UPDATE users SET tryon_photo=NULL WHERE id=?', c.user.id); return pub(one('SELECT * FROM users WHERE id=?', c.user.id)); }, need);
r('POST', '/api/tryon', async (c) => {
  if (!tryon.provider) throw new HttpError(501, 'AI try-on needs an image AI service. Add GEMINI_API_KEY (or FAL_KEY) to the .env file.');
  let person = null;
  const mf = typeof c.body.model === 'string' ? c.body.model : '';
  if (mf) {   // one of the house models in public/models
    if (!MODEL_RE.test(mf)) throw bad('That model is not available.');
    person = readImg({ file: path.join(__dirname, 'public', 'models', mf), mime: 'image/' + (/png$/.test(mf) ? 'png' : /webp$/.test(mf) ? 'webp' : 'jpeg') });
    if (!person) throw bad('That model is not available.');
  } else {
    const personFile = own(c.user.tryon_photo, c.user.id);
    person = personFile && readImg(personFile);
    if (!person) throw bad('Add a full-length photo of yourself first.');
  }
  const size = ['small', 'medium', 'large'].includes(c.body.size) ? c.body.size : null;
  const ids = (Array.isArray(c.body.items) ? c.body.items : []).map(Number).filter(Number.isInteger).slice(0, 3);
  if (!ids.length) throw bad('Choose at least one piece to try on.');
  const garments = [];
  for (const id of ids) {
    const it = one('SELECT * FROM items WHERE id=? AND user_id=?', id, c.user.id);
    if (!it) throw new HttpError(404, 'We could not find one of those pieces.');
    let g = null;
    if (/^i\d{1,4}$/.test(it.lib || '')) g = readImg({ file: path.join(__dirname, 'public', 'garments', it.lib + '.jpg'), mime: 'image/jpeg' });
    if (!g) { const f = own(it.image, c.user.id); g = f && readImg(f); }
    if (!g) throw bad(`"${it.name}" has no photo yet, so it cannot be tried on.`);
    garments.push(g);
  }
  if (one('SELECT COUNT(*) n FROM tryon_log WHERE user_id=? AND created>?', c.user.id, now() - 36e5).n >= 8) throw new HttpError(429, 'You have tried on a lot just now. Please wait a little, then try again.');
  run('INSERT INTO tryon_log(user_id,created) VALUES(?,?)', c.user.id, now());
  let out;
  try { out = await tryon.run(person, garments, { size }); } catch { throw new HttpError(502, 'Something went wrong while dressing your photo. Please try again.'); }
  const ext = /png/.test(out.mime) ? 'png' : /webp/.test(out.mime) ? 'webp' : 'jpeg';
  const name = crypto.randomBytes(12).toString('hex') + '.' + ext;
  fs.mkdirSync(path.join(UP, String(c.user.id)), { recursive: true });
  fs.writeFileSync(path.join(UP, String(c.user.id), name), out.buf);
  return { image: `/uploads/${c.user.id}/${name}` };
}, need);
r('POST', '/api/support', (c) => {
  const subject = ['Problem', 'Question', 'Idea', 'Account'].includes(c.body.subject) ? c.body.subject : null;
  if (!subject) throw bad('Choose what your message is about.');
  const msg = str(c.body.message, 2000, 'your message');
  if (msg.length < 10) throw bad('Please write a little more so we can help.');
  if (one('SELECT COUNT(*) n FROM support WHERE user_id=? AND created>?', c.user.id, now() - 36e5).n >= 5) throw new HttpError(429, 'You have sent a few messages already. Please wait a little before sending more.');
  run('INSERT INTO support(user_id,subject,message,created) VALUES(?,?,?,?)', c.user.id, subject, msg, now());
  return { code: 201, data: { ok: true } };
}, need);
r('GET', '/api/status', () => ({ ai: ai.configured, tryon: !!tryon.provider, models: modelFiles(), google: !!process.env.GOOGLE_CLIENT_ID }));
r('GET', '/api/me', (c) => (c.user ? pub(c.user) : { user: null }));

// per-user JSON documents (preferences, try-on looks, weekly plan, saved trends)
const KEYS = ['prefs', 'looks', 'plan', 'trends', 'chatprefs', 'chatlog', 'outfits', 'tryonres', 'notif'];
r('GET', '/api/data/:key', (c) => {
  if (!KEYS.includes(c.params.key)) throw new HttpError(404, 'Not found.');
  const row = one('SELECT v FROM kv WHERE user_id=? AND k=?', c.user.id, c.params.key);
  return row ? JSON.parse(row.v) : null;
}, need);
r('PUT', '/api/data/:key', (c) => {
  if (!KEYS.includes(c.params.key)) throw new HttpError(404, 'Not found.');
  const v = JSON.stringify(c.body.value ?? null);
  if (v.length > 200000) throw bad('That is too much data to save.');
  run('INSERT INTO kv(user_id,k,v) VALUES(?,?,?) ON CONFLICT(user_id,k) DO UPDATE SET v=excluded.v', c.user.id, c.params.key, v);
  return { ok: true };
}, need);

// wardrobe
r('GET', '/api/wardrobe', (c) => all('SELECT * FROM items WHERE user_id=? ORDER BY id DESC', c.user.id).map(itemOut), need);
r('POST', '/api/wardrobe', (c) => {
  const b = c.body, cat = CATS.includes(b.category) ? b.category : null;
  if (!cat) throw bad('Choose a category for this item.');
  const img = b.image ? saveImage(c.user.id, b.image).url : null;
  const res = run('INSERT INTO items(user_id,name,category,color,occasion,season,style,bottom,lib,image,created) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
    c.user.id, str(b.name, 80, 'the item name'), cat, hex(b.color), b.occasion ? String(b.occasion).slice(0, 40) : null, b.season ? String(b.season).slice(0, 40) : null, b.style ? String(b.style).slice(0, 40) : null, b.bottom ? String(b.bottom).slice(0, 40) : null, /^i\d{1,4}$/.test(b.lib || '') ? b.lib : null, img, now());
  return { code: 201, data: itemOut(one('SELECT * FROM items WHERE id=?', res.lastInsertRowid)) };
}, need);
r('POST', '/api/wardrobe/scan', async (c) => {
  if (!ai.configured) throw new HttpError(501, 'Wardrobe scanning needs the AI service. Add ANTHROPIC_API_KEY to the .env file.');
  const img = saveImage(c.user.id, c.body.image);
  let found;
  try { found = await ai.scan(img.buf, img.mime); } catch { throw new HttpError(502, 'Something went wrong while analyzing this image. Please try again.'); }
  const out = found.map((x) => {
    const res = run('INSERT INTO items(user_id,name,category,color,occasion,season,style,bottom,image,created) VALUES(?,?,?,?,?,?,?,?,?,?)', c.user.id, x.name, x.category, x.color, x.occasion, x.season, x.style, x.bottom, img.url, now());
    return itemOut(one('SELECT * FROM items WHERE id=?', res.lastInsertRowid));
  });
  return { code: 201, data: { added: out.length, items: out } };
}, need);
r('PATCH', '/api/wardrobe/:id', (c) => {
  const it = one('SELECT * FROM items WHERE id=? AND user_id=?', +c.params.id, c.user.id);
  if (!it) throw new HttpError(404, 'We could not find that item.');
  const b = c.body, n = { ...it };
  if (b.name !== undefined) n.name = str(b.name, 80, 'the item name');
  if (b.category !== undefined) { if (!CATS.includes(b.category)) throw bad('Choose a valid category.'); n.category = b.category; }
  if (b.color !== undefined) n.color = hex(b.color);
  for (const k of ['occasion', 'season', 'style', 'bottom']) if (b[k] !== undefined) n[k] = String(b[k]).slice(0, 40);
  if (b.fav !== undefined) n.fav = b.fav ? 1 : 0;
  run('UPDATE items SET name=?,category=?,color=?,occasion=?,season=?,style=?,bottom=?,fav=? WHERE id=? AND user_id=?', n.name, n.category, n.color, n.occasion, n.season, n.style, n.bottom, n.fav, it.id, c.user.id);
  return itemOut(one('SELECT * FROM items WHERE id=?', it.id));
}, need);
r('POST', '/api/wardrobe/:id/worn', (c) => {
  const res = run('UPDATE items SET worn=worn+1,last_worn=? WHERE id=? AND user_id=?', now(), +c.params.id, c.user.id);
  if (!res.changes) throw new HttpError(404, 'We could not find that item.');
  return itemOut(one('SELECT * FROM items WHERE id=?', +c.params.id));
}, need);
r('DELETE', '/api/wardrobe/:id', (c) => {
  const it = one('SELECT image FROM items WHERE id=? AND user_id=?', +c.params.id, c.user.id);
  if (!it) throw new HttpError(404, 'We could not find that item.');
  run('DELETE FROM items WHERE id=? AND user_id=?', +c.params.id, c.user.id);
  return { ok: true };
}, need);

// styling chat
r('GET', '/api/chat', (c) => all('SELECT role,text,created FROM chat WHERE user_id=? ORDER BY id DESC LIMIT 50', c.user.id).reverse(), need);
r('POST', '/api/chat', async (c) => {
  const text = str(c.body.text, 1000, 'a message'), tone = String(c.body.tone || 'Friendly').slice(0, 30);
  run('INSERT INTO chat(user_id,role,text,created) VALUES(?,?,?,?)', c.user.id, 'user', text, now());
  const wardrobe = all('SELECT category,name FROM items WHERE user_id=? ORDER BY id DESC LIMIT 120', c.user.id);
  let reply;
  if (ai.configured) {
    try { reply = await ai.chat(all('SELECT role,text FROM chat WHERE user_id=? ORDER BY id DESC LIMIT 10', c.user.id).reverse(), wardrobe, tone, String(c.body.weather || '').slice(0, 120)); }
    catch { throw new HttpError(502, 'Something went wrong while thinking about your look. Please try again.'); }
  } else {
    const pick = (cat) => (wardrobe.find((i) => i.category === cat) || {}).name;
    const parts = ['Dresses', 'Shoes', 'Bags', 'Scarves'].map(pick).filter(Boolean);
    reply = parts.length ? 'The AI stylist is not connected yet, but from your wardrobe I would start with: ' + parts.join(', ') + '.' : 'The AI stylist is not connected yet. Add items to your wardrobe and I will use them.';
  }
  run('INSERT INTO chat(user_id,role,text,created) VALUES(?,?,?,?)', c.user.id, 'assistant', reply, now());
  return { reply };
}, need);

// community
const postSql = `SELECT p.id,p.category,p.text,p.palette,p.created,p.user_id AS authorId,u.name AS author,
 (SELECT COUNT(*) FROM likes WHERE post_id=p.id) AS likes,(SELECT COUNT(*) FROM comments WHERE post_id=p.id) AS comments,
 EXISTS(SELECT 1 FROM likes WHERE post_id=p.id AND user_id=@me) AS liked,EXISTS(SELECT 1 FROM saves WHERE post_id=p.id AND user_id=@me) AS saved
 FROM posts p JOIN users u ON u.id=p.user_id WHERE p.hidden=0 AND NOT EXISTS(SELECT 1 FROM reports r WHERE r.post_id=p.id AND r.user_id=@me)`;
const postOut = (p, me) => ({ id: p.id, category: p.category, text: p.text, palette: p.palette ? JSON.parse(p.palette) : null, created: p.created, author: p.author, mine: p.authorId === me, likes: p.likes, comments: p.comments, liked: !!p.liked, saved: !!p.saved });
r('GET', '/api/community', (c) => {
  const me = c.user ? c.user.id : 0, cat = c.url.searchParams.get('category');
  const rows = cat ? db.prepare(postSql + ' AND p.category=@cat ORDER BY p.id DESC LIMIT 100').all({ me, cat }) : db.prepare(postSql + ' ORDER BY p.id DESC LIMIT 100').all({ me });
  return rows.map((p) => postOut(p, me));
});
r('GET', '/api/community/saved', (c) => db.prepare(postSql + ' AND p.id IN (SELECT post_id FROM saves WHERE user_id=@me) ORDER BY p.id DESC').all({ me: c.user.id }).map((p) => postOut(p, c.user.id)), need);
r('POST', '/api/community', (c) => {
  const cat = str(c.body.category, 40, 'a category'), text = str(c.body.text, 600, 'a few words about your look');
  const pal = Array.isArray(c.body.palette) ? c.body.palette.filter((x) => hex(x)).slice(0, 8) : null;
  const res = run('INSERT INTO posts(user_id,category,text,palette,created) VALUES(?,?,?,?,?)', c.user.id, cat, text, pal && pal.length ? JSON.stringify(pal) : null, now());
  return { code: 201, data: postOut(db.prepare(postSql + ' AND p.id=@id').get({ me: c.user.id, id: res.lastInsertRowid }), c.user.id) };
}, need);
r('DELETE', '/api/community/:id', (c) => {
  const res = run('DELETE FROM posts WHERE id=? AND user_id=?', +c.params.id, c.user.id);
  if (!res.changes) throw new HttpError(404, 'We could not find that post.');
  return { ok: true };
}, need);
const toggle = (table) => (c) => {
  const id = +c.params.id; if (!one('SELECT id FROM posts WHERE id=? AND hidden=0', id)) throw new HttpError(404, 'We could not find that post.');
  const del = run(`DELETE FROM ${table} WHERE post_id=? AND user_id=?`, id, c.user.id);
  if (!del.changes) run(`INSERT INTO ${table}(post_id,user_id) VALUES(?,?)`, id, c.user.id);
  return { on: !del.changes };
};
r('POST', '/api/community/:id/like', toggle('likes'), need);
r('POST', '/api/community/:id/save', toggle('saves'), need);
r('GET', '/api/community/:id/comments', (c) => all('SELECT c.id,c.text,c.created,u.name AS author FROM comments c JOIN users u ON u.id=c.user_id WHERE c.post_id=? ORDER BY c.id', +c.params.id));
r('POST', '/api/community/:id/comments', (c) => {
  const id = +c.params.id, p = one('SELECT user_id FROM posts WHERE id=? AND hidden=0', id);
  if (!p) throw new HttpError(404, 'We could not find that post.');
  const text = str(c.body.text, 400, 'a comment');
  run('INSERT INTO comments(post_id,user_id,text,created) VALUES(?,?,?,?)', id, c.user.id, text, now());
  if (p.user_id !== c.user.id) notify(p.user_id, 'New comment on your look', `${c.user.name}: ${text.slice(0, 80)}`, 'community');
  return { code: 201, data: { ok: true } };
}, need);
r('POST', '/api/community/:id/report', (c) => {
  const id = +c.params.id; if (!one('SELECT id FROM posts WHERE id=?', id)) throw new HttpError(404, 'We could not find that post.');
  run('INSERT OR IGNORE INTO reports(post_id,user_id,created) VALUES(?,?,?)', id, c.user.id, now());
  return { ok: true };
}, need);

// notifications
r('GET', '/api/notifications', (c) => all('SELECT id,title,body,action,is_read AS isRead,created FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 50', c.user.id), need);
r('POST', '/api/notifications/read', (c) => { run('UPDATE notifications SET is_read=1 WHERE user_id=?', c.user.id); return { ok: true }; }, need);

// weather (free, no key: Open-Meteo)
r('GET', '/api/weather', async (c) => {
  const lat = +c.url.searchParams.get('lat'), lon = +c.url.searchParams.get('lon');
  if (!(Math.abs(lat) <= 90) || !(Math.abs(lon) <= 180) || c.url.searchParams.get('lat') === null) throw bad('Location is missing.');
  try {
    const j = await (await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,precipitation,weather_code`)).json();
    return { temp: j.current.temperature_2m, humidity: j.current.relative_humidity_2m, rain: j.current.precipitation, code: j.current.weather_code };
  } catch { throw new HttpError(502, 'We could not get the weather right now.'); }
});

// admin
r('GET', '/api/admin/support', () => all("SELECT s.id,s.subject,s.message,s.created,u.name AS author,u.email FROM support s JOIN users u ON u.id=s.user_id WHERE s.status='open' ORDER BY s.id DESC LIMIT 100"), adminOnly);
r('POST', '/api/admin/support/:id/done', (c) => { run("UPDATE support SET status='done' WHERE id=?", +c.params.id); return { ok: true }; }, adminOnly);
r('GET', '/api/admin/stats', () => ({ users: one('SELECT COUNT(*) n FROM users').n, posts: one('SELECT COUNT(*) n FROM posts WHERE hidden=0').n, items: one('SELECT COUNT(*) n FROM items').n, openReports: one("SELECT COUNT(*) n FROM reports WHERE status='open'").n }), adminOnly);
r('GET', '/api/admin/reports', () => all("SELECT r.id,r.post_id AS postId,p.text,p.category,u.name AS author,COUNT(*) OVER(PARTITION BY r.post_id) AS reports FROM reports r JOIN posts p ON p.id=r.post_id JOIN users u ON u.id=p.user_id WHERE r.status='open' ORDER BY r.id DESC"), adminOnly);
r('POST', '/api/admin/reports/:id/:action', (c) => {
  const rep = one('SELECT post_id FROM reports WHERE id=?', +c.params.id);
  if (!rep) throw new HttpError(404, 'We could not find that report.');
  if (c.params.action === 'remove') { run('UPDATE posts SET hidden=1 WHERE id=?', rep.post_id); run("UPDATE reports SET status='resolved' WHERE post_id=?", rep.post_id); }
  else if (c.params.action === 'keep') run("UPDATE reports SET status='dismissed' WHERE post_id=?", rep.post_id);
  else throw bad('Unknown action.');
  return { ok: true };
}, adminOnly);


// ---------- scheduled messages and reminders ----------
const pad = (n) => String(n).padStart(2, '0');
const parts = (ms, tz) => { const d = new Date(ms - (tz || 0) * 60000); return { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), dow: (d.getUTCDay() + 6) % 7, date: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` }; };
const MSG = {
  morning: (n, look) => ({ title: `Good morning, ${n} 🌸`, body: look ? `Your look for today is ready: ${look}.` : 'Your look for today is ready. Open Velora to see it.' }),
  evening: (n) => ({ title: `Good evening, ${n}`, body: "How did today's look feel? Save it, or plan tomorrow's outfit." }),
  night: (n, look) => ({ title: `Good night, ${n} 🌙`, body: look ? `Lay out tomorrow's outfit tonight: ${look}.` : "Lay out tomorrow's outfit tonight so the morning is easy." }),
};
function planLook(uid, day) {
  const row = one("SELECT v FROM kv WHERE user_id=? AND k='plan'", uid); if (!row) return null;
  try {
    const d = JSON.parse(row.v)[day]; if (!d || !d.l) return null;
    const names = ['Top', 'Bottom', 'Dupatta'].map((k) => d.l[k] && one('SELECT name FROM items WHERE id=? AND user_id=?', +d.l[k], uid)).filter(Boolean).map((x) => x.name);
    return names.length ? names.join(' with ') : null;
  } catch { return null; }
}
function tick(nowMs = now()) {
  let sent = 0;
  run('DELETE FROM notif_sent WHERE created<?', nowMs - 60 * 864e5);
  for (const row of all("SELECT k.user_id AS uid, k.v AS v, u.name AS name FROM kv k JOIN users u ON u.id=k.user_id WHERE k.k='notif'")) {
    let doc; try { doc = JSON.parse(row.v); } catch { continue; }
    const tz = Number.isFinite(+doc.tz) ? +doc.tz : 0, lp = parts(nowMs, tz), first = String(row.name).split(' ')[0];
    const once = (key) => run('INSERT OR IGNORE INTO notif_sent(user_id,k,created) VALUES(?,?,?)', row.uid, key, nowMs).changes > 0;
    for (const kind of ['morning', 'evening', 'night']) {   // delivered within 10 minutes after the chosen time
      const c = doc.daily && doc.daily[kind]; if (!c || !c.on || !/^\d\d:\d\d$/.test(c.t || '')) continue;
      const [hh, mm] = c.t.split(':').map(Number), diff = lp.h * 60 + lp.mi - (hh * 60 + mm);
      if (diff < 0 || diff > 10 || !once(`${kind}:${lp.date}`)) continue;
      const m = MSG[kind](first, kind === 'night' ? planLook(row.uid, (lp.dow + 1) % 7) : kind === 'morning' ? planLook(row.uid, lp.dow) : null);
      notify(row.uid, m.title, m.body, 'planner'); sent++;
    }
    for (const r of Array.isArray(doc.reminders) ? doc.reminders.slice(0, 50) : []) {
      if (!r || !/^\d{4}-\d\d-\d\d$/.test(r.date || '') || !/^\d\d:\d\d$/.test(r.time || '')) continue;
      const lead = r.lead === 'evening' ? 'evening' : Math.max(0, Math.min(1440, +r.lead || 0));
      const [ry, rm, rd] = r.date.split('-').map(Number), startMs = Date.UTC(ry, rm - 1, rd), todayMs = Date.UTC(lp.y, lp.mo - 1, lp.d), occ = [];
      if (['weekdays', 'daily', 'weekly'].includes(r.repeat)) {
        for (const off of [0, 1]) {
          const oMs = todayMs + off * 864e5, dow = (new Date(oMs).getUTCDay() + 6) % 7;
          if (oMs >= startMs && (r.repeat === 'daily' || (r.repeat === 'weekdays' && dow < 5) || (r.repeat === 'weekly' && Math.round((oMs - startMs) / 864e5) % 7 === 0))) occ.push(oMs);
        }
      } else occ.push(startMs);
      const [th, tm] = r.time.split(':').map(Number), nowLocal = nowMs - tz * 60000;
      for (const oMs of occ) {
        const eventAt = oMs + (th * 60 + tm) * 60000, dueAt = lead === 'evening' ? oMs - 864e5 + 21 * 36e5 : eventAt - lead * 60000;
        if (nowLocal < dueAt || nowLocal > eventAt) continue;   // not due yet, or the event has already started
        const od = new Date(oMs), odate = `${od.getUTCFullYear()}-${pad(od.getUTCMonth() + 1)}-${pad(od.getUTCDate())}`;
        if (!once(`rem:${String(r.id).slice(0, 40)}:${odate}`)) continue;
        const look = planLook(row.uid, (od.getUTCDay() + 6) % 7), title = String(r.title || 'Your event').slice(0, 60);
        notify(row.uid, `Time to get ready: ${title}`, `${title} is at ${r.time}.${look ? ` Your suggested look: ${look}.` : ' Open Velora to choose your look.'}`, 'planner'); sent++;
      }
    }
  }
  return sent;
}

// ---------- server ----------
const TYPES = { '.mp4': 'video/mp4', '.webm': 'video/webm', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const SEC = { 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'referrer-policy': 'same-origin' };
function readBody(req) {
  return new Promise((ok, no) => {
    let n = 0; const c = [];
    req.on('data', (d) => { n += d.length; if (n > 12e6) { no(new HttpError(413, 'That file is too large.')); req.destroy(); } else c.push(d); });
    req.on('end', () => { if (!c.length) return ok({}); try { const o = JSON.parse(Buffer.concat(c)); ok(o && typeof o === 'object' ? o : {}); } catch { no(bad('Something was wrong with that request.')); } });
    req.on('error', no);
  });
}
const send = (res, code, obj, headers = {}) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...SEC, ...headers }); res.end(JSON.stringify(obj)); };

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x'), ck = Object.fromEntries((req.headers.cookie || '').split(/;\s*/).filter(Boolean).map((s) => { const i = s.indexOf('='); return [s.slice(0, i), s.slice(i + 1)]; }));
    const tk = readToken(ck.velora); let user = tk ? one('SELECT * FROM users WHERE id=?', tk.uid) : null;
    if (user && (user.sv || 0) !== tk.sv) user = null;   // signed out everywhere

    if (req.method === 'GET' && url.pathname.startsWith('/uploads/')) {
      const m = /^\/uploads\/(\d+)\/([a-f0-9]+\.(?:jpeg|png|webp))$/.exec(url.pathname);
      if (!m || !user || String(user.id) !== m[1]) { res.writeHead(404, SEC); return res.end(); }
      const f = path.join(UP, m[1], m[2]);
      if (!fs.existsSync(f)) { res.writeHead(404, SEC); return res.end(); }
      res.writeHead(200, { 'content-type': TYPES['.' + m[2].split('.')[1]] || 'application/octet-stream', 'cache-control': 'private, max-age=3600', ...SEC });
      return fs.createReadStream(f).pipe(res);
    }

    if (url.pathname.startsWith('/api/')) {
      const rt = routes.find((x) => x.method === req.method && x.re.test(url.pathname));
      if (!rt) return send(res, 404, { error: 'Not found.' });
      if (rt.auth && !user) return send(res, 401, { error: 'Please log in to continue.' });
      if (rt.admin && user.role !== 'admin') return send(res, 403, { error: 'You do not have access to this page.' });
      let body = {};
      if (req.method !== 'GET') {
        if (!/application\/json/.test(req.headers['content-type'] || '') && +req.headers['content-length'] > 0) throw bad('Something was wrong with that request.');
        body = await readBody(req);
      }
      const out = await rt.fn({ req, url, body, user, params: rt.re.exec(url.pathname).groups || {}, ip: req.socket.remoteAddress });
      if (out && out.data !== undefined && (out.code || out.headers)) return send(res, out.code || 200, out.data, out.headers);
      return send(res, 200, out === undefined ? { ok: true } : out);
    }

    // static frontend
    let rel = decodeURIComponent(url.pathname); if (rel === '/') rel = '/index.html';
    const f = path.join(__dirname, 'public', path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
    if (!f.startsWith(path.join(__dirname, 'public')) || !fs.existsSync(f) || !fs.statSync(f).isFile()) { res.writeHead(404, SEC); return res.end('Not found'); }
    const size = fs.statSync(f).size, hdr = { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'accept-ranges': 'bytes', ...SEC };
    if (/\.(mp4|webm|jpg|png|webp)$/.test(f)) hdr['cache-control'] = 'public, max-age=86400';
    const rg = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (rg && (rg[1] || rg[2])) {   // video players ask for pieces of the file (Safari needs this)
      const s0 = rg[1] ? +rg[1] : Math.max(0, size - +rg[2]), e0 = rg[1] && rg[2] ? Math.min(+rg[2], size - 1) : size - 1;
      if (s0 > e0 || s0 >= size) { res.writeHead(416, { 'content-range': `bytes */${size}`, ...SEC }); return res.end(); }
      res.writeHead(206, { ...hdr, 'content-range': `bytes ${s0}-${e0}/${size}`, 'content-length': e0 - s0 + 1 });
      return fs.createReadStream(f, { start: s0, end: e0 }).pipe(res);
    }
    res.writeHead(200, { ...hdr, 'content-length': size });
    fs.createReadStream(f).pipe(res);
  } catch (e) {
    if (e instanceof HttpError) return send(res, e.code, { error: e.message });
    console.error(e);
    send(res, 500, { error: 'Something went wrong on our side. Please try again.' });
  }
});

if (require.main === module || process.env.VELORA_START) {
  server.listen(PORT, () => console.log(`Velora running at http://localhost:${PORT}  (AI: ${ai.configured ? 'on' : 'off'})`));
  setInterval(() => { try { tick(); } catch (e) { console.error(e); } }, 30000).unref();   // sends the scheduled messages
}
module.exports = server;
server.tick = tick;
