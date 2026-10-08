'use strict';
// Run with: npm test   (uses a temporary database, never your real data)
const os = require('os'), path = require('path'), fs = require('fs');
process.env.DB_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'velora-')), 'test.db');
process.env.ADMIN_EMAIL = 'admin@test.com';
delete process.env.ANTHROPIC_API_KEY;
const server = require('./server');

let pass = 0, fail = 0;
const ok = (c, name) => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + name); };

server.listen(0, async () => {
  const base = 'http://127.0.0.1:' + server.address().port;
  const client = () => { let ck = ''; return async (m, p, b) => {
    const r = await fetch(base + p, { method: m, headers: { 'content-type': 'application/json', cookie: ck }, body: b ? JSON.stringify(b) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) ck = sc.split(';')[0];
    let j = null; try { j = await r.json(); } catch {} return { s: r.status, j };
  }; };
  const A = client(), B = client(), G = client(), AD = client();

  let r = await A('POST', '/api/auth/signup', { name: 'Hira', email: 'hira@test.com', password: 'secret123' });
  ok(r.s === 201 && r.j.name === 'Hira' && !r.j.pw, 'signup works and hides the password');
  ok((await A('POST', '/api/auth/signup', { name: 'X', email: 'hira@test.com', password: 'secret123' })).s === 409, 'duplicate email rejected');
  ok((await G('POST', '/api/auth/signup', { name: 'X', email: 'x@test.com', password: 'short' })).s === 400, 'weak password rejected');
  ok((await G('POST', '/api/auth/login', { email: 'hira@test.com', password: 'wrongpass1' })).s === 401, 'wrong password rejected');
  ok((await G('GET', '/api/wardrobe')).s === 401, 'wardrobe is protected for guests');
  ok((await A('GET', '/api/me')).j.email === 'hira@test.com', 'session works');

  await B('POST', '/api/auth/signup', { name: 'Sana', email: 'sana@test.com', password: 'secret456' });
  r = await A('POST', '/api/wardrobe', { name: 'Black everyday abaya', category: 'Abayas', color: '#33292A' });
  const id = r.j.id;
  ok(r.s === 201 && id, 'item created');
  ok((await A('PATCH', '/api/wardrobe/' + id, { name: 'Black abaya', fav: true })).j.fav === true, 'item edited');
  const st = (await A('POST', '/api/wardrobe', { name: 'Olive Kalidar with Sharara', category: 'Dresses', style: 'Kalidar', bottom: 'Sharara', lib: 'i4' })).j;
  ok(st.style === 'Kalidar' && st.bottom === 'Sharara' && st.lib === 'i4', 'dress style and bottom style are saved');
  ok((await A('PATCH', '/api/wardrobe/' + st.id, { style: 'Anarkali', bottom: 'Churidar' })).j.style === 'Anarkali', 'styles can be edited');
  await A('DELETE', '/api/wardrobe/' + st.id);
  ok((await A('POST', '/api/wardrobe/' + id + '/worn')).j.worn === 1, 'worn counter works');
  ok((await B('GET', '/api/wardrobe')).j.length === 0, "Sana cannot see Hira's items");
  ok((await B('PATCH', '/api/wardrobe/' + id, { name: 'Hacked' })).s === 404, "Sana cannot edit Hira's item");
  ok((await B('DELETE', '/api/wardrobe/' + id)).s === 404, "Sana cannot delete Hira's item");
  ok((await A('POST', '/api/wardrobe', { name: 'Bad', category: 'Nonsense' })).s === 400, 'invalid category rejected');
  ok((await A('POST', '/api/wardrobe', { name: 'Fake', category: 'Bags', image: 'data:image/png;base64,AAAA' })).s === 400, 'fake image rejected');
  ok((await A('POST', '/api/wardrobe/scan', { image: 'x' })).s === 501, 'scan explains the AI key is missing');

  ok((await A('PUT', '/api/data/looks', { value: [{ Top: 1 }] })).j.ok, 'looks saved');
  ok((await A('GET', '/api/data/looks')).j[0].Top === 1, 'looks persist');
  ok((await B('GET', '/api/data/looks')).j === null, 'looks are private');
  ok((await A('GET', '/api/data/secrets')).s === 404, 'unknown data key blocked');

  r = await A('POST', '/api/community', { category: 'Eid Looks', text: 'Ivory chikankari with rose dupatta', palette: ['#F3EBDD', '#E2BDB8'] });
  const pid = r.j.id; ok(r.s === 201, 'post created');
  ok((await B('POST', '/api/community/' + pid + '/like')).j.on === true, 'like works');
  ok((await B('POST', '/api/community/' + pid + '/comments', { text: 'Love it' })).s === 201, 'comment works');
  ok((await A('GET', '/api/notifications')).j.some((n) => n.title.includes('comment')), 'author gets a notification');
  ok((await G('GET', '/api/community')).j[0].likes === 1, 'guests can read the community');
  ok((await B('DELETE', '/api/community/' + pid)).s === 404, "Sana cannot delete Hira's post");
  await B('POST', '/api/community/' + pid + '/report');
  ok((await B('GET', '/api/community')).j.length === 0, 'reported post is hidden for the reporter');

  ok((await A('GET', '/api/admin/stats')).s === 403, 'normal users cannot open admin');
  await AD('POST', '/api/auth/signup', { name: 'Admin', email: 'admin@test.com', password: 'adminpass1' });
  ok((await AD('GET', '/api/admin/stats')).j.openReports === 1, 'admin sees the report');
  const rep = (await AD('GET', '/api/admin/reports')).j[0];
  await AD('POST', '/api/admin/reports/' + rep.id + '/remove');
  ok((await G('GET', '/api/community')).j.length === 0, 'admin removal hides the post for everyone');

  ok((await A('PATCH', '/api/me', { name: 'Hira K' })).j.name === 'Hira K' && (await A('GET', '/api/me')).j.name === 'Hira K', 'name can be changed');
  ok((await A('PUT', '/api/data/outfits', { value: [{ t: 'Eid look' }] })).j.ok && (await B('GET', '/api/data/outfits')).j === null, 'saved outfits persist and stay private');
  await B('POST', '/api/community', { category: 'Workwear', text: 'Mauve shirt dress' });
  const bp = (await B('GET', '/api/community')).j[0].id;
  await A('POST', '/api/community/' + bp + '/save');
  ok((await A('GET', '/api/community/saved')).j.length === 1 && (await B('GET', '/api/community/saved')).j.length === 0, 'saved posts list is per user');
  ok((await A('POST', '/api/chat', { text: 'What should I wear today?' })).j.reply.length > 0, 'chat replies');
  ok((await A('GET', '/api/chat')).j.length === 2, 'chat history saved');
  // ---- settings: personal details, password, devices, export, avatar, support, delete ----
  r = await A('PATCH', '/api/me', { name: 'Hira K', phone: '+92 300 1234567', city: 'Karachi', bio: 'Love neutral lawn' });
  ok(r.j.phone === '+92 300 1234567' && r.j.city === 'Karachi' && r.j.bio.startsWith('Love') && r.j.name === 'Hira K', 'personal details are saved');
  ok((await A('PATCH', '/api/me', { phone: 'abc' })).s === 400, 'bad phone number rejected');
  const me2 = (await A('GET', '/api/me')).j;
  ok(me2.hasPassword === true && !('pw' in me2), 'account info never includes the password');
  const A2 = client(); await A2('POST', '/api/auth/login', { email: 'hira@test.com', password: 'secret123' });
  ok((await A2('GET', '/api/me')).j.email === 'hira@test.com', 'second device is signed in');
  ok((await A('POST', '/api/auth/password', { current: 'wrong-one', next: 'newsecret99' })).s === 401, 'wrong current password rejected');
  ok((await A('POST', '/api/auth/password', { current: 'secret123', next: 'short' })).s === 400, 'short new password rejected');
  ok((await A('POST', '/api/auth/password', { current: 'secret123', next: 'newsecret99' })).j.ok, 'password changed');
  ok((await A('GET', '/api/me')).j.email === 'hira@test.com', 'this device stays signed in');
  ok((await A2('GET', '/api/wardrobe')).s === 401, 'other devices are signed out after a password change');
  ok((await G('POST', '/api/auth/login', { email: 'hira@test.com', password: 'secret123' })).s === 401 && (await G('POST', '/api/auth/login', { email: 'hira@test.com', password: 'newsecret99' })).s === 200, 'old password stops working, new one works');
  const A3 = client(); await A3('POST', '/api/auth/login', { email: 'hira@test.com', password: 'newsecret99' });
  ok((await A('POST', '/api/auth/logout-all')).j.ok && (await A3('GET', '/api/wardrobe')).s === 401 && (await A('GET', '/api/wardrobe')).s === 401, 'sign out of all devices works');
  await A('POST', '/api/auth/login', { email: 'hira@test.com', password: 'newsecret99' });
  const ex = await A('GET', '/api/me/export');
  ok(ex.s === 200 && ex.j.wardrobe.length >= 1 && !JSON.stringify(ex.j).includes('"pw"'), 'data export has my data and no password');
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  ok((await A('POST', '/api/me/avatar', { image: 'data:image/png;base64,AAAA' })).s === 400, 'fake avatar rejected');
  r = await A('POST', '/api/me/avatar', { image: PNG });
  ok(r.s === 200 && r.j.avatar.startsWith('/uploads/'), 'avatar saved');
  ok((await A('DELETE', '/api/me/avatar')).j.avatar === null, 'avatar removed');
  ok((await A('POST', '/api/support', { subject: 'Nope', message: 'long enough message here' })).s === 400, 'support needs a valid subject');
  ok((await A('POST', '/api/support', { subject: 'Problem', message: 'short' })).s === 400, 'support needs a real message');
  ok((await A('POST', '/api/support', { subject: 'Question', message: 'How do I scan my whole wardrobe?' })).s === 201, 'support message sent');
  const adm = (await AD('GET', '/api/admin/support')).j;
  ok(adm.length === 1 && adm[0].email === 'hira@test.com', 'admin sees the support message');
  await AD('POST', '/api/admin/support/' + adm[0].id + '/done');
  ok((await AD('GET', '/api/admin/support')).j.length === 0, 'admin can mark it done');
  ok((await B('DELETE', '/api/me', { confirm: 'nope', password: 'secret456' })).s === 400, 'delete needs the word DELETE');
  ok((await B('DELETE', '/api/me', { confirm: 'DELETE', password: 'wrongpass' })).s === 401, 'delete needs the right password');
  ok((await B('DELETE', '/api/me', { confirm: 'DELETE', password: 'secret456' })).j.ok, 'account deleted');
  ok((await B('GET', '/api/wardrobe')).s === 401, 'deleted account is signed out');
  ok((await G('POST', '/api/auth/login', { email: 'sana@test.com', password: 'secret456' })).s === 401, 'deleted account cannot log in');
  ok((await A('GET', '/api/wardrobe')).j.length >= 1, "other people's data is untouched");
  // ---- AI try-on (no key here, so the helpful message must show) ----
  r = await A('POST', '/api/tryon', { items: [1] });
  ok(r.s === 501 && r.j.error.includes('image AI service'), 'try-on explains the AI key is missing');
  ok((await A('GET', '/api/status')).j.tryon === false, 'status says try-on is off without a key');
  ok((await A('POST', '/api/tryon/photo', { image: 'data:image/png;base64,AAAA' })).s === 400, 'fake try-on photo rejected');
  ok((await G('POST', '/api/tryon', { items: [1] })).s === 401, 'try-on is for signed-in members only');
  // ---- scheduled messages and reminders (Karachi time) ----
  const tzK = -300, at = (y, mo, d, h, mi) => Date.UTC(y, mo - 1, d, h, mi) + tzK * 60000;
  await A('PUT', '/api/data/plan', { value: [{}, { l: { Top: id } }, {}, {}, {}, {}, {}] });
  await A('PUT', '/api/data/notif', { value: { tz: tzK, daily: { morning: { on: true, t: '08:00' }, evening: { on: false, t: '18:30' }, night: { on: true, t: '22:00' } },
    reminders: [{ id: 'r1', title: 'University', date: '2026-10-05', time: '09:00', lead: 60, repeat: 'weekdays' }, { id: 'r2', title: "Dinner at Sana's", date: '2026-10-10', time: '20:00', lead: 'evening', repeat: 'none' }] } });
  ok(server.tick(at(2026, 10, 6, 7, 0)) === 0, 'nothing is sent before the chosen times');
  ok(server.tick(at(2026, 10, 6, 8, 2)) === 2, 'at 8:02 the good-morning message and the university reminder go out');
  ok(server.tick(at(2026, 10, 6, 8, 3)) === 0, 'the same message is never sent twice');
  ok(server.tick(at(2026, 10, 6, 18, 31)) === 0, 'a message that is switched off is not sent');
  ok(server.tick(at(2026, 10, 6, 22, 5)) === 1, 'the good-night message goes out at night');
  ok(server.tick(at(2026, 10, 9, 21, 5)) === 1, 'the evening-before reminder goes out at 9 pm');
  ok(server.tick(at(2026, 10, 10, 20, 30)) === 0, 'nothing is sent after the event has started');
  ok(server.tick(at(2026, 10, 10, 6, 0)) === 0 && server.tick(at(2026, 10, 10, 9, 30)) === 0, 'weekday reminders skip Saturday');
  const nn = (await A('GET', '/api/notifications')).j;
  ok(nn.some((x) => x.title.startsWith('Good morning, Hira') && x.body.includes('Black abaya')), 'the morning message names your planned outfit');
  ok(nn.some((x) => x.title === 'Time to get ready: University') && nn.some((x) => x.title.includes('Dinner at Sana')) && nn.some((x) => x.title.startsWith('Good night')), 'reminders and the night message are in the bell');
  await A('PUT', '/api/data/notif', { value: { tz: tzK, daily: { morning: { on: false, t: '08:00' } }, reminders: [] } });
  ok(server.tick(at(2026, 10, 7, 8, 1)) === 0, 'switching everything off stops the messages');
  ok(Array.isArray((await A('GET', '/api/status')).j.models), 'status lists the available model photos');
  const rg = await fetch(base + '/videos/silk.mp4', { headers: { range: 'bytes=0-99' } });
  ok(rg.status === 206 && rg.headers.get('content-range').startsWith('bytes 0-99/') && rg.headers.get('content-type') === 'video/mp4', 'video files support range requests (needed by Safari)');
  ok((await fetch(base + '/videos/../server.js')).status === 404, 'files outside public are not served');
  ok((await A('POST', '/api/auth/logout')).s === 200, 'logout works');

  console.log(`\n${pass} passed, ${fail} failed`);
  server.close(); process.exit(fail ? 1 : 0);
});
