// A pretend Claude and OpenAI for the app tests. Every request is recognised by what it asks for (comment ideas, a photo
// scan, the day's story, a comic plan, post ideas, a photo design or redesign plan, style learning, a picture), answered
// from the test's answers or a sensible default, and kept, so a test can check exactly what the app asked and how often.
//
//   const ai = fakeAI({ comments: (call) => ['One', 'Two'], image: (call) => ({ error: 'Rate limit', status: 429 }) });
//   fixtures.routes = ai.routes.concat(...);   ...   ai.calls.filter((c) => c.kind === 'comments')
//
// An answer is a value or a function (call, n) → value, where n counts the calls of that kind (1, 2, …). Text kinds answer
// with JSON (an array or object) or a string; { error, status, code } answers with an API error; { delay } waits first.
// image answers default to a small real PNG; images in flight are counted (ai.maxImagesAtOnce).
'use strict';
const zlib = require('zlib');

const KINDS = [
  ['comments', /You write comments on a friend's Strava activity/],
  ['scan', /You look at the photos from one friend's Strava activity/],
  ['story', /You write one story in .* about a day in the lives of/],
  ['comicPlan', /writer and art director of a comic book/],
  ['post', /You write the title and the description for the user's own Strava activity/],
  ['overlay', /You design how a sports activity's statistics are drawn/],
  ['redesign', /You are the art director of a Strava post/],
  ['style', /You study how one person writes comments/],
];
const kindOf = (system) => (KINDS.find(([, rx]) => rx.test(system)) || ['other'])[0];

// a real PNG, w × h, one colour (enough for Image.fromData and for a browser to show it)
function png(w = 64, h = 96, rgb = [255, 120, 60]) {
  const row = Buffer.alloc(1 + w * 3); for (let x = 0; x < w; x++) row.set(rgb, 1 + x * 3);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const exactly = (system, def) => { const m = /exactly (\d+) (?:different )?(?:option|comment)/.exec(system); return m ? +m[1] : def; };
const DEFAULTS = {
  comments: (c) => Array.from({ length: exactly(c.system, 3) }, (_, i) => ['Strong finish on that last climb!', 'Early start, big reward 🌅', 'Those splits look smooth', 'Lovely route today', 'Legs of steel'][i % 5]),
  scan: () => ({ elements: [{ emoji: '🌲', label: 'forest' }, { emoji: '🌊', label: 'lake' }], details: ['a wooden jetty'], conditions: 'grey, calm' }),
  story: () => ({ title: 'A test day', paragraphs: [{ text: 'Everyone ran.', photos: [] }, { text: 'Then they rested.', photos: [] }] }),
  comicPlan: () => ({ characters: 'Sam: blue jacket', pages: [1, 2, 3].map((k) => ({ photos: [], people: ['Sam'], description: `Panel 1: page ${k}. Caption: "Page ${k}" Bubble (Sam): "Hello ${k}"` })) }),
  post: () => ({ titles: ['Sunset hills', 'Eight with a smile', 'Trail therapy', 'Hill whispers', 'Last warm Sunday'], descriptions: ['Easy hills at sunset.', 'Legs agreed with the plan for once.\nLast kilometre was the fastest.', 'Strava says fastest hills this month. I say it was the view.'] }),
  overlay: () => ({ position: 'bottom-left', layout: 'stack', font: 'condensed', stats: [{ label: 'DIST', value: '8.1 km' }, { label: 'PACE', value: '4:57 /km' }] }),
  redesign: () => ({ prompt: 'Repaint as a faded 1970s film photo.', headline: 'Morning Run', stats: [{ label: 'DIST', value: '8.1 km' }] }),
  style: () => 'Use short sentences.\nOne emoji at most.',
  other: () => '{}',
  image: () => ({ png: png() }),
};

function fakeAI(answers = {}) {
  const calls = [], count = {};
  let inFlight = 0, maxImages = 0;
  const pick = async (kind, call) => {
    count[kind] = (count[kind] || 0) + 1;
    const a = Object.prototype.hasOwnProperty.call(answers, kind) ? answers[kind] : DEFAULTS[kind];
    const v = typeof a === 'function' ? await a(call, count[kind]) : a;
    if (v && v.delay) await new Promise((r) => setTimeout(r, v.delay));
    return v;
  };
  const errorOf = (v) => ({ status: v.status || 400, json: { type: 'error', error: { type: v.code || 'invalid_request_error', code: v.code || 'invalid_request', message: v.error } } });
  const text = (v) => (typeof v === 'string' ? v : JSON.stringify(v));
  const chat = async (req, provider) => {
    const b = (req.json && req.json()) || {};
    let system = '', user = '', images = 0;
    if (provider === 'anthropic') {
      system = typeof b.system === 'string' ? b.system : JSON.stringify(b.system || '');
      const content = (b.messages || [])[0] && b.messages[0].content;
      user = typeof content === 'string' ? content : (content || []).filter((x) => x.type === 'text').map((x) => x.text).join('\n');
      images = Array.isArray(content) ? content.filter((x) => x.type === 'image').length : 0;
    } else {
      const sys = (b.messages || []).find((m) => m.role === 'system'), u = (b.messages || []).find((m) => m.role === 'user');
      system = sys ? String(sys.content) : ''; const content = u && u.content;
      user = typeof content === 'string' ? content : (content || []).filter((x) => x.type === 'text').map((x) => x.text).join('\n');
      images = Array.isArray(content) ? content.filter((x) => x.type === 'image_url').length : 0;
    }
    const call = { kind: kindOf(system), provider, model: b.model, system, user, images, at: Date.now() };
    calls.push(call);
    const v = await pick(call.kind, call);
    if (v && v.error) return errorOf(v);
    const out = text(v && v.text != null ? v.text : v);
    return provider === 'anthropic'
      ? { json: { id: 'msg_test', type: 'message', role: 'assistant', model: b.model, content: [{ type: 'text', text: out }], stop_reason: 'end_turn', usage: { input_tokens: 120, output_tokens: 60 } } }
      : { json: { id: 'chatcmpl_test', object: 'chat.completion', model: b.model, choices: [{ index: 0, message: { role: 'assistant', content: out }, finish_reason: 'stop' }], usage: { prompt_tokens: 120, completion_tokens: 60 } } };
  };
  const image = async (req) => {
    const edits = /\/images\/edits/.test(req.url), parts = req.multipart || [], b = edits ? {} : ((req.json && req.json()) || {});
    const field = (k) => { const p = parts.find((x) => x.name === k && !x.data); return p ? p.value : b[k]; };
    const call = { kind: 'image', provider: 'openai', endpoint: edits ? 'edits' : 'generations', model: field('model'), prompt: field('prompt') || '', size: field('size'), quality: field('quality'),
      fidelity: field('input_fidelity') || null, pictures: parts.filter((x) => x.data).map((x) => ({ name: x.name, filename: x.filename, contentType: x.contentType, bytes: x.data.length })), at: Date.now() };
    calls.push(call);
    inFlight++; maxImages = Math.max(maxImages, inFlight);
    try {
      const v = await pick('image', call);
      await new Promise((r) => setTimeout(r, (v && v.wait) || 150));   // so pictures drawn at once overlap
      if (v && v.error) return errorOf(v);
      return { json: { created: 1, data: [{ b64_json: ((v && v.png) || png()).toString('base64') }], usage: { input_tokens: 50, output_tokens: 4000 } } };
    } finally { inFlight--; }
  };
  const routes = [
    { match: 'api.anthropic.com/v1/messages', respond: (req) => chat(req, 'anthropic') },
    { match: 'api.openai.com/v1/chat/completions', respond: (req) => chat(req, 'openai') },
    { match: /api\.openai\.com\/v1\/images\/(edits|generations)/, respond: image },
    { match: 'api.openai.com/v1/models', respond: { json: { data: [{ id: 'gpt-5.4-mini', created: 1 }, { id: 'gpt-image-2', created: 3 }, { id: 'gpt-image-1', created: 2 }] } } },
  ];
  return {
    routes, calls,
    of: (kind) => calls.filter((c) => c.kind === kind),
    get maxImagesAtOnce() { return maxImages; },
  };
}

module.exports = { fakeAI, png, kindOf };
