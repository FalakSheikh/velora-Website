'use strict';
// Tests the whole try-on path with a pretend image service (no key or internet needed).
const os = require('os'), path = require('path'), fs = require('fs');
process.env.DB_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'velora-')), 'test.db');
process.env.GEMINI_API_KEY = 'test-key';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
let seen = null; const realFetch = globalThis.fetch;
globalThis.fetch = async (u, o) => {
  if (String(u).startsWith('https://generativelanguage.googleapis.com/')) {
    const b = JSON.parse(o.body); seen = { key: o.headers['x-goog-api-key'], parts: b.contents[0].parts };
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: PNG.toString('base64') } }] } }] }), { status: 200 });
  }
  return realFetch(u, o);
};
const server = require('./server');
let pass = 0, fail = 0; const ok = (c, n) => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + n); };
server.listen(0, async () => {
  const base = 'http://127.0.0.1:' + server.address().port;
  const client = () => { let ck = ''; return async (m, p, b) => { const r = await fetch(base + p, { method: m, headers: { 'content-type': 'application/json', cookie: ck }, body: b ? JSON.stringify(b) : undefined }); const sc = r.headers.get('set-cookie'); if (sc) ck = sc.split(';')[0]; let j = null; try { j = await r.json(); } catch {} return { s: r.status, j, h: r.headers }; }; };
  const A = client(), B = client(), jpg = (await realFetch(base + '/garments/i0.jpg')).status;
  ok(jpg === 200, 'garment photos are served');
  await A('POST', '/api/auth/signup', { name: 'Hira', email: 'h@t.com', password: 'secret123' });
  await B('POST', '/api/auth/signup', { name: 'Sana', email: 's@t.com', password: 'secret123' });
  ok((await A('GET', '/api/status')).j.tryon === true, 'status says try-on is on');
  const dress = (await A('POST', '/api/wardrobe', { name: 'Long Shirt with Palazzo', category: 'Dresses', lib: 'i0', style: 'Long Shirt', bottom: 'Palazzo' })).j;
  const scarf = (await A('POST', '/api/wardrobe', { name: 'Grey scarf', category: 'Scarves', lib: 'i40' })).j;
  const bare = (await A('POST', '/api/wardrobe', { name: 'Sample piece', category: 'Bags' })).j;
  ok((await A('POST', '/api/tryon', { items: [dress.id] })).s === 400, 'asks for her photo first');
  const PD = 'data:image/png;base64,' + PNG.toString('base64');
  const me = (await A('POST', '/api/tryon/photo', { image: PD })).j;
  ok(me.tryonPhoto && me.tryonPhoto.startsWith('/uploads/'), 'her photo is saved once');
  ok((await A('POST', '/api/tryon', { items: [] })).s === 400, 'asks her to choose a piece');
  ok((await A('POST', '/api/tryon', { items: [bare.id] })).s === 400, 'a piece without a photo is explained');
  ok((await B('POST', '/api/tryon', { items: [dress.id] })).s === 400, "another member's pieces cannot be used (she has no photo)");
  await B('POST', '/api/tryon/photo', { image: PD });
  ok((await B('POST', '/api/tryon', { items: [dress.id] })).s === 404, "another member's pieces are not found");
  const r = await A('POST', '/api/tryon', { items: [dress.id, scarf.id] });
  ok(r.s === 200 && r.j.image.startsWith('/uploads/'), 'try-on returns a result photo');
  ok(seen.key === 'test-key' && seen.parts.filter((p) => p.inline_data).length === 3 && seen.parts[0].text.includes('realistic'), 'the AI got her photo, both garments and clear instructions');
  ok((await realFetch(base + r.j.image, { headers: { cookie: '' } })).status === 404, 'the result photo is private');
  for (let i = 0; i < 7; i++) await A('POST', '/api/tryon', { items: [dress.id] });
  ok((await A('POST', '/api/tryon', { items: [dress.id] })).s === 429, 'too many tries in an hour are slowed down kindly');
  fs.mkdirSync(path.join(__dirname, 'public', 'models'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, 'public', 'models', 'medium-tan.jpg'), PNG);
  ok((await A('GET', '/api/status')).j.models.includes('medium-tan.jpg'), 'house model photos are listed');
  const dm = await B('POST', '/api/tryon', { items: [(await B('POST', '/api/wardrobe', { name: 'Test', category: 'Dresses', lib: 'i1' })).j.id], model: 'medium-tan.jpg', size: 'large' });
  ok(dm.s === 200 && seen.parts[0].text.includes('size large') && seen.parts[0].text.includes('comfortable'), 'a house model can be dressed, with the chosen size in the instructions');
  ok((await B('POST', '/api/tryon', { items: [1], model: '../server.js' })).s === 400, 'model names cannot escape the models folder');
  fs.rmSync(path.join(__dirname, 'public', 'models', 'medium-tan.jpg'));
  const del = (await A('DELETE', '/api/tryon/photo')).j;
  ok(del.tryonPhoto === null, 'her photo can be removed');
  console.log(`\n${pass} passed, ${fail} failed`); server.close(); process.exit(fail ? 1 : 0);
});
