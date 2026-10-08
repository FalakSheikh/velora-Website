'use strict';
// Photo-real virtual try-on. Sends the woman's own photo plus the chosen clothes to an image AI service.
// Works only when a key is set in .env. Written from the providers' public docs; test it with your own key.
const GEMINI = process.env.GEMINI_API_KEY, FAL = process.env.FAL_KEY;
const GEMINI_MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image';
const provider = GEMINI ? 'gemini' : FAL ? 'fal' : null;

const FIT = { small: 'neat and fitted', medium: 'true to size', large: 'comfortable and roomy' };
const PROMPT = (n, size) =>
  'The first image is a photo of a woman. ' + (n === 1 ? 'The second image shows a garment.' : `The next ${n} images show garments.`) +
  ' Create a realistic photograph of the same woman wearing ' + (n === 1 ? 'that garment' : 'all of those garments together') +
  '. Keep her face, hair, skin tone, body shape, pose and the background exactly the same. Only change her clothes. ' +
  'The clothes must fit naturally with realistic fabric drape, folds and shadows, and the full outfit should be visible. Do not add text or logos.' +
  (size ? ` She wears size ${size}, so the fit should look ${FIT[size]}.` : '');

const b64 = (img) => ({ inline_data: { mime_type: img.mime, data: img.buf.toString('base64') } });

async function viaGemini(person, garments, o) {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
    method: 'POST', headers: { 'x-goog-api-key': GEMINI, 'content-type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: PROMPT(garments.length, o && o.size) }, b64(person), ...garments.map(b64)] }] }),
  });
  if (!r.ok) throw new Error('Image service error ' + r.status);
  const j = await r.json();
  for (const p of (j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || []) {
    const d = p.inlineData || p.inline_data;
    if (d && d.data) return { buf: Buffer.from(d.data, 'base64'), mime: d.mimeType || d.mime_type || 'image/png' };
  }
  throw new Error('The image service did not return a picture');
}

async function viaFal(person, garments, o) {
  const uri = (i) => `data:${i.mime};base64,${i.buf.toString('base64')}`;
  const r = await fetch('https://fal.run/fal-ai/idm-vton', {
    method: 'POST', headers: { Authorization: 'Key ' + FAL, 'content-type': 'application/json' },
    body: JSON.stringify({ human_image_url: uri(person), garment_image_url: uri(garments[0]), description: 'a garment' }),
  });
  if (!r.ok) throw new Error('Image service error ' + r.status);
  const j = await r.json();
  const url = j.image && j.image.url;
  if (!url) throw new Error('The image service did not return a picture');
  const img = await fetch(url);
  if (!img.ok) throw new Error('Could not fetch the result');
  const mime = (img.headers.get('content-type') || 'image/png').split(';')[0];
  return { buf: Buffer.from(await img.arrayBuffer()), mime };
}

module.exports = { provider, run: (person, garments, o) => (provider === 'gemini' ? viaGemini : viaFal)(person, garments, o) };
