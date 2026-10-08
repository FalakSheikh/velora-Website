'use strict';
// Real AI integration. Works only when ANTHROPIC_API_KEY is set in .env.
// Without a key, the server answers with a friendly "not connected yet" message.
const KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';
const CATS = ['Dresses', 'Abayas', 'Scarves', 'Shoes', 'Bags', 'Jewellery', 'Accessories', 'Western'];
const OCC = ['Daily wear', 'University', 'Office', 'Wedding', 'Eid', 'Party'];
const SEASONS = ['Summer', 'Winter', 'All seasons'];
const TOPS = ['Short Shirt', 'Long Shirt', 'Straight Shirt', 'A-Line Shirt', 'Flared Shirt', 'Angrakha', 'Peplum Shirt', 'Frock Shirt', 'Kalidar', 'Anarkali', 'Kaftan', 'Kurti', 'Long Kurti', 'Short Kurti', 'Tunic', 'Cape Style Shirt', 'Asymmetric Shirt', 'High-Low Shirt', 'Front Open Shirt', 'Side Slit Shirt', 'Panelled Shirt', 'Boxy Shirt', 'Tail-Cut Shirt', 'Dhoti Style Shirt', 'Jacket Style Shirt', 'Shirt with Ghera', 'Floor-Length Shirt'];
const BOTS = ['Straight Trouser', 'Cigarette Pants', 'Tapered Pants', 'Wide-Leg Trouser', 'Palazzo', 'Culottes', 'Bell Bottom', 'Bootcut Trouser', 'Flared Trouser', 'Gharara', 'Sharara', 'Dhoti Shalwar', 'Farsi Shalwar', 'Patiala Shalwar', 'Simple Shalwar', 'Churidar', 'Tulip Pants', 'Capri', 'Pants', 'Skinny Pants', 'Peshawari Shalwar', 'Punjabi Shalwar', 'Sindhi Shalwar', 'Balochi Shalwar'];

async function call(system, content, max = 1500) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: max, system, messages: [{ role: 'user', content }] }),
  });
  if (!r.ok) throw new Error('AI service error ' + r.status);
  const j = await r.json();
  return j.content.filter((c) => c.type === 'text').map((c) => c.text).join('');
}

// Finds each clothing item in a wardrobe photo and returns clean metadata.
async function scan(buf, mime) {
  const prompt =
    'You are cataloguing a woman\'s wardrobe from a photo. List every distinct clothing item, shoe, bag, scarf, ' +
    'jewellery piece or accessory you can clearly see. Reply with ONLY a JSON array. Each element: ' +
    '{"name": short descriptive name, "category": one of ' + CATS.join('|') + ', "color": hex like #D9A9A4, ' +
    '"occasion": one of ' + OCC.join('|') + ', "season": one of ' + SEASONS.join('|') + ', ' +
    '"style": for a shirt, kurta or dress the closest of ' + TOPS.join('|') + ' (else empty), ' +
    '"bottom": for trousers, shalwar or a skirt the closest of ' + BOTS.join('|') + ' (else empty)}. ' +
    'Kurta, kameez and lawn suits are Dresses. Dupattas are Scarves. Jeans and western tops are Western.';
  const text = await call('You output strict JSON only.', [
    { type: 'image', source: { type: 'base64', media_type: mime, data: buf.toString('base64') } },
    { type: 'text', text: prompt },
  ], 3000);
  const a = text.indexOf('['), b = text.lastIndexOf(']');
  if (a < 0 || b < a) throw new Error('Could not read the AI answer');
  const list = JSON.parse(text.slice(a, b + 1));
  return list.slice(0, 40).map((x) => ({
    name: String(x.name || 'Item').slice(0, 80),
    category: CATS.includes(x.category) ? x.category : 'Accessories',
    color: /^#[0-9a-fA-F]{6}$/.test(x.color) ? x.color : '#C9A98B',
    occasion: OCC.includes(x.occasion) ? x.occasion : 'Daily wear',
    season: SEASONS.includes(x.season) ? x.season : 'All seasons',
    style: TOPS.includes(x.style) ? x.style : null,
    bottom: BOTS.includes(x.bottom) ? x.bottom : null,
  }));
}

// Styling chat that knows the user's wardrobe and the weather.
async function chat(history, wardrobe, tone, weather) {
  const list = wardrobe.map((i) => `${i.category}: ${i.name}`).join('\n') || '(empty wardrobe)';
  const system =
    'You are Velora, a warm, fashion-conscious friend who helps a woman decide what to wear. ' +
    'Conversation style: ' + tone + '. Pakistani and Western fashion are both welcome. ' +
    'Use only items from her wardrobe when suggesting a look, and name them. Keep replies short and natural.\n' +
    'Weather: ' + (weather || 'unknown') + '\nHer wardrobe:\n' + list;
  const transcript = history.map((m) => (m.role === 'user' ? 'Her: ' : 'You: ') + m.text).join('\n');
  return (await call(system, transcript, 600)).trim();
}

module.exports = { configured: !!KEY, scan, chat, CATS };
