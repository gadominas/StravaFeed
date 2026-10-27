// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: deep-orange; icon-glyph: running;

/*
 * Strava Daily Digest (Scriptable)
 * ---------------------------------
 * Today's activities from the people you follow, grouped by athlete:
 * distance, pace, HR, PRs/achievements, photos, plus one-tap kudos and comments.
 *
 * How it works: the official Strava API does NOT expose the "following" feed and
 * does not allow giving kudos or posting comments. So this script uses your own
 * logged-in strava.com web session inside a hidden WebView (the same requests the
 * Strava website makes). Unofficial = it can break when Strava changes its site.
 *
 * First run: you'll be asked to log in to Strava once (email + password or email code).
 * Run with ?days=1 (URL scheme / Shortcuts) to see yesterday.
 */

const CONFIG = {
  DAYS_BACK: 0,            // day shown first: 0 = today, 1 = yesterday, ...
  DAYS_IN_PICKER: 2,       // days in the header: today and yesterday
  ATHLETE_ID: null,        // your id from strava.com/athletes/<ID>; set only if auto-detect fails
  INCLUDE_ME: false,       // include your own activities
  MAX_PAGES: 15,           // feed pages to scan for today (≈20 entries each)
  EXTRA_PAGES_PER_DAY: 10, // added for every day further back
  ENRICH_DETAILS: true,    // open each activity page to find HR / PRs / photos the feed omits
  ENRICH_CONCURRENCY: 4,
  AI: {                    // ✨ comment suggestions via the OpenAI API (your own key, stored in the iOS Keychain)
    MODEL: 'gpt-5.4-mini',
    REASONING: 'low',      // 'low' keeps it quick; raise for cleverer jokes
    LANGUAGES: [['EN', 'English'], ['LT', 'Lithuanian']],
    SUGGESTIONS: 3,
  },
  DEBUG_DUMP: false,       // save raw feed JSON to Scriptable/strava-feed-debug.json
  WIDGET_NAMES: true,      // show first names of people waiting for kudos on medium/large widgets
  CHECK_UPDATES: true,     // offer new versions from GitHub (asks again 2 days after "Later")
};

// This build's version. When releasing, bump it and add a matching entry to releases.json (see docs/RELEASING.md).
const VERSION = '1.6.0';
const REPO_RAW = 'https://raw.githubusercontent.com/gadominas/StravaFeed/main/';
const UPDATE_SNOOZE_MS = 2 * 24 * 3600 * 1000;

const STRAVA = 'https://www.strava.com';
const SCHEME = 'strava-digest://';

const qp = (args && args.queryParameters) || {};
if (qp.days) CONFIG.DAYS_BACK = parseInt(qp.days, 10) || 0;


// ───────────────────────────── main flow ─────────────────────────────

const KC_ATHLETE = 'strava-digest-athlete-id';
const KC_AI_KEY = 'strava-digest-openai-key';
const KC_AI_LANG = 'strava-digest-ai-lang';
const STATE = { aiLang: CONFIG.AI.LANGUAGES[0][1] };
const MARGIN = 3 * 3600 * 1000;      // read a bit past midnight: uploads and edits arrive late
const sleep = ms => new Promise(r => Timer.schedule(ms, false, r));

function dayBounds(daysBack) {
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  dayStart.setDate(dayStart.getDate() - daysBack);
  const dayEnd = new Date(dayStart); dayEnd.setDate(dayEnd.getDate() + 1);
  return { dayStart, dayEnd };
}

async function main() {
  const sv = new WebView();          // hidden: feed, kudos (sits on a tiny strava.com page)
  const sx = makeSx(sv);
  let ev = null, ex = null;          // hidden: activity details, so kudos never wait behind them
  const ui = new WebView();          // the digest you see

  if (Keychain.contains(KC_AI_LANG)) STATE.aiLang = Keychain.get(KC_AI_LANG);
  const maxBack = Math.max(0, CONFIG.DAYS_IN_PICKER - 1);
  let feed = null, daysBack = Math.min(maxBack, Math.max(0, CONFIG.DAYS_BACK)), viewToken = 0, closed = false;
  const details = new Map();         // activity id -> details found on its page (kept for the session)

  let viewing = false, savedScroll = 0;
  let pendingUpdate = null, updateChecked = false;
  // Show the update pitch over the digest (it is re-shown after day switches until answered).
  const offerUpdate = () => { if (pendingUpdate && !viewing && !closed) js(`window.__showUpdate && window.__showUpdate(${JSON.stringify(pendingUpdate)})`); };   // true while a Strava activity page is shown inside the digest
  ui.shouldAllowRequest = (req) => {
    const url = (req && req.url) || '';
    if (url.startsWith(SCHEME)) { handleAction(url).catch(e => console.error(e)); return false; }
    if (/^strava:/i.test(url)) return false;          // the Strava page trying to bounce to the app
    if (viewing && /strava\.com/.test(url)) [1500, 4000].forEach(ms => Timer.schedule(ms, false, addBackButton));
    return true;
  };

  // Floating "Back to digest" button on Strava's own page (sized for its desktop layout).
  function addBackButton() {
    if (!viewing) return;
    ui.evaluateJavaScript(`(function(){
      if (document.getElementById('sd-back') || !document.body) return;
      var k = Math.max(1, window.innerWidth / (screen.width || 390));
      var b = document.createElement('button');
      b.id = 'sd-back'; b.textContent = '‹ Back to digest';
      b.style.cssText = 'position:fixed;z-index:2147483647;left:50%;transform:translateX(-50%);border:0;border-radius:999px;background:#fc4c02;color:#fff;font-family:-apple-system,system-ui,sans-serif;font-weight:600;box-shadow:0 6px 20px rgba(0,0,0,.35)';
      b.style.bottom = (20 * k) + 'px'; b.style.fontSize = (17 * k) + 'px'; b.style.padding = (13 * k) + 'px ' + (24 * k) + 'px';
      b.onclick = function () { location.href = '${SCHEME}back'; };
      document.body.appendChild(b);
    })(); 'ok'`).catch(() => {});
  }

  async function viewHere(id) {
    viewing = true;
    try {
      await openStrava(ui, `/activities/${encodeURIComponent(id)}`);
      addBackButton();
    } catch (e) {
      console.warn('Strava page failed: ' + e);
      await showDay(false);
      await js(`window.scrollTo(0, ${savedScroll}); window.toast && toast(${JSON.stringify("Strava's page didn't open. The details view shows everything the digest has.")})`);
    }
  }
  const js = (code) => ui.evaluateJavaScript(`${code}; 'ok'`).catch(() => {});
  const status = (t) => js(`window.setStatus && window.setStatus(${JSON.stringify(t)})`);
  const count = (n) => js(`window.setCount && window.setCount(${+n || 0})`);

  // Show the window straight away; everything else loads behind it.
  await ui.loadHTML(bootScreen('Opening your feed'));
  const shown = ui.present(true);
  shown.then(() => { closed = true; });

  async function startSession() {
    await sv.loadURL(`${STRAVA}/robots.txt`);
    // Fast path: remembered athlete id + one feed request (also proves we're logged in).
    let me = CONFIG.ATHLETE_ID ? String(CONFIG.ATHLETE_ID) : (Keychain.contains(KC_ATHLETE) ? Keychain.get(KC_ATHLETE) : null);
    let first = me ? await firstPage(me) : null;
    if (first) return { me, first };

    status('Checking your Strava login');
    if (!(await authInfo(sx)).loggedIn) {
      await ui.loadHTML(page(`<div class="center"><h1>Log in to Strava</h1><p>Use email and password or the emailed code. Google sign-in usually doesn't work here.<br>The digest opens by itself once you're logged in.</p><br><button data-act="login">Log in to Strava</button></div>`));
      while (!closed && !(await authInfo(sx)).loggedIn) await sleep(2500);
      if (closed) return null;
      await ui.loadHTML(bootScreen('Logged in. Loading your feed'));
    }
    me = CONFIG.ATHLETE_ID ? String(CONFIG.ATHLETE_ID) : await sx('__SD.athleteId()');
    if (!me) throw new Error('Could not detect your athlete ID. Open your Strava profile, copy the number from strava.com/athletes/<ID>, and set CONFIG.ATHLETE_ID at the top of the script.');
    first = await firstPage(me);
    if (!first) throw new Error("You're logged in, but Strava's feed didn't answer. Tap Try again.");
    if (!CONFIG.ATHLETE_ID) Keychain.set(KC_ATHLETE, me);
    return { me, first };
  }

  async function firstPage(me) {
    try { return await sx(`__SD.page(${JSON.stringify(me)}, null, null, 0, 1e15, ${CONFIG.DEBUG_DUMP})`, 20000); }
    catch (e) { console.log('Feed request failed: ' + e.message); return null; }
  }

  // Load only what the chosen day needs, render it, then fill in details card by card.
  async function showDay(force, booting) {
    const token = ++viewToken;
    const { dayStart, dayEnd } = dayBounds(daysBack);
    try {
      if (force) await feed.restart(status);
      if (!feed.covers(+dayStart)) await feed.readBackTo(+dayStart, status, () => token !== viewToken, count);
      if (token !== viewToken || closed) return;
      const acts = feed.day(+dayStart, +dayEnd);
      acts.forEach(a => { if (details.has(a.id)) mergeDetails(a, details.get(a.id)); derive(a); });
      viewing = false;
      if (booting) { await status(`Ready: ${acts.length} ${acts.length === 1 ? 'activity' : 'activities'} to read`); await sleep(550); }
      await ui.loadHTML(renderDigest({ dayStart, daysBack, scan: feed.scan(), people: groupByAthlete(acts), count: acts.length }));
      saveSnapshot(feed);
      offerUpdate();
      enrich(acts, token, +dayStart, +dayEnd).catch(e => console.warn('Details: ' + e));
    } catch (e) {
      if (token !== viewToken) return;
      await ui.loadHTML(page(`${appHeader(daysBack, 0, 0)}<div class="center">${esc(e.message || e)}<br><br><button class="ghost" data-act="refresh">Try again</button></div>`));
    }
  }

  async function enrich(acts, token, dayStart, dayEnd) {
    if (!CONFIG.ENRICH_DETAILS) return;
    const todo = acts.filter(a => !details.has(a.id)).map(a => a.id);
    if (!todo.length) return;
    if (!ev) { ev = new WebView(); await ev.loadURL(`${STRAVA}/robots.txt`); ex = makeSx(ev); }
    for (let i = 0; i < todo.length; i += CONFIG.ENRICH_CONCURRENCY) {
      if (token !== viewToken || closed) return;
      const chunk = todo.slice(i, i + CONFIG.ENRICH_CONCURRENCY);
      let det = {};
      try { det = await ex(`__SD.enrich(${JSON.stringify(chunk)}, ${chunk.length})`, 30000); } catch (e) { console.warn(e.message); }
      chunk.forEach(id => details.set(id, det[id] || {}));
      if (token !== viewToken || closed) return;
      const touched = new Set();
      chunk.forEach(id => { const a = feed.get(id); if (a) { mergeDetails(a, details.get(id)); derive(a); touched.add(personKey(a)); } });
      const dayActs = feed.day(dayStart, dayEnd), people = groupByAthlete(dayActs);
      for (const p of people) if (touched.has(p.id)) await js(`window.__patchPerson(${JSON.stringify(p.id)}, ${JSON.stringify(personHtml(p))})`);
      await js(`window.__patchSummary(${JSON.stringify(summaryText(people, dayActs.length))})`);
    }
  }

  async function handleAction(url) {
    const [rawHead, qs = ''] = url.slice(SCHEME.length).split('?');
    const head = rawHead.replace(/\/$/, '');
    const p = {};
    qs.split('&').forEach(kv => {
      if (!kv) return;
      const i = kv.indexOf('=');
      if (i < 0) p[kv] = ''; else p[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1));
    });
    if (head === 'login') { await openStrava(ui, '/login'); return; }
    if (head === 'update-later') {
      Keychain.set(KC_UPDATE_SNOOZE, String(Date.now() + UPDATE_SNOOZE_MS)); pendingUpdate = null; return;
    }
    if (head === 'update-now') {
      let ok = false, msg = '';
      try { msg = await applyUpdate(pendingUpdate); ok = true; pendingUpdate = null; if (Keychain.contains(KC_UPDATE_SNOOZE)) Keychain.remove(KC_UPDATE_SNOOZE); }
      catch (e) { msg = String(e.message || e); }
      await js(`window.__done(${JSON.stringify(p.req)}, ${ok}, ${JSON.stringify(msg)})`);
      return;
    }
    if (head === 'view') { savedScroll = +p.y || 0; await viewHere(p.id); return; }
    if (head === 'back') {
      if (!feed) return;
      await showDay(false);
      await js(`window.scrollTo(0, ${savedScroll})`);
      return;
    }
    if (head === 'setlang') { STATE.aiLang = p.lang; Keychain.set(KC_AI_LANG, p.lang); return; }
    if (head === 'retry') { await boot(); return; }
    if (!feed) return;
    if (head === 'refresh') { await showDay(true); return; }
    if (head === 'day') { daysBack = Math.min(maxBack, Math.max(0, parseInt(p.back, 10) || 0)); await showDay(false); return; }
    let ok = false, msg = '';
    try {
      if (head === 'kudo') {
        const r = await sx(`__SD.kudo(${JSON.stringify(p.id)})`, 20000); ok = !!r.ok; msg = r.error || '';
        if (ok) { feed.update(p.id, a => { a.hasKudoed = true; a.kudos++; }); saveSnapshot(feed); }
      } else if (head === 'comment') {
        const r = await postComment(sx, String(p.id), String(p.text || ''));
        ok = !!r.ok; msg = r.error || '';
        if (r.via) console.log('Comment sent via ' + r.via);
        if (ok) feed.update(p.id, a => { a.comments++; });
      } else if (head === 'setkey') {
        const key = String(p.key || '').trim();
        if (!/^sk-/.test(key)) msg = 'That does not look like an OpenAI key (it starts with sk-).';
        else { Keychain.set(KC_AI_KEY, key); ok = true; }
      } else if (head === 'suggest') {
        const a = feed.get(p.id);
        if (!a) msg = 'Activity not found.';
        else {
          const r = await aiSuggest(a, p.lang || STATE.aiLang, p.hint || '');
          if (r.needKey) msg = 'NEED_KEY';
          else { ok = true; msg = JSON.stringify(r.comments); }
        }
      } else if (head === 'activity') {
        Safari.open(`strava://activities/${p.id}`);
        ok = true;
      } else if (head === 'athlete') {
        Safari.open(`strava://athletes/${p.id}`);
        ok = true;
      } else if (head === 'open') {
        Safari.open(p.url); ok = true;
      }
    } catch (e) { msg = String(e.message || e); }
    await js(`window.__done(${JSON.stringify(p.req)}, ${ok}, ${JSON.stringify(msg)})`);
  }

  async function boot() {
    try {
      const session = await startSession();
      if (!session) return;
      feed = makeFeed(sx, session.me, session.first);
      if (!updateChecked) { updateChecked = true; checkForUpdate().then(u => { pendingUpdate = u; offerUpdate(); }); }
      await count(feed.scan().entries);
      await showDay(false, true);
    } catch (e) {
      await ui.loadHTML(page(`<div class="center">${esc(e.message || e)}<br><br><button class="ghost" data-act="retry">Try again</button></div>`));
    }
  }

  await boot();
  await shown;
}

// ─────────────── ✨ comment suggestions (OpenAI Responses API) ───────────────

function activityFacts(a) {
  const first = String(a.athleteName || '').split(/\s+/)[0];
  return {
    friend_first_name: first,
    activity_title: a.name,
    sport: a.type,
    date: a.ts ? new Date(a.ts).toISOString().slice(0, 10) : null,
    start_time_local: a.clock ? fmtClock(a.clock) : null,
    early_start_club: early(a) ? early(a).label : null,
    location: a.location || null,
    stats: Object.fromEntries(a.stats.map(s => [s.label, s.value])),
    heart_rate: a.hr || null,
    personal_records: a.ach.prs || 0,
    achievements: a.ach.total || 0,
    achievement_details: a.ach.list.filter(x => x.name).slice(0, 5).map(x => [x.type, x.name].filter(Boolean).join(': ')),
    description: a.description ? a.description.slice(0, 400) : null,
    photos: a.photos.length,
    kudos_so_far: a.kudos,
  };
}

async function aiSuggest(a, language, hint) {
  if (!Keychain.contains(KC_AI_KEY)) return { needKey: true };
  const n = CONFIG.AI.SUGGESTIONS;
  const instructions = [
    `You write Strava comments for a friend's workout. Write ${n} different options in ${language}.`,
    'Each one: a single short sentence (max ~18 words), funny and warm, like a teammate teasing with affection.',
    'Build the joke on the real details: distance, pace, time, elevation, heart rate, PRs, early start, title, weather in the description.',
    'Vary the angle between options (one about a number, one about the title or time of day, one hype).',
    'At most one emoji each. No hashtags. Never mock body, weight, age, or looks. Never invent stats that are not given.',
    `Address the friend by first name in at most one option.${hint ? ` The user's own draft idea, keep its spirit: "${hint}".` : ''}`,
  ].join(' ');
  const req = new Request('https://api.openai.com/v1/responses');
  req.method = 'POST';
  req.timeoutInterval = 45;
  req.headers = { 'Authorization': `Bearer ${Keychain.get(KC_AI_KEY)}`, 'Content-Type': 'application/json' };
  req.body = JSON.stringify({
    model: CONFIG.AI.MODEL,
    instructions,
    input: JSON.stringify(activityFacts(a)),
    reasoning: { effort: CONFIG.AI.REASONING },
    text: { format: { type: 'json_schema', name: 'strava_comments', strict: true, schema: {
      type: 'object', additionalProperties: false, required: ['comments'],
      properties: { comments: { type: 'array', items: { type: 'string' } } },
    } } },
  });
  const res = await req.loadJSON();
  const code = req.response && req.response.statusCode;
  if (code === 401) { Keychain.remove(KC_AI_KEY); return { needKey: true }; }
  if (code >= 400 || !res) throw new Error((res && res.error && res.error.message) || `OpenAI answered HTTP ${code}`);
  let text = res.output_text || '';
  if (!text && Array.isArray(res.output)) {
    text = res.output.flatMap(o => o.content || []).filter(c => c.type === 'output_text').map(c => c.text).join('');
  }
  let comments = [];
  try { comments = JSON.parse(text).comments || []; }
  catch (e) { comments = text.split(/\n+/).map(l => l.replace(/^[-*\d.)\s"]+|"$/g, '').trim()).filter(Boolean); }
  comments = comments.map(c => String(c).trim()).filter(Boolean).slice(0, n);
  if (!comments.length) throw new Error('No suggestions came back. Try again.');
  return { comments };
}

// Everything read from the feed so far, newest first. Older days continue from where the last read stopped.
function makeFeed(sx, me, first) {
  let st;
  const reset = () => { st = { items: new Map(), next: null, position: null, oldest: null, done: false, stop: '', pages: 0, entries: 0, seenFirst: new Set(), raws: [] }; };
  const absorb = (r) => {
    st.pages++; st.entries += r.entryCount || 0;
    if (r.raw) st.raws.push(r.raw);
    if (r.firstId != null && st.seenFirst.has(r.firstId)) { st.done = true; st.stop = 'Strava returned the same page again'; return; }
    if (r.firstId != null) st.seenFirst.add(r.firstId);
    for (const a of r.items) {
      if (!a.id || a.id === 'undefined') continue;
      if (!CONFIG.INCLUDE_ME && a.athleteId === me) continue;
      derive(a);
      st.items.set(a.id, a);
      if (a.ts && (st.oldest == null || a.ts < st.oldest)) st.oldest = a.ts;
    }
    if (r.next && !isNaN(+r.next.before)) { const b = +r.next.before; st.position = b > 1e12 ? b : b * 1000; }
    st.next = r.next || null;
    if (!st.next) { st.done = true; st.stop = 'Strava has no older pages'; }
  };
  reset(); absorb(first);

  return {
    covers: (dayStart) => st.done || (st.position != null && st.position < dayStart - MARGIN),
    async readBackTo(dayStart, status, cancelled, onCount) {
      const limit = st.pages + CONFIG.MAX_PAGES + CONFIG.EXTRA_PAGES_PER_DAY * 3;
      while (!this.covers(dayStart) && st.pages < limit) {
        if (cancelled()) return;
        await status(`Reading feed${st.position ? `, back to ${dayLabel(st.position)}` : ''}`);
        const r = await sx(`__SD.page(${JSON.stringify(me)}, ${JSON.stringify(st.next.before)}, ${JSON.stringify(st.next.cursor)}, 0, 1e15, ${CONFIG.DEBUG_DUMP})`, 20000);
        absorb(r);
        if (onCount) await onCount(st.entries);
      }
      if (!this.covers(dayStart)) st.stop = 'page limit reached';
      if (CONFIG.DEBUG_DUMP) dump(st.raws);
    },
    async restart(status) {
      await status('Refreshing');
      const r = await sx(`__SD.page(${JSON.stringify(me)}, null, null, 0, 1e15, ${CONFIG.DEBUG_DUMP})`, 20000);
      reset(); absorb(r);
    },
    day: (from, to) => [...st.items.values()].filter(a => a.ts != null && a.ts >= from && a.ts < to),
    get: (id) => st.items.get(id),
    update: (id, fn) => { const a = st.items.get(id); if (a) fn(a); },
    scan: () => ({ pages: st.pages, entries: st.entries, position: st.position, oldest: st.oldest, stop: st.stop || 'reached the day before' }),
  };
}

// ─────────────── updates ───────────────
// releases.json on GitHub is the source of truth: newest release first, each with exactly
// three "highlights" (icon, title, text) used for the update pitch, plus full change lists.

const KC_UPDATE_SNOOZE = 'strava-digest-update-snooze';

function cmpVer(a, b) {
  const pa = String(a).split('.').map(n => parseInt(n, 10) || 0), pb = String(b).split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d > 0 ? 1 : -1; }
  return 0;
}

function updateSnoozed() {
  try { return Keychain.contains(KC_UPDATE_SNOOZE) && Date.now() < +Keychain.get(KC_UPDATE_SNOOZE); } catch (e) { return false; }
}

async function checkForUpdate() {
  if (!CONFIG.CHECK_UPDATES || updateSnoozed()) return null;
  try {
    const req = new Request(`${REPO_RAW}releases.json?t=${Date.now()}`);
    req.timeoutInterval = 10;
    const data = await req.loadJSON();
    if (!data || !Array.isArray(data.releases)) return null;
    const newer = data.releases.filter(r => r && r.version && cmpVer(r.version, VERSION) > 0)
      .sort((x, y) => cmpVer(y.version, x.version));
    if (!newer.length) return null;
    // Pitch: the newest release's highlights first, topped up from any other versions the user skipped.
    const highlights = [];
    newer.forEach(r => (r.highlights || []).forEach(h => { if (highlights.length < 3 && h && h.title) highlights.push(h); }));
    return {
      current: VERSION, latest: newer[0].version, title: newer[0].title || '', date: newer[0].date || '',
      skipped: newer.length, highlights, script: data.script || 'Strava Daily Digest.js',
    };
  } catch (e) { console.log('Update check skipped: ' + e); return null; }
}

async function applyUpdate(info) {
  const req = new Request(`${REPO_RAW}${encodeURI(info.script)}?t=${Date.now()}`);
  req.timeoutInterval = 30;
  const code = await req.loadString();
  const code200 = req.response && req.response.statusCode === 200;
  const m = code && code.match(/const VERSION = '([^']+)'/);
  if (!code200 || !code.includes('function stravaLib') || !m) throw new Error("The download didn't look right. Try again later.");
  if (cmpVer(m[1], VERSION) <= 0) throw new Error('GitHub is still serving the old version. Try again in a few minutes.');
  const path = module.filename;
  let fm = FileManager.local();
  try { const ic = FileManager.iCloud(); if (path.startsWith(ic.documentsDirectory())) fm = ic; } catch (e) {}
  fm.writeString(path, code);
  return m[1];
}

// ─────────────── posting comments ───────────────
// Fast path: replay the exact request Strava's own page used last time (learned once, kept in the Keychain).
// Fallback: open the activity page in a throw-away hidden view, type into Strava's comment box, then free it.

const KC_COMMENT_TPL = 'strava-digest-comment-request';

function learnCommentRequest(req, id, text) {
  if (!req || !req.url || !req.body || text.length < 6) return;
  const forms = [['json', JSON.stringify(text).slice(1, -1)], ['plus', encodeURIComponent(text).replace(/%20/g, '+')], ['form', encodeURIComponent(text)], ['raw', text]];
  for (const [enc, v] of forms) {
    if (!req.body.includes(v)) continue;
    // Mark the security token, the comment text and the activity id; keep everything else exactly as Strava sent it.
    let body = req.body.replace(/(authenticity_token=)[^&]*/, '$1{{CSRF}}').split(v).join('{{TEXT}}');
    const sub = str => str.replace(new RegExp(`(^|[^0-9])${id}(?![0-9])`, 'g'), '$1{{ID}}');
    const tpl = { method: req.method || 'POST', enc, ct: req.ct || '', url: sub(String(req.url)), body: sub(body) };
    if (!tpl.url.includes('{{ID}}') && !tpl.body.includes('{{ID}}')) return;   // can't tell which activity it targets
    Keychain.set(KC_COMMENT_TPL, JSON.stringify(tpl));
    console.log('Learned Strava comment request: ' + tpl.method + ' ' + tpl.url);
    return;
  }
}

async function postComment(sx, id, text) {
  if (Keychain.contains(KC_COMMENT_TPL)) {
    try {
      const tpl = JSON.parse(Keychain.get(KC_COMMENT_TPL));
      const r = await sx(`__SD.commentDirect(${JSON.stringify(tpl)}, ${JSON.stringify(id)}, ${JSON.stringify(text)})`, 20000);
      if (r.ok || !r.definite) return r;                 // posted, or unclear: never risk a double post
      Keychain.remove(KC_COMMENT_TPL);                    // Strava changed something: relearn below
    } catch (e) { return { ok: false, error: e.message }; }
  }
  let cv = new WebView();
  cv.shouldAllowRequest = req => /^(https?:|about:)/i.test((req && req.url) || '');   // never hand off to the Strava app
  try {
    const cx = makeSx(cv);
    await openStrava(cv, `/activities/${encodeURIComponent(id)}`);
    const r = await cx(`__SD.commentViaUI(${JSON.stringify(text)})`, 30000);
    if (r.ok && r.req) learnCommentRequest(r.req, id, text);
    return r;
  } finally {
    try { await cv.loadHTML('<html></html>'); } catch (e) {}  // drop Strava's heavy page right away
    cv = null;
  }
}

// Strava pushes iPhone browsers to the app; a desktop user agent gets the full website.
const DESKTOP_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';

async function openStrava(wv, path) {
  try {
    const req = new Request(STRAVA + path);
    req.headers = { 'User-Agent': DESKTOP_UA };
    await wv.loadRequest(req);
  } catch (e) {
    await wv.loadURL(STRAVA + path);
  }
}

async function authInfo(sx) {
  try { return await sx('__SD.auth()', 20000); }
  catch (e) { return { loggedIn: false, error: String(e.message || e) }; }
}

// ──────────────────────── data shaping (native) ────────────────────────

const RX = { dist: /dist|atstum/i, time: /time|laik/i, pace: /pace|tempas/i, speed: /speed|greit/i, hr: /heart|bpm|pulsas|\bhr\b/i };

function mergeDetails(a, d) {
  if (!d || d.error) return;
  const real = c => c && !(c.h === 0 && c.m === 0);
  if (!real(a.clock)) a.clock = null;
  if (real(d.clock) && (!a.clock || d.clock.src > a.clock.src)) a.clock = d.clock;
  if (!a.hr && d.hr) a.hr = `${d.hr} bpm` + (d.maxHr ? `, max ${d.maxHr}` : '');
  if (d.prs != null) a.ach.prs = Math.max(a.ach.prs || 0, d.prs);
  if (d.achievements != null) a.ach.total = Math.max(a.ach.total || 0, d.achievements);
  if (d.list && d.list.length && !a.ach.list.length) a.ach.list = d.list;
  if (!a.map && d.map) a.map = d.map;
  if (d.photos && d.photos.length) {
    const byKey = new Map();
    [...a.photos, ...d.photos].forEach(u => { const k = photoKey(u); if (!byKey.has(k)) byKey.set(k, u); });
    a.photos = [...byKey.values()].slice(0, 12);
  }
}

function derive(a) {
  if (a.clock && a.clock.h === 0 && a.clock.m === 0) a.clock = null;
  const get = rx => (a.stats.find(s => rx.test(s.label)) || {}).value;
  a.km = parseDist(get(RX.dist));
  const time = get(RX.time);
  if (!get(RX.pace) && !get(RX.speed) && a.km && time) {
    const sec = parseDur(time);
    if (sec) a.stats.push(/run|walk|hike/i.test(a.type)
      ? { label: 'Pace', value: `${fmtPace(sec / a.km.value)} /${a.km.unit}` }
      : { label: 'Speed', value: `${(a.km.value / (sec / 3600)).toFixed(1)} ${a.km.unit}/h` });
  }
  if (a.hr && a.stats.some(s => RX.hr.test(s.label + ' ' + s.value))) a.hrInStats = true;
}

// Early-start badges, keyed by the hour the activity started (athlete's local time).
const EARLY = {
  4: { icon: '🦉', label: '4 AM club', cls: 'e4' },
  5: { icon: '🌙', label: '5 AM club', cls: 'e5' },
  6: { icon: '🌅', label: '6 AM club', cls: 'e6' },
};
const early = a => (a.clock ? EARLY[a.clock.h] : null) || null;
const fmtClock = c => `${String(c.h).padStart(2, '0')}:${String(c.m).padStart(2, '0')}`;

const personKey = a => a.athleteId || a.athleteName || 'unknown';

function groupByAthlete(acts) {
  const map = new Map();
  for (const a of acts) {
    const k = personKey(a);
    if (!map.has(k)) map.set(k, { id: k, name: a.athleteName || 'Unknown athlete', avatar: a.avatar, acts: [] });
    const p = map.get(k); p.acts.push(a);
    if (!p.avatar && a.avatar) p.avatar = a.avatar;
  }
  const score = a => (early(a) ? 500 : 0) + (a.ach.prs || 0) * 1000 + (a.ach.total || 0) * 10 + (a.km ? a.km.value : 0) + a.photos.length * 0.5;
  const people = [...map.values()];
  for (const p of people) {
    p.acts.sort((x, y) => (x.start || 0) - (y.start || 0));
    p.primary = p.acts.find(a => a.hasKudoed) || [...p.acts].sort((x, y) => score(y) - score(x))[0];
    p.kudoed = p.acts.some(a => a.hasKudoed);
    p.early = p.acts.map(early).filter(Boolean).sort((x, y) => x.cls.localeCompare(y.cls))[0] || null;
    p.latest = Math.max(...p.acts.map(a => a.start || 0));
    const units = new Set(p.acts.filter(a => a.km).map(a => a.km.unit));
    if (units.size === 1) {
      const sum = p.acts.reduce((n, a) => n + (a.km ? a.km.value : 0), 0);
      if (sum >= 0.05) p.total = `${sum.toFixed(1)} ${[...units][0]}`;
    }
  }
  // People still waiting for your kudos first, then newest activity first within each group.
  people.sort((a, b) => (a.kudoed - b.kudoed) || (b.latest - a.latest));
  return people;
}

function parseDist(s) {
  if (!s) return null;
  let t = String(s).replace(/(\d)[,\u00a0\u202f ](?=\d{3}\b)/g, '$1');   // thousands separators: 2,100 m / 2 100 m
  t = t.replace(/(\d),(\d)/, '$1.$2');                                     // decimal comma: 10,02 km
  const m = t.match(/([\d.]+)\s*(km|mi|m)\b/i);
  if (!m) return null;
  let v = +m[1], u = m[2].toLowerCase();
  if (u === 'm') { v /= 1000; u = 'km'; }
  return v > 0 ? { value: v, unit: u } : null;
}

function parseDur(s) {
  s = String(s || '').trim();
  const m = s.match(/^(\d+):(\d{2})(?::(\d{2}))?$/);
  if (m) return m[3] != null ? +m[1] * 3600 + +m[2] * 60 + +m[3] : +m[1] * 60 + +m[2];
  let t = 0, hit = false;
  s.replace(/(\d+)\s*(h|min|m|s)\b/gi, (_, n, u) => { hit = true; u = u.toLowerCase(); t += +n * (u === 'h' ? 3600 : u === 's' ? 1 : 60); });
  return hit ? t : null;
}

function fmtPace(sec) { sec = Math.round(sec); return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`; }
function photoKey(u) { return String(u).replace(/-\d+x\d+(?=\.\w+)/, '').replace(/\?.*$/, ''); }

// ─────────────── home-screen widget: today's "waiting for kudos" summary ───────────────
// Widgets can't use your Strava login, so the digest saves a small summary every time it loads
// today (and after each kudos); the widget shows that summary.

const SNAPSHOT_FILE = 'strava-digest-widget.json';
const dayKey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function snapshotFm() {
  try { return FileManager.iCloud(); } catch (e) { return FileManager.local(); }
}

function saveSnapshot(feed) {
  try {
    const { dayStart, dayEnd } = dayBounds(0);
    if (!feed.covers(+dayStart)) return;                 // today not fully read yet
    const acts = feed.day(+dayStart, +dayEnd);
    const people = groupByAthlete(acts);
    const waiting = people.filter(p => !p.kudoed);
    const snap = {
      date: dayKey(dayStart), updated: Date.now(),
      waiting: waiting.length, people: people.length, activities: acts.length,
      prs: acts.reduce((n, a) => n + (a.ach.prs || 0), 0),
      early: people.filter(p => p.early).length,
      list: waiting.slice(0, 10).map(p => ({
        name: String(p.name || '').split(/\s+/)[0], icon: emoji(p.primary.type),
        early: p.early ? p.early.icon : '', n: p.acts.length,
      })),
    };
    const fm = snapshotFm();
    fm.writeString(fm.joinPath(fm.documentsDirectory(), SNAPSHOT_FILE), JSON.stringify(snap));
  } catch (e) { console.warn('Widget summary not saved: ' + e); }
}

async function readSnapshot() {
  try {
    const fm = snapshotFm();
    const path = fm.joinPath(fm.documentsDirectory(), SNAPSHOT_FILE);
    if (!fm.fileExists(path)) return null;
    if (fm.isFileStoredIniCloud && fm.isFileStoredIniCloud(path) && !fm.isFileDownloaded(path)) await fm.downloadFileFromiCloud(path);
    return JSON.parse(fm.readString(path));
  } catch (e) { return null; }
}

// Rounded widget fonts, falling back to the plain system font on older Scriptable versions.
function wFont(weight, size) {
  const name = { bold: 'boldRoundedSystemFont', semi: 'semiboldRoundedSystemFont' }[weight] || 'regularRoundedSystemFont';
  if (typeof Font[name] === 'function') return Font[name](size);
  return weight === 'bold' ? Font.boldSystemFont(size) : weight === 'semi' ? Font.semiboldSystemFont(size) : Font.systemFont(size);
}

async function renderWidget() {
  const fam = config.widgetFamily || 'small';
  const snap = await readSnapshot();
  const fresh = !!snap && snap.date === dayKey(new Date());
  const tf = new DateFormatter(); tf.dateFormat = 'HH:mm';
  const updated = snap ? tf.string(new Date(snap.updated)) : '';
  const w = new ListWidget();
  w.url = URLScheme.forRunningScript();
  w.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);

  const txt = (stack, s, size, weight, opacity = 1, color = Color.white()) => {
    const t = stack.addText(s);
    t.font = wFont(weight, size);
    t.textColor = color; t.textOpacity = opacity; t.lineLimit = 1; t.minimumScaleFactor = 0.6;
    return t;
  };
  const num = fresh ? String(snap.waiting) : '–';

  // Lock Screen widgets
  if (fam === 'accessoryInline') { w.addText(fresh ? `👍 ${snap.waiting} waiting for kudos` : '👍 Open to load today'); Script.setWidget(w); return; }
  if (fam === 'accessoryCircular') {
    w.addAccessoryWidgetBackground = true;
    const c = w.addStack(); c.layoutVertically(); c.centerAlignContent();
    const a = c.addText('👍'); a.font = Font.systemFont(11); a.centerAlignText();
    const b = c.addText(num); b.font = wFont('bold', 22); b.centerAlignText(); b.minimumScaleFactor = 0.5;
    Script.setWidget(w); return;
  }
  if (fam === 'accessoryRectangular') {
    const a = w.addText(fresh ? `👍 ${snap.waiting} waiting` : '👍 Strava digest'); a.font = wFont('bold', 15);
    const b = w.addText(fresh ? `for your kudos, of ${snap.people} today` : 'Open to load today'); b.font = wFont('reg', 12);
    const c = w.addText(fresh ? `Updated ${updated}` : ''); c.font = wFont('reg', 11); c.textOpacity = 0.7;
    Script.setWidget(w); return;
  }

  // Home Screen widgets
  const g = new LinearGradient();
  g.colors = [new Color('#fc5c1a'), new Color('#c43c00')]; g.locations = [0, 1];
  g.startPoint = new Point(0, 0); g.endPoint = new Point(1, 1);
  w.backgroundGradient = g;
  w.setPadding(14, 14, 14, 14);

  const row = w.addStack(); row.layoutHorizontally(); row.topAlignContent();
  const left = row.addStack(); left.layoutVertically();
  txt(left, '👍 Kudos', 12, 'semi', 0.9);
  left.addSpacer();
  txt(left, num, fam === 'small' ? 46 : 52, 'bold');
  if (!fresh) txt(left, snap ? 'Tap to load today' : 'Tap to open', 13, 'semi');
  else if (snap.waiting === 0) txt(left, snap.people ? 'All caught up 🎉' : 'Nobody posted yet', 13, 'semi');
  else txt(left, snap.waiting === 1 ? 'person waiting' : 'people waiting', 13, 'semi');
  txt(left, fresh ? `of ${snap.people} today, ${updated}` : (snap ? `last check ${updated}` : ''), 11, 'reg', 0.8);

  if (fam !== 'small' && fresh) {
    row.addSpacer(14);
    const right = row.addStack(); right.layoutVertically();
    const max = fam === 'large' ? 9 : 4;
    const names = CONFIG.WIDGET_NAMES ? snap.list : [];
    if (!names.length) {
      txt(right, snap.waiting ? 'Open the digest' : 'Nothing waiting', 13, 'semi', 0.9);
      txt(right, snap.waiting ? 'to give kudos' : 'Enjoy your day', 12, 'reg', 0.8);
    }
    names.slice(0, max).forEach(p => {
      txt(right, `${p.icon} ${p.name}${p.early ? ' ' + p.early : ''}${p.n > 1 ? ` ×${p.n}` : ''}`, 14, 'semi');
      right.addSpacer(3);
    });
    if (names.length && snap.waiting > Math.min(max, names.length)) txt(right, `+${snap.waiting - Math.min(max, names.length)} more`, 12, 'reg', 0.8);
    right.addSpacer();
    if (fam === 'large') {
      const extra = [snap.prs ? `🏆 ${snap.prs} PR${snap.prs > 1 ? 's' : ''}` : '', snap.early ? `🌅 ${snap.early} early riser${snap.early > 1 ? 's' : ''}` : '', `${snap.activities} activities`].filter(Boolean).join('   ');
      txt(right, extra, 12, 'reg', 0.85);
    }
    row.addSpacer();
  }
  Script.setWidget(w);
}

// Optional: run with ?refresh=1 (or the Shortcuts parameter "refresh") to update the widget
// summary without showing the digest, e.g. from a Shortcuts automation that runs Scriptable in-app.
async function refreshOnly() {
  const sv = new WebView(); const sx = makeSx(sv);
  await sv.loadURL(`${STRAVA}/robots.txt`);
  const me = CONFIG.ATHLETE_ID ? String(CONFIG.ATHLETE_ID) : (Keychain.contains(KC_ATHLETE) ? Keychain.get(KC_ATHLETE) : null);
  if (!me) throw new Error('Open the digest once first so it can log in.');
  const first = await sx(`__SD.page(${JSON.stringify(me)}, null, null, 0, 1e15, false)`, 20000);
  const feed = makeFeed(sx, me, first);
  await feed.readBackTo(+dayBounds(0).dayStart, async () => {}, () => false);
  saveSnapshot(feed);
}

function dump(raws) {
  try {
    let fm; try { fm = FileManager.iCloud(); } catch (e) { fm = FileManager.local(); }
    const path = fm.joinPath(fm.documentsDirectory(), 'strava-feed-debug.json');
    fm.writeString(path, JSON.stringify(raws, null, 2));
    console.log('Raw feed saved to ' + path);
  } catch (e) { console.warn('Dump failed: ' + e); }
}

// ───────────────── bridge to the strava.com session ─────────────────

function makeSx(sv) {
  let chain = Promise.resolve();
  const run = async (expr) => {
    const js = `(${stravaLib.toString()})();
(async () => {
  try { const r = await (${expr}); completion(JSON.stringify(r === undefined ? null : r)); }
  catch (e) { completion(JSON.stringify({ __error: String((e && e.message) || e) })); }
})();
'pending';`; // last value must be a plain string: WebKit can't return a Promise to Scriptable
    const raw = await sv.evaluateJavaScript(js, true);
    const res = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (res && res.__error) throw new Error(res.__error);
    return res;
  };
  const withTimeout = (p, ms) => !ms ? p : Promise.race([p, new Promise((_, rej) =>
    Timer.schedule(ms, false, () => rej(new Error('Strava took too long to respond. Check the activity in Strava before trying again.'))))]);
  // serialize calls so concurrent taps never share one callback
  return (expr, ms) => { const p = chain.then(() => withTimeout(run(expr), ms)); chain = p.catch(() => {}); return p; };
}

// Injected into strava.com. Must be self-contained (no outer variables).
function stravaLib() {
  if (window.__SD) return;
  const SD = {};
  const XHR = { 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json, text/javascript, */*; q=0.01' };

  SD.state = () => ({ path: location.pathname, csrf: !!document.querySelector('meta[name="csrf-token"]') });

  // Pages that need a login; logged-out requests get redirected to /login.
  SD.PROBES = ['/settings/profile', '/dashboard', '/athlete/training'];

  SD.get = async (path) => {
    const r = await fetch(path, { credentials: 'include', headers: { 'Accept': 'text/html' } });
    return { url: r.url, status: r.status, html: await r.text() };
  };

  SD.auth = async () => {
    const info = { page: location.pathname, title: document.title.slice(0, 60), loggedIn: false, probes: [] };
    for (const p of SD.PROBES) {
      try {
        const r = await SD.get(p);
        const toLogin = /\/(login|session|register|signup)/i.test(r.url);
        info.probes.push(`${p} → ${r.status} ${r.url.replace(/^https:\/\/www\.strava\.com/, '')}`);
        if (r.status === 200 && !toLogin) {
          info.loggedIn = true;
          const id = r.html.match(/href="\/athletes\/(\d+)"/);
          if (id) info.athleteGuess = id[1];
          SD._html = r.html;
          break;
        }
      } catch (e) { info.probes.push(`${p} → ${String(e).slice(0, 80)}`); }
    }
    return info;
  };

  SD.csrfFrom = html => {
    const x = html.match(/name="csrf-token"\s+content="([^"]+)"/) || html.match(/content="([^"]+)"\s+name="csrf-token"/);
    return x ? x[1] : '';
  };

  SD.csrf = async () => {
    const m = document.querySelector('meta[name="csrf-token"]');
    if (m && m.content) return m.content;
    if (SD._csrf) return SD._csrf;
    for (const p of SD.PROBES) {
      try { const t = SD.csrfFrom((await SD.get(p)).html); if (t) return (SD._csrf = t); } catch (e) {}
    }
    return '';
  };

  SD.athleteId = async () => {
    try { if (window.currentAthlete && window.currentAthlete.id) return String(window.currentAthlete.id); } catch (e) {}
    const pages = [document.documentElement.outerHTML];
    if (SD._html) pages.push(SD._html);
    for (const p of SD.PROBES) { try { pages.push((await SD.get(p)).html); } catch (e) {} }
    for (const html of pages) {
      const m1 = html.match(/currentAthlete[\s\S]{0,300}?["']?id["']?\s*[:=]\s*["']?(\d+)/);
      if (m1) return m1[1];
      const m3 = html.match(/href="\/athletes\/(\d+)"/);
      if (m3) return m3[1];
    }
    return null;
  };

  SD.text = s => String(s == null ? '' : s)
    .replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ').trim();

  SD.walk = (o, fn, depth = 0, seen = new Set()) => {
    if (!o || typeof o !== 'object' || depth > 10 || seen.has(o)) return;
    seen.add(o);
    for (const k of Object.keys(o)) {
      const v = o[k]; fn(k, v);
      if (v && typeof v === 'object') SD.walk(v, fn, depth + 1, seen);
    }
  };

  SD.photos = (o) => {
    const best = new Map();
    SD.walk(o, (k, v) => {
      if (typeof v !== 'string' || !/^https?:\/\//.test(v)) return;
      if (!/\.(jpe?g|png|webp)(\?|$)/i.test(v)) return;
      if (/pictures\/athletes|avatar|profile|mapbox|\/maps?\/|static|badge|logo|icon/i.test(v)) return;
      if (!/photo|cloudfront|media|image|large|thumb/i.test(k + ' ' + v)) return;
      const key = v.replace(/-\d+x\d+(?=\.\w+)/, '').replace(/\?.*$/, '');
      const m = v.match(/-(\d+)x(\d+)\./);
      const size = m ? +m[1] * +m[2] : (/large|full|orig/i.test(k) ? 1e7 : 1e5);
      const cur = best.get(key);
      if (!cur || size > cur.size) best.set(key, { url: v, size });
    });
    return [...best.values()].map(x => x.url).slice(0, 12);
  };

  SD.mapUrl = (o) => {
    let best = null, score = -1;
    SD.walk(o, (k, v) => {
      if (typeof v !== 'string' || !/^https?:\/\//.test(v)) return;
      if (!(/map/i.test(k) || /\/maps?\/|mapbox|staticmap/i.test(v))) return;
      if (/avatar|pictures\/athletes/i.test(v)) return;
      const sc = (/retina|2x|large|dark/i.test(k) ? 2 : 0) + (/dark/i.test(v) ? 1 : 0);
      if (sc > score) { best = v; score = sc; }
    });
    return best;
  };

  SD.stats = (arr) => {
    const out = [];
    if (!Array.isArray(arr)) return out;
    const map = {};
    arr.forEach(s => { if (s && s.key) map[s.key] = s.value; });
    for (const s of arr) {
      if (!s) continue;
      if (s.subtitle !== undefined || s.label !== undefined) {
        out.push({ label: SD.text(s.subtitle !== undefined ? s.subtitle : s.label), value: SD.text(s.value) });
        continue;
      }
      if (!s.key || /_subtitle$/.test(s.key)) continue;
      out.push({ label: SD.text(map[s.key + '_subtitle']) || s.key, value: SD.text(s.value) });
    }
    return out.filter(x => x.value);
  };

  SD.dur = s => { s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return h ? `${h}h ${m}m` : `${m}m ${x}s`; };

  SD.rawStats = (a) => {
    const out = [];
    const d = +a.distance, t = +(a.moving_time || a.movingTime || a.elapsed_time || a.elapsedTime);
    if (d > 0) out.push({ label: 'Distance', value: (d / 1000).toFixed(2) + ' km' });
    if (t > 0) out.push({ label: 'Time', value: SD.dur(t) });
    const eg = +(a.elevation_gain || a.total_elevation_gain || a.elevationGain);
    if (eg > 0) out.push({ label: 'Elevation', value: Math.round(eg) + ' m' });
    return out;
  };

  SD.achievements = (o) => {
    let prs = 0, total = 0; const list = [];
    SD.walk(o, (k, v) => {
      if (/^(pr_?count|prCount|num_?prs|personalRecordCount)$/i.test(k) && typeof v === 'number') prs = Math.max(prs, v);
      if (/achievements?_?count/i.test(k) && typeof v === 'number') total = Math.max(total, v);
      if (/achievement/i.test(k) && Array.isArray(v)) {
        for (const a of v) {
          if (!a || typeof a !== 'object') continue;
          list.push({
            type: SD.text(a.type || a.achievementType || a.kind || a.achievement_type || ''),
            name: SD.text(a.name || a.segmentName || a.segment_name || a.description || a.title || a.effort_name || ''),
            rank: a.rank || a.place || null,
          });
        }
      }
    });
    const prList = list.filter(a => /\bpr\b|personal|best/i.test(a.type)).length;
    return { prs: Math.max(prs, prList), total: Math.max(total, list.length), list: list.slice(0, 10) };
  };

  SD.hr = (o, stats) => {
    for (const s of stats) if (/heart|bpm|pulsas|\bhr\b/i.test(s.label + ' ' + s.value)) return s.value;
    let hr = null;
    SD.walk(o, (k, v) => {
      if (hr == null && /^(avg|average)_?(heart_?rate|heartrate|hr)$/i.test(k) && +v > 0) hr = Math.round(+v) + ' bpm';
    });
    return hr;
  };

  // Start time on the athlete's own clock: {h, m, src}. src: 3 = local timestamp, 2 = Strava's label, 1 = UTC shown in phone time.
  SD.to24 = (h, m, ap) => {
    h = +h; ap = String(ap || '').replace(/\./g, '').toUpperCase();
    if (ap === 'PM' && h < 12) h += 12;
    if (ap === 'AM' && h === 12) h = 0;
    return { h, m: +m };
  };
  SD.clockFromText = (s, src = 2) => {
    const m = String(s || '').match(/(\d{1,2}):(\d{2})\s*([AaPp]\.?\s?[Mm]\.?)?/);
    if (!m) return null;
    const c = SD.to24(m[1], m[2], m[3]);
    return c.h < 24 && c.m < 60 ? Object.assign(c, { src }) : null;
  };
  SD.clockLocal = (o) => {
    let c = null;
    SD.walk(o, (k, v) => {
      if (c || typeof v !== 'string' || !/local/i.test(k) || !/start|date|time/i.test(k)) return;
      const m = v.match(/\d{4}-\d{2}-\d{2}[T ](\d{2}):(\d{2})/);
      if (m && !(+m[1] === 0 && +m[2] === 0)) c = { h: +m[1], m: +m[2], src: 3 };
    });
    return c;
  };
  SD.clockUtc = (s) => {
    if (!/T\d{2}:\d{2}/.test(s || '') || /T00:00(:00)?(\.0+)?(Z|[+-]00:?00)?$/.test(s)) return null;
    const d = new Date(s);
    return isNaN(d) ? null : { h: d.getHours(), m: d.getMinutes(), src: 1 };
  };
  SD.best = (...cs) => cs.filter(c => c && !(c.h === 0 && c.m === 0)).sort((x, y) => y.src - x.src)[0] || null;

  SD.item = (a, f) => {
    const stats = Array.isArray(a.stats) ? SD.stats(a.stats) : SD.rawStats(a);
    const st = Date.parse(f.start || '');
    return {
      id: String(f.id), name: SD.text(f.name), type: String(f.type || ''),
      start: isNaN(st) ? null : st, when: SD.text(f.when || ''), location: SD.text(f.location || ''),
      clock: SD.best(SD.clockLocal(a), SD.clockFromText(SD.text(f.when || '')), SD.clockUtc(f.start)),
      athleteId: String(f.athleteId || ''), athleteName: SD.text(f.athleteName || ''), avatar: f.avatar || '',
      description: SD.text(a.description || ''),
      stats, hr: SD.hr(a, stats), ach: SD.achievements(a), photos: SD.photos(f.photoSrc || a), map: SD.mapUrl(a),
      kudos: f.kudos || 0, comments: f.comments || 0, hasKudoed: !!f.hasKudoed, canKudo: true,
    };
  };

  SD.normalize = (e) => {
    const out = [];
    if (e.activity && e.activity.id != null) {
      const a = e.activity, ath = a.athlete || {}, kc = a.kudosAndComments || {}, tl = a.timeAndLocation || {};
      out.push(SD.item(a, {
        id: a.id, name: a.activityName || a.name, type: a.type || a.activityType || a.sportType,
        start: a.startDate || a.start_date, when: tl.displayDateAtTime, location: tl.location,
        athleteId: ath.athleteId || ath.id, avatar: ath.avatarUrl || ath.profileUrl || ath.avatar,
        athleteName: ath.athleteName || ath.name || [ath.firstName, ath.lastName].filter(Boolean).join(' '),
        kudos: kc.kudosCount, comments: kc.commentCount != null ? kc.commentCount : (Array.isArray(kc.comments) ? kc.comments.length : 0),
        hasKudoed: kc.hasKudoed, canKudo: kc.canKudo, photoSrc: a.mapAndPhotos || a,
      }));
    }
    const group = (e.rowData && e.rowData.activities) || e.activities || (e.groupActivity && e.groupActivity.activities);
    if (Array.isArray(group)) {
      for (const a of group) {
        if (!a || (a.activity_id == null && a.id == null)) continue;
        out.push(SD.item(a, {
          id: a.activity_id != null ? a.activity_id : a.id, name: a.name || a.activity_name, type: a.type || a.activity_type,
          start: a.start_date || a.startDate, location: a.location,
          athleteId: a.athlete_id || a.athleteId, athleteName: a.athlete_name || a.athleteName,
          avatar: a.athlete_avatar || a.avatar_url || a.profile,
          kudos: a.kudos_count != null ? a.kudos_count : a.kudosCount,
          comments: a.comments_count != null ? a.comments_count : a.commentCount,
          hasKudoed: a.has_kudoed || a.kudosed || a.hasKudoed,
        }));
      }
    }
    return out;
  };

  SD.page = async (athleteId, before, cursor, dayStart, dayEnd, keepRaw) => {
    let url = `/dashboard/feed?feed_type=following&athlete_id=${athleteId}&club_id=`;
    if (before != null) url += `&before=${before}&cursor=${cursor}`;
    const r = await fetch(url, { credentials: 'include', headers: XHR });
    const t = await r.text();
    let page;
    try { page = JSON.parse(t); }
    catch (e) { throw new Error(`Strava feed returned HTTP ${r.status} instead of data. Strava may have changed its website; turn on DEBUG_DUMP and check the log.`); }
    const entries = page.entries || page.feedEntries || page.items || [];
    const cdOf = e => e.cursorData || e.cursor_data || e.cursor || {};
    const items = []; let oldest = null, oldestStart = null, firstId = null;
    for (const e of entries) {
      const cd = cdOf(e);
      const upd = cd.updated_at != null ? +cd.updated_at : (cd.updatedAt != null ? +cd.updatedAt : null);
      if (upd != null && !isNaN(upd)) oldest = oldest == null ? upd : Math.min(oldest, upd);
      for (const a of SD.normalize(e)) {
        if (firstId == null) firstId = a.id;
        if (a.start) oldestStart = oldestStart == null ? a.start : Math.min(oldestStart, a.start);
        const ts = a.start || (upd ? upd * 1000 : null);
        a.ts = ts;
        if (ts != null && ts >= dayStart && ts < dayEnd) items.push(a);
      }
    }
    // Work out how to ask for the next (older) page.
    const last = entries[entries.length - 1];
    const lcd = last ? cdOf(last) : {};
    const pg = page.pagination || {};
    let next = null;
    const lastUpd = lcd.updated_at != null ? lcd.updated_at : lcd.updatedAt;
    if (lastUpd != null) next = { before: lastUpd, cursor: lcd.rank != null ? lcd.rank : lastUpd };
    else {
      const c = pg.cursor || pg.nextCursor || pg.next_cursor || page.cursor || page.nextCursor || page.next_cursor;
      const b = pg.before || page.before;
      if (c != null || b != null) next = { before: b != null ? b : c, cursor: c != null ? c : b };
      else if (oldestStart) { const sec = Math.floor(oldestStart / 1000); next = { before: sec, cursor: sec }; }
    }
    if (!entries.length || pg.hasMore === false || pg.has_more === false) next = null;
    const shape = {
      pageKeys: Object.keys(page).slice(0, 12),
      entryKeys: last ? Object.keys(last).slice(0, 12) : [],
      cursorKeys: Object.keys(lcd).slice(0, 8),
    };
    return { items, oldest, oldestStart, firstId, entryCount: entries.length, next, shape, raw: keepRaw ? page : null };
  };

  SD.details = async (id) => {
    const html = await (await fetch(`/activities/${id}`, { credentials: 'include' })).text();
    const res = { hr: null, maxHr: null, prs: null, achievements: null, list: [], photos: [], clock: null };
    const nd = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (nd) {
      try {
        const j = JSON.parse(nd[1]);
        SD.walk(j, (k, v) => {
          if (res.hr == null && /^(avg|average)_?(heart_?rate|heartrate|hr)$/i.test(k) && +v > 0) res.hr = Math.round(+v);
          if (res.maxHr == null && /^max_?(heart_?rate|heartrate|hr)$/i.test(k) && +v > 0) res.maxHr = Math.round(+v);
        });
        const a = SD.achievements(j);
        if (a.total || a.prs) { res.prs = a.prs; res.achievements = a.total; res.list = a.list; }
        res.photos = SD.photos(j);
        res.clock = SD.clockLocal(j);
      } catch (e) {}
    }
    const txt = SD.text(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' '));
    if (res.hr == null) {
      const m = txt.match(/Heart\s*Rate\s*(\d{2,3})\s*bpm(?:\s*(\d{2,3})\s*bpm)?/i);
      if (m) { res.hr = +m[1]; if (m[2]) res.maxHr = +m[2]; }
    }
    if (res.achievements == null) {
      const m = txt.match(/(\d+)\s*Achievements?\b/i) || txt.match(/Achievements?\s*(\d+)\b/i);
      if (m) res.achievements = +m[1];
    }
    if (res.prs == null) { const m = txt.match(/(\d+)\s*(?:PRs?|Personal Records?)\b/i); if (m) res.prs = +m[1]; }
    if (!res.clock) {
      const lm = html.match(/start_?date_?local[^0-9]{0,12}\d{4}-\d{2}-\d{2}[T ](\d{2}):(\d{2})/i);
      const on = txt.match(/(\d{1,2}:\d{2}\s*(?:[AaPp]\.?\s?[Mm]\.?)?)\s+on\s+[A-Z][a-z]+day/);
      const tm = html.match(/<time[^>]*>([^<]{4,80})<\/time>/i);
      res.clock = SD.best(lm && { h: +lm[1], m: +lm[2], src: 3 }, on && SD.clockFromText(on[1]), tm && SD.clockFromText(tm[1]));
    }
    const og = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
    if (og && !/logo|default|placeholder/i.test(og[1])) res.map = og[1].replace(/&amp;/g, '&');
    if (!res.photos.length) {
      const urls = html.match(/https:\/\/dgtzuqphqg23d\.cloudfront\.net\/[^"'\s)\\]+\.(?:jpe?g|png)/gi) || [];
      res.photos = SD.photos({ photos: urls });
    }
    return res;
  };

  SD.enrich = async (ids, conc) => {
    const out = {}; let i = 0;
    const worker = async () => {
      while (i < ids.length) {
        const id = ids[i++];
        try { out[id] = await SD.details(id); } catch (e) { out[id] = { error: String(e) }; }
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(conc, ids.length)) }, worker));
    return out;
  };

  SD.post = async (attempts) => {
    const token = await SD.csrf();
    let last = '';
    for (const [path, body] of attempts) {
      try {
        const r = await fetch(path, {
          method: 'POST', credentials: 'include',
          headers: Object.assign({}, XHR, { 'X-CSRF-Token': token, 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' }),
          body: `authenticity_token=${encodeURIComponent(token)}${body ? '&' + body : ''}`,
        });
        if (r.ok) return { ok: true, path };
        last = `HTTP ${r.status}`;
      } catch (e) { last = String(e); }
    }
    return { ok: false, error: last };
  };

  SD.kudo = (id) => SD.post([[`/feed/activity/${id}/kudo`, '']]);

  SD.commentDirect = async (tpl, id, text) => {
    const enc = { json: JSON.stringify(text).slice(1, -1), form: encodeURIComponent(text), plus: encodeURIComponent(text).replace(/%20/g, '+'), raw: text }[tpl.enc];
    const token = await SD.csrf();
    let body = tpl.body.split('{{TEXT}}').join(enc).split('{{ID}}').join(id).split('{{CSRF}}').join(encodeURIComponent(token || ''));
    const headers = Object.assign({}, XHR, { 'X-CSRF-Token': token });
    if (tpl.ct) headers['Content-Type'] = tpl.ct;
    let r;
    try { r = await fetch(tpl.url.split('{{ID}}').join(id), { method: tpl.method, credentials: 'include', headers, body }); }
    catch (e) { return { ok: false, error: String(e), definite: false }; }
    const t = await r.text().catch(() => '');
    if (r.ok) {
      try { const j = JSON.parse(t); if (j && j.errors && j.errors.length) return { ok: false, error: 'Strava rejected it', definite: true }; } catch (e) {}
      return { ok: true, via: `direct ${r.status}` };
    }
    // 4xx means Strava refused it, so nothing was posted and the page-based method can be tried safely
    return { ok: false, error: `HTTP ${r.status}`, definite: r.status >= 400 && r.status < 500 };
  };

  SD.sleep = ms => new Promise(r => setTimeout(r, ms));
  SD.waitFor = async (fn, timeout) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) { const v = fn(); if (v) return v; await SD.sleep(250); }
    return null;
  };
  const visible = el => !!(el && (el.offsetParent !== null || el.getClientRects().length));
  const describe = el => [el.placeholder, el.getAttribute('aria-label'), el.getAttribute('data-testid'),
    el.getAttribute('title'), el.name, el.id, el.className, el.value, el.textContent].join(' ');
  const COMMENT_RX = /comment|komentar/i;

  // Record the page's own network calls so we can tell whether Strava accepted the comment.
  SD.bodyStr = (b) => {
    try {
      if (b == null) return null;
      if (typeof b === 'string') return b;
      if (b instanceof URLSearchParams) return b.toString();
      if (typeof FormData !== 'undefined' && b instanceof FormData)
        return new URLSearchParams([...b.entries()].filter(e => typeof e[1] === 'string')).toString();
    } catch (e) {}
    return null;
  };
  SD.ctOf = (h) => {
    try {
      if (!h) return '';
      if (typeof h.get === 'function') return h.get('content-type') || '';
      for (const k of Object.keys(h)) if (k.toLowerCase() === 'content-type') return h[k];
    } catch (e) {}
    return '';
  };

  SD.hookNet = () => {
    if (window.__SDnet) return;
    const log = window.__SDnet = [];
    const of = window.fetch;
    window.fetch = function (input, init) {
      const rec = { url: typeof input === 'string' ? input : (input && input.url), method: ((init && init.method) || (input && input.method) || 'GET').toUpperCase(),
        body: SD.bodyStr(init && init.body), ct: SD.ctOf(init && init.headers) };
      log.push(rec);
      return of.apply(this, arguments).then(r => { rec.status = r.status; return r; }, e => { rec.status = -1; throw e; });
    };
    const oo = XMLHttpRequest.prototype.open, os = XMLHttpRequest.prototype.send;
    const oh = XMLHttpRequest.prototype.setRequestHeader;
    XMLHttpRequest.prototype.open = function (m, u) { this.__rec = { method: String(m).toUpperCase(), url: u, ct: '' }; return oo.apply(this, arguments); };
    XMLHttpRequest.prototype.setRequestHeader = function (k, v) { if (this.__rec && String(k).toLowerCase() === 'content-type') this.__rec.ct = v; return oh.apply(this, arguments); };
    XMLHttpRequest.prototype.send = function (b) {
      const rec = this.__rec || {}; rec.body = SD.bodyStr(b); log.push(rec);
      this.addEventListener('loadend', () => { rec.status = this.status || -1; });
      return os.apply(this, arguments);
    };
  };

  SD.findCommentBox = () => [...document.querySelectorAll('textarea, input[type="text"], [contenteditable="true"]')]
    .find(el => visible(el) && COMMENT_RX.test(describe(el)));

  SD.commentViaUI = async (text) => {
    SD.hookNet();
    let box = await SD.waitFor(SD.findCommentBox, 6000);
    if (!box) {
      const opener = [...document.querySelectorAll('button, a, [role="button"]')]
        .find(b => visible(b) && COMMENT_RX.test(describe(b)) && !/kudo/i.test(describe(b)));
      if (opener) { opener.click(); box = await SD.waitFor(SD.findCommentBox, 5000); }
    }
    if (!box) return { ok: false, error: 'the comment box was not found on the activity page' };

    box.scrollIntoView({ block: 'center' });
    box.focus();
    if (box.isContentEditable) {
      document.execCommand('selectAll', false, null);
      document.execCommand('insertText', false, text);
    } else {
      const proto = box.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(box, text);
      box.dispatchEvent(new Event('input', { bubbles: true }));
      box.dispatchEvent(new Event('change', { bubbles: true }));
    }
    await SD.sleep(400);

    window.__SDnet.length = 0;
    let scope = box.closest('form') || box.parentElement;
    let btn = null;
    for (let i = 0; i < 5 && scope && !btn; i++, scope = scope.parentElement) {
      btn = [...scope.querySelectorAll('button, input[type="submit"]')].find(b => visible(b) && !b.disabled &&
        (b.type === 'submit' || /post|send|publish|submit|skelbti|siųsti|komentuoti/i.test(describe(b))) && !/kudo|cancel|atšaukti/i.test(describe(b)));
    }
    if (btn) btn.click();
    else box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));

    const forms = [text, encodeURIComponent(text), encodeURIComponent(text).replace(/%20/g, '+'), JSON.stringify(text).slice(1, -1)];
    const carries = r => r.method !== 'GET' && ((r.body && forms.some(f => r.body.includes(f))) || /comment/i.test(String(r.url)));
    const req = await SD.waitFor(() => window.__SDnet.find(r => carries(r) && r.status), 12000);
    if (req && req.status >= 200 && req.status < 300)
      return { ok: true, via: `${req.method} ${req.url}`, req: { method: req.method, url: String(req.url), body: req.body || null, ct: req.ct || '' } };
    await SD.sleep(800);
    const left = box.isContentEditable ? box.textContent : box.value;
    if (!String(left || '').includes(text) && document.body.innerText.includes(text)) return { ok: true, via: 'page' };
    return { ok: false, error: req ? `Strava answered HTTP ${req.status}` : 'Strava did not send the comment' };
  };

  window.__SD = SD;
}

// ───────────────────────────── rendering ─────────────────────────────

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function initials(n) { return String(n || '?').split(/\s+/).map(w => w[0] || '').join('').slice(0, 2).toUpperCase(); }

function emoji(t) {
  t = String(t || '').toLowerCase();
  if (/trail/.test(t)) return '⛰️';
  if (/run/.test(t)) return '🏃';
  if (/ride|bike|cycl/.test(t)) return '🚴';
  if (/swim/.test(t)) return '🏊';
  if (/walk/.test(t)) return '🚶';
  if (/hike/.test(t)) return '🥾';
  if (/ski|snowboard/.test(t)) return '⛷️';
  if (/row|kayak|canoe|paddle/.test(t)) return '🚣';
  if (/yoga|pilates/.test(t)) return '🧘';
  if (/weight|workout|crossfit|hiit|strength/.test(t)) return '🏋️';
  if (/tennis|padel|squash|badminton/.test(t)) return '🎾';
  return '⚡';
}

function dayLabel(t) {
  const df = new DateFormatter(); df.dateFormat = 'EEE d MMM, HH:mm';
  return df.string(new Date(t));
}

function daysNav(current) {
  const df = new DateFormatter(); df.dateFormat = 'EEE d';
  const chips = [];
  for (let i = 0; i < CONFIG.DAYS_IN_PICKER; i++) {
    const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - i);
    const label = i === 0 ? 'Today' : i === 1 ? 'Yesterday' : df.string(d);
    chips.push(`<button class="day${i === current ? ' on' : ''}" data-day="${i}"${i === current ? ' aria-current="date"' : ''}>${esc(label)}</button>`);
  }
  return `<nav class="seg" aria-label="Choose day">${chips.join('')}</nav>`;
}

// App mark in the Go2FGym style: a plate with a ring and a hole, in Strava orange.
const LOGO = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="var(--accent)"/>'
  + '<circle cx="12" cy="12" r="7.6" fill="none" stroke="rgba(255,255,255,.45)" stroke-width="1.3"/>'
  + '<circle cx="12" cy="12" r="2.8" fill="var(--bg)"/></svg>';

// Sticky app header: brand row, then day switcher + "kudos to all", always within reach.
function appHeader(daysBack, open, people) {
  const all = !people ? ''
    : open > 0 ? `<button class="allk" data-act="kudo-all" data-label="👍 All ${open}" aria-label="Give kudos to all ${open}, one each">👍 All ${open}</button>`
    : `<button class="allk done" disabled aria-label="Everyone has your kudos">✓ All</button>`;
  return `<header class="hdr">
    <div class="brand"><span class="brand-mark">${LOGO}</span><span class="brand-name">Daily Digest</span>
      <button class="hbtn" data-act="refresh" aria-label="Refresh">↻</button></div>
    <div class="hrow">${daysNav(daysBack)}${all}</div>
    <div id="st" class="loadst" aria-live="polite"></div>
  </header>`;
}

function summaryText(people, count) {
  const prs = people.reduce((n, p) => n + p.acts.reduce((m, a) => m + (a.ach.prs || 0), 0), 0);
  const birds = people.filter(p => p.early).length;
  return `${people.length} ${people.length === 1 ? 'person' : 'people'}, ${count} ${count === 1 ? 'activity' : 'activities'}${prs ? `, ${prs} PR${prs > 1 ? 's' : ''}` : ''}${birds ? `, ${birds} early riser${birds > 1 ? 's' : ''}` : ''}`;
}

function renderDigest({ dayStart, daysBack, scan, people, count }) {
  const df = new DateFormatter(); df.dateFormat = 'EEEE, d MMMM';
  const summary = summaryText(people, count);
  const open = people.filter(p => !p.kudoed && p.primary.canKudo).length;
  const waiting = people.filter(p => !p.kudoed), given = people.filter(p => p.kudoed);
  const section = (title, list, cls) => list.length
    ? `<h2 class="sec ${cls}">${title}<span>${list.length}</span></h2>${list.map(personHtml).join('')}` : '';
  const body = people.length
    ? section('Waiting for your kudos', waiting, 'todo') + section('Kudos given', given, 'given')
    : `<div class="center">Nobody you follow has posted ${daysBack ? 'on that day' : 'yet today'}.<br><br><button class="ghost" data-act="refresh">Check again</button>${scanNote(scan)}</div>`;
  return page(`
    ${appHeader(daysBack, open, people.length)}
    <div class="top"><div><h1>${esc(df.string(dayStart))}</h1><div class="sub">${esc(summary)}</div></div></div>
    ${body}
    <p class="ver">Daily Digest v${VERSION}</p>`);
}

function scanNote(scan) {
  if (!scan) return '';
  const at = t => (t ? dayLabel(t) : 'unknown');
  return `<p class="scan">Read ${scan.pages} feed page${scan.pages === 1 ? '' : 's'} (${scan.entries} posts), feed reached ${esc(at(scan.position))}, oldest activity ${esc(at(scan.oldest))}. Stopped because ${esc(scan.stop)}.</p>`;
}

function personHtml(p) {
  const pid = esc(p.id);
  const profile = /^\d+$/.test(p.id) ? ` data-athlete="${pid}"` : '';
  const avatar = p.avatar && !/avatar\/athlete/.test(p.avatar)
    ? `<img class="av" src="${esc(p.avatar)}"${profile}>`
    : `<div class="av ph"${profile}>${esc(initials(p.name))}</div>`;
  const sub = `${p.acts.length} ${p.acts.length > 1 ? 'activities' : 'activity'}${p.total ? `, ${esc(p.total)}` : ''}`;
  const btn = p.primary.canKudo
    ? `<button class="kudo person-k${p.kudoed ? ' done' : ''}" data-kudo="${esc(p.primary.id)}" data-pid="${pid}"${p.kudoed ? ' disabled' : ''}>${p.kudoed ? '✓ Kudos given' : '👍 Kudos'}</button>`
    : '';
  return `<section class="person" data-pid="${pid}"${p.kudoed ? ' data-counted="1"' : ''}>
    <header>${avatar}<div class="pn"><b>${esc(p.name)}${p.early ? ` <span class="nb">${p.early.icon}</span>` : ''}</b><span>${sub}</span></div>${btn}</header>
    ${p.acts.map(a => actHtml(a, p)).join('')}
  </section>`;
}

function actHtml(a, p) {
  const id = esc(a.id);
  const fallback = String(a.when || '').replace(/^(today|šiandien)\s*(at|)\s*/i, '');
  const df = new DateFormatter(); df.dateFormat = 'MMM d';
  const date = a.ts ? df.string(new Date(a.ts)) : '';
  const when = date
    ? `<span class="clk">${esc(date)}${a.clock ? `, ${fmtClock(a.clock)}` : ''}</span>`
    : (a.clock ? `<span class="clk">${fmtClock(a.clock)}</span>` : esc(fallback));
  const meta = [when, esc(a.location)].filter(Boolean).join(', ');
  const e = early(a);
  const stats = a.stats.map(s => `<div class="st"><b>${esc(s.value)}</b><small>${esc(s.label)}</small></div>`).join('')
    + (a.hr && !a.hrInStats ? `<div class="st hr"><b>${esc(a.hr)}</b><small>Heart rate</small></div>` : '');
  const badges = [];
  if (e) badges.push(`<span class="early ${e.cls}">${e.icon} ${e.label}</span>`);
  if (a.ach.prs) badges.push(`<span class="pr">🏆 ${a.ach.prs} PR${a.ach.prs > 1 ? 's' : ''}</span>`);
  if (a.ach.total > (a.ach.prs || 0)) badges.push(`<span class="pr soft">${a.ach.total} achievement${a.ach.total > 1 ? 's' : ''}</span>`);
  const achList = a.ach.list.filter(x => x.name).slice(0, 5)
    .map(x => `<li>${esc([x.type, x.name].filter(Boolean).join(': '))}${x.rank ? ` (#${esc(x.rank)})` : ''}</li>`).join('');
  const photos = a.photos.length
    ? `<div class="photos">${a.photos.map(u => `<img loading="lazy" src="${esc(u)}" data-photo="1" alt="Activity photo" onerror="this.remove()">`).join('')}</div>` : '';
  const main = p.acts.length > 1 && p.primary.id === a.id ? `<span class="main">gets the kudos</span>` : '';
  return `<article class="act" data-id="${id}" data-map="${esc(a.map || '')}">
    <div class="ah"><span class="emo">${emoji(a.type)}</span><div class="at"><b class="ttl" data-detail="${id}">${esc(a.name || a.type || 'Activity')}</b>${main}<small>${meta}</small></div></div>
    ${stats ? `<div class="stats">${stats}</div>` : ''}
    ${badges.length ? `<div class="badges">${badges.join('')}</div>` : ''}
    ${achList ? `<ul class="alist">${achList}</ul>` : ''}
    ${a.description ? `<p class="desc">${esc(a.description)}</p>` : ''}
    ${photos}
    <div class="bar">
      <span class="counts">👍 <i class="kc">${a.kudos}</i>&nbsp;&nbsp;💬 <i class="cc">${a.comments}</i></span>
      ${a.canKudo ? `<button class="small kudo${a.hasKudoed ? ' done' : ''}" data-kudo="${id}" data-pid="${esc(p.id)}"${a.hasKudoed ? ' disabled' : ''}>${a.hasKudoed ? '✓' : '👍'}</button>` : ''}
      <button class="small" data-act="toggle-comment" aria-label="Comment">💬</button>
      <button class="small" data-detail="${id}" aria-label="Activity details">↗</button>
    </div>
    <div class="cbox" hidden>
      <div class="crow"><textarea rows="3" placeholder="Write a comment, or tap Suggest"></textarea><button data-comment="${id}">Post</button></div>
      <div class="ai"><button class="small" data-suggest="${id}">✨ Suggest</button>${CONFIG.AI.LANGUAGES.map(([code, name]) =>
        `<button class="lng${name === STATE.aiLang ? ' on' : ''}" data-lang="${esc(name)}">${esc(code)}</button>`).join('')}</div>
      <div class="sugs"></div>
    </div>
  </article>`;
}

function bootScreen(msg) {
  return page(`<div class="boot" role="status" aria-live="polite">
    <div class="scene" aria-hidden="true">
      <div class="sunb"></div>
      <div class="pile"></div>
      <svg class="runner" viewBox="0 0 60 80" aria-hidden="true"><g class="body"><g transform="translate(30 41)"><g class="thigh b"><line x1="0" y1="0" x2="0" y2="15"/><g transform="translate(0 15)"><g class="shin b"><line x1="0" y1="0" x2="0" y2="15"/><line x1="0" y1="15" x2="5" y2="15"/></g></g></g></g><g transform="translate(34 24)"><g class="uarm b"><line x1="0" y1="0" x2="0" y2="10"/><g transform="translate(0 10)"><g class="farm b"><line x1="0" y1="0" x2="0" y2="9"/></g></g></g></g><line class="torso" x1="30" y1="41" x2="35" y2="22"/><circle class="head" cx="37" cy="14" r="6"/><g transform="translate(30 41)"><g class="thigh f"><line x1="0" y1="0" x2="0" y2="15"/><g transform="translate(0 15)"><g class="shin f"><line x1="0" y1="0" x2="0" y2="15"/><line x1="0" y1="15" x2="5" y2="15"/></g></g></g></g><g transform="translate(34 24)"><g class="uarm f"><line x1="0" y1="0" x2="0" y2="10"/><g transform="translate(0 10)"><g class="farm f"><line x1="0" y1="0" x2="0" y2="9"/></g></g></g></g></g></svg>
      <div class="track"></div>
    </div>
    <div class="cnt"><b id="cnt">0</b><span>posts loaded</span></div>
    <div class="quip" id="quip">Lacing up your feed</div>
    <div id="st" class="bootst">${esc(msg)}</div>
  </div>`);
}

function shell(msg, isError) {
  return page(`<div class="center">${isError ? '' : '<div class="spin"></div>'}<div id="st">${msg}</div>
    ${isError ? '<br><button class="ghost" data-act="refresh">Try again</button>' : ''}</div>`);
}

function page(content) {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
<style>
:root{--bg:#f2f1ee;--card:#fff;--fg:#17171a;--mut:#6d6c72;--line:#e3e1dc;--soft:#efeeea;--accent:#fc4c02;--gold:#9a6200;--goldbg:#fdf0d2;--hr:#c92a5c}
@media (prefers-color-scheme:dark){:root{--bg:#121214;--card:#1c1c20;--fg:#f1f0ee;--mut:#9b9aa2;--line:#2c2c31;--soft:#26262b;--gold:#f3c15c;--goldbg:#3b2d0f;--hr:#ff7aa2}}
*{box-sizing:border-box}
html,body{touch-action:pan-x pan-y;-webkit-text-size-adjust:100%}
button,img{touch-action:manipulation}
textarea,input{font-size:16px!important}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.4 -apple-system,system-ui,sans-serif;padding:max(14px,env(safe-area-inset-top)) 12px 70px;-webkit-text-size-adjust:100%}
.top{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:4px 4px 14px}
h1{font-size:24px;line-height:1.15;margin:0;letter-spacing:-.01em}
.sub{color:var(--mut);font-size:13px;margin-top:2px}
button{font:inherit;border:0;border-radius:999px;padding:8px 14px;background:var(--accent);color:#fff;font-weight:600;cursor:pointer}
button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
button.ghost{background:var(--soft);color:var(--fg)}
button.round{width:40px;height:40px;padding:0;font-size:18px;flex:none}
button.small{background:var(--soft);color:var(--fg);padding:6px 12px}
button.done,button:disabled{background:var(--soft);color:var(--mut)}
button.all{width:100%;margin:0 0 14px;padding:12px}
.person{background:var(--card);border-radius:18px;padding:14px;margin-bottom:12px}
.person header{display:flex;align-items:center;gap:10px}
.av{width:44px;height:44px;border-radius:50%;object-fit:cover;flex:none;background:var(--soft)}
.av.ph{display:grid;place-items:center;font-weight:700;color:var(--mut)}
.pn{flex:1;min-width:0}.pn b{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:16px}.pn span{color:var(--mut);font-size:13px}
.act{border-top:1px solid var(--line);margin-top:14px;padding-top:14px}
.ah{display:flex;gap:10px;align-items:flex-start}.emo{font-size:22px;line-height:1.1}
.at b{font-size:16px}.at small{display:block;color:var(--mut);font-size:12px}
.main{font-size:11px;color:var(--accent);font-weight:700;margin-left:6px}
.stats{display:grid;grid-template-columns:repeat(auto-fill,minmax(88px,1fr));gap:12px 10px;margin-top:12px}
.st b{display:block;font-size:19px;font-weight:650;letter-spacing:-.01em;font-variant-numeric:tabular-nums;line-height:1.15}
.st small{color:var(--mut);font-size:12px}
.st.hr b{color:var(--hr)}
.badges{display:flex;gap:6px;margin-top:10px;flex-wrap:wrap}
.pr{background:var(--goldbg);color:var(--gold);border-radius:999px;padding:3px 10px;font-weight:700;font-size:13px}
.pr.soft{font-weight:600}
.alist{margin:6px 0 0;padding-left:18px;color:var(--mut);font-size:13px}
.desc{margin:10px 0 0;font-size:14px;white-space:pre-wrap}
.photos{display:flex;gap:6px;overflow-x:auto;margin:12px -14px 0;padding:0 14px;scroll-snap-type:x mandatory}
.hdr{position:sticky;top:0;z-index:20;margin:calc(-1 * max(14px, env(safe-area-inset-top))) -12px 14px;padding:max(4px, env(safe-area-inset-top)) 12px 8px;background:var(--bg);border-bottom:1px solid var(--line);transition:box-shadow .2s}
.hdr.stuck{box-shadow:0 8px 18px -12px rgba(0,0,0,.6)}
.brand{display:flex;align-items:center;gap:8px;min-height:44px}
.brand-mark svg{display:block;width:24px;height:24px}
.brand-name{font-weight:800;font-size:19px;line-height:1;letter-spacing:-.01em;margin-right:auto}
.hbtn{background:transparent;color:var(--fg);width:36px;height:36px;padding:0;font-size:19px;font-weight:600}
.hrow{display:flex;align-items:center;gap:8px}
.seg{flex:1;min-width:0;display:flex;gap:2px;padding:3px;border-radius:999px;background:var(--card);overflow-x:auto;scrollbar-width:none}
.seg::-webkit-scrollbar{display:none}
.day{flex:1 0 auto;background:transparent;color:var(--mut);padding:6px 10px;font-size:13px;font-weight:600;white-space:nowrap}
.day.on{background:var(--fg);color:var(--bg)}
.allk{flex:none;padding:8px 13px;font-size:13px;white-space:nowrap;font-variant-numeric:tabular-nums}
.allk.done{background:var(--card);color:var(--mut)}
.allk.armed{background:var(--fg);color:var(--bg)}
.scan{margin:28px auto 0;max-width:34em;font-size:12px;line-height:1.5;color:var(--mut);word-break:break-word}
.sec{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:700;color:var(--mut);margin:18px 6px 10px}
.sec:first-of-type{margin-top:4px}
.sec span{background:var(--soft);color:var(--fg);border-radius:999px;padding:1px 9px;font-size:12px;font-variant-numeric:tabular-nums}
.sec.todo span{background:var(--accent);color:#fff}
.boot{min-height:80vh;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:20px 0}
.scene{position:relative;width:300px;height:150px;overflow:hidden}
.sunb{position:absolute;right:30px;top:10px;width:34px;height:34px;border-radius:50%;background:radial-gradient(circle,#ffd27a 0 55%,rgba(255,210,122,0) 70%);animation:sunb 3s ease-in-out infinite}
@keyframes sunb{50%{transform:translateY(6px) scale(1.08)}}
.track{position:absolute;left:0;right:0;bottom:18px;height:3px;background:repeating-linear-gradient(90deg,var(--line) 0 18px,transparent 18px 30px);background-size:30px 3px;animation:trackmove .45s linear infinite}
@keyframes trackmove{to{background-position:-30px 0}}
.runner{position:absolute;left:112px;bottom:19px;width:48px;height:64px;overflow:visible}
.runner line{stroke:var(--fg);stroke-width:5;stroke-linecap:round}
.runner .torso{stroke:var(--accent);stroke-width:8}
.runner .head{fill:var(--fg)}
.runner .b line{stroke:var(--mut)}
.runner .body{animation:bob .3s ease-in-out infinite}
.thigh{animation:thigh .6s ease-in-out infinite}
.shin{animation:shin .6s linear infinite}
.uarm{animation:uarm .6s ease-in-out infinite}
.farm{transform:rotate(-80deg)}
.thigh.b,.shin.b,.uarm.b{animation-delay:-.3s}
@keyframes bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-3px)}}
@keyframes thigh{0%,100%{transform:rotate(-38deg)}50%{transform:rotate(32deg)}}
@keyframes shin{0%{transform:rotate(12deg)}25%{transform:rotate(8deg)}50%{transform:rotate(55deg)}75%{transform:rotate(100deg)}100%{transform:rotate(12deg)}}
@keyframes uarm{0%,100%{transform:rotate(40deg)}50%{transform:rotate(-50deg)}}
.pile{position:absolute;right:14px;bottom:21px;width:46px;display:flex;flex-direction:column-reverse;gap:2px}
.pile i{display:block;height:5px;border-radius:2px;background:var(--fg);opacity:.85;box-shadow:inset 6px 0 0 var(--accent)}
.pile i:nth-child(odd){transform:translateX(-2px) rotate(-2deg)}
.pile i:nth-child(even){transform:translateX(2px) rotate(2deg)}
.pile.bump{animation:bump .25s ease-out}
@keyframes bump{50%{transform:scaleY(.9) translateY(2px)}}
.post{position:absolute;left:0;top:0;width:28px;height:20px;border-radius:5px;background:var(--fg);box-shadow:0 2px 6px rgba(0,0,0,.3);animation:deliver 1.3s cubic-bezier(.45,.05,.55,.95) forwards}
.post::before{content:'';position:absolute;left:4px;top:4px;width:6px;height:6px;border-radius:50%;background:var(--accent)}
.post::after{content:'';position:absolute;left:4px;right:4px;top:12px;height:3px;border-radius:2px;background:var(--mut);box-shadow:0 -5px 0 -0px transparent}
@keyframes deliver{
  0%{transform:translate(-34px,var(--y)) rotate(-25deg);opacity:0}
  12%{opacity:1}
  50%{transform:translate(126px,-6px) rotate(12deg) scale(1.1)}
  85%{opacity:1}
  100%{transform:translate(254px,104px) rotate(0) scale(.6);opacity:0}}
.cnt b{display:block;font-size:56px;line-height:1;font-weight:800;letter-spacing:-.02em;font-variant-numeric:tabular-nums;margin-top:6px}
.cnt span{color:var(--mut);font-size:13px}
.cnt.tick b{animation:tick .3s ease-out}
@keyframes tick{40%{transform:scale(1.12);color:var(--accent)}}
.quip{font-size:16px;font-weight:600;margin-top:16px;min-height:1.4em;transition:opacity .25s}
.bootst{color:var(--mut);font-size:13px;margin-top:4px}
@media (prefers-reduced-motion:reduce){.track,.sunb,.post,.cnt.tick b,.runner .body,.thigh,.shin,.uarm{animation:none}.post{display:none}}
#ptr{position:fixed;left:50%;top:env(safe-area-inset-top,0px);transform:translate(-50%,-60px);opacity:0;z-index:30;display:flex;align-items:center;gap:8px;background:var(--card);color:var(--fg);padding:9px 15px;border-radius:999px;font-size:13px;font-weight:600;box-shadow:0 6px 18px rgba(0,0,0,.28);pointer-events:none;transition:opacity .15s}
#ptr .ptri{display:inline-block;font-size:16px;line-height:1}
#ptr.ready{color:var(--accent)}
#ptr.busy{transition:transform .2s,opacity .15s}
#ptr.busy .ptri{animation:s .8s linear infinite}
.loadst{display:none;color:var(--mut);font-size:12px;margin:6px 4px 0}
body.loading .loadst{display:block}
.clk{font-weight:700;color:var(--fg);font-variant-numeric:tabular-nums}
.nb{font-size:15px}
.early{border-radius:999px;padding:3px 11px;font-weight:700;font-size:13px;color:#fff}
.early.e4{background:linear-gradient(135deg,#070b1f,#2a1d5e);box-shadow:inset 0 0 0 1px #6c5ce7}
.early.e5{background:linear-gradient(135deg,#1c2a6e,#8a3f8f)}
.early.e6{background:linear-gradient(135deg,#f9a826,#f2541b)}
#lb{position:fixed;inset:0;z-index:50;background:#000;display:flex;flex-direction:column}
#lb[hidden]{display:none}
#upd{position:fixed;inset:0;z-index:48;background:rgba(0,0,0,.55);display:flex;align-items:flex-end}
.updp{width:100%;background:var(--card);border-radius:22px 22px 0 0;padding:20px 18px calc(16px + env(safe-area-inset-bottom));display:flex;flex-direction:column;gap:8px;animation:up .25s ease-out}
.updtag{align-self:flex-start;background:var(--accent);color:#fff;font-size:12px;font-weight:800;padding:4px 10px;border-radius:999px;letter-spacing:.02em}
.updt{margin:6px 0 0;font-size:22px;line-height:1.2;letter-spacing:-.01em}
.upds{color:var(--mut);font-size:14px}
.updl{display:flex;flex-direction:column;gap:10px;margin:8px 0 6px}
.updi{display:flex;gap:12px;align-items:flex-start;background:var(--soft);border-radius:14px;padding:12px}
.updic{font-size:24px;line-height:1.1;flex:none}
.updi b{display:block;font-size:15px}
.updi span{display:block;color:var(--mut);font-size:13px;line-height:1.35;margin-top:2px}
.updmsg{font-size:14px;min-height:0}
.updmsg:empty{display:none}
.updgo{padding:13px;font-size:16px}
.updlater{padding:11px}
.ver{text-align:center;color:var(--mut);font-size:12px;margin:24px 0 0;opacity:.7}
#kov{position:fixed;inset:0;z-index:66;background:rgba(0,0,0,.86);display:grid;place-items:center;touch-action:none}
#kov[hidden]{display:none}
.kwrap{text-align:center;padding:20px}
.kst{position:relative;margin:0 auto}
.kpc{position:absolute;left:50%;top:50%;width:76px;height:76px;margin:-38px 0 0 -38px;border-radius:50%;background:var(--accent);display:grid;place-items:center;font-size:44px;animation:kpulse 1.1s ease-out infinite;z-index:2}
@keyframes kpulse{0%{box-shadow:0 0 0 0 rgba(252,76,2,.6)}100%{box-shadow:0 0 0 28px rgba(252,76,2,0)}}
#kov.fin .kpc{animation:kdone .6s cubic-bezier(.3,1.6,.5,1) forwards}
@keyframes kdone{40%{transform:scale(1.25) rotate(-12deg)}100%{transform:scale(1.05)}}
.kaw{position:absolute;width:var(--A);height:var(--A);margin:calc(var(--A) / -2) 0 0 calc(var(--A) / -2);animation:kin .4s ease-out both}
@keyframes kin{from{transform:scale(.3);opacity:0}}
.ka{width:100%;height:100%;border-radius:50%;overflow:hidden;background:#2a2a30;color:#bbb;display:grid;place-items:center;font-weight:700;font-size:13px;box-shadow:0 0 0 2px rgba(255,255,255,.18);transition:box-shadow .25s}
.ka img{width:100%;height:100%;object-fit:cover}
.ka.hit{animation:khit .45s cubic-bezier(.3,1.6,.5,1)}
@keyframes khit{40%{transform:scale(1.28)}}
.ka.ok{box-shadow:0 0 0 3px #2fb344}
.ka.bad{box-shadow:0 0 0 3px #e5484d}
.kk{position:absolute;right:-4px;bottom:-4px;width:18px;height:18px;border-radius:50%;font-size:11px;font-weight:800;color:#fff;display:grid;place-items:center;transform:scale(0);transition:transform .3s cubic-bezier(.3,1.6,.5,1)}
.kk.ok{background:#2fb344;transform:scale(1)}
.kk.bad{background:#e5484d;transform:scale(1)}
.fly{position:absolute;left:50%;top:50%;width:30px;height:30px;margin:-15px 0 0 -15px;font-size:26px;line-height:30px;text-align:center;z-index:3;pointer-events:none;transition:transform .7s cubic-bezier(.25,.7,.35,1),opacity .25s}
.ktitle{color:#fff;font-size:19px;font-weight:700;margin-top:22px}
.ksub{color:rgba(255,255,255,.7);font-size:14px;margin-top:4px;min-height:1.3em}
@media (prefers-reduced-motion:reduce){.kpc,.kaw,.ka.hit{animation:none}}
#det{position:fixed;inset:0;z-index:45;background:rgba(0,0,0,.5);display:flex;align-items:flex-end}
#det[hidden]{display:none}
.detp{width:100%;max-height:92vh;background:var(--bg);border-radius:20px 20px 0 0;display:flex;flex-direction:column;overflow:hidden;animation:up .22s ease-out}
@keyframes up{from{transform:translateY(40px);opacity:.4}}
.deth{display:flex;align-items:center;gap:10px;padding:12px 14px;background:var(--card)}
.detwho{flex:1;display:flex;align-items:center;gap:10px;min-width:0}
.detwho .av{width:36px;height:36px}
.detwho b{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.deth .lbx{background:var(--soft);color:var(--fg)}
.detb{overflow-y:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;padding:12px}
.detmap{display:block;width:100%;border-radius:14px;margin-bottom:4px;background:var(--soft);max-height:46vh;object-fit:cover}
.detb .act{border-top:0;margin-top:0;padding:4px 2px 0}
.detb .photos img{height:170px;max-width:260px}
.detf{display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:10px 12px calc(10px + env(safe-area-inset-bottom));background:var(--card)}
.detf button{padding:11px 8px;font-size:14px}
.ttl{cursor:pointer}
#sendov{position:fixed;inset:0;z-index:70;background:rgba(0,0,0,.8);display:grid;place-items:center;touch-action:none;padding:20px}
#sendov[hidden]{display:none}
.sv{width:min(330px,100%);background:var(--card);border-radius:24px;padding:20px 18px 22px;text-align:center;box-shadow:0 24px 60px rgba(0,0,0,.45)}
.stage{position:relative;width:280px;height:130px;margin:0 auto 8px}
.arc{position:absolute;inset:0;width:280px;height:130px;overflow:visible}
.arc path{fill:none;stroke:var(--line);stroke-width:2.5;stroke-linecap:round;stroke-dasharray:3 8;animation:ants .7s linear infinite}
@keyframes ants{to{stroke-dashoffset:-22}}
.me,.them{position:absolute;top:37px;width:56px;height:56px;border-radius:50%;background:var(--soft);display:grid;place-items:center;overflow:hidden}
.me{left:6px;font-size:26px;animation:scribble 1.9s ease-in-out infinite}
.them{left:218px;font-weight:700;color:var(--mut);font-size:18px;box-shadow:0 0 0 3px var(--card),0 0 0 5px var(--accent);animation:catch 1.9s ease-in-out infinite}
.them img{width:100%;height:100%;object-fit:cover}
.plane{position:absolute;left:0;top:0;width:30px;height:30px;font-size:26px;line-height:30px;animation:fly 1.9s ease-in-out infinite;will-change:transform}
@keyframes fly{
  0%{transform:translate(47px,50px) rotate(-35deg) scale(.5);opacity:0}
  10%{opacity:1}
  25%{transform:translate(86px,24px) rotate(-18deg) scale(.9)}
  50%{transform:translate(125px,15px) rotate(0) scale(1.1)}
  75%{transform:translate(164px,24px) rotate(18deg) scale(.9)}
  92%{opacity:1}
  100%{transform:translate(203px,50px) rotate(35deg) scale(.4);opacity:0}}
@keyframes catch{0%,82%{transform:scale(1)}90%{transform:scale(1.14)}100%{transform:scale(1)}}
@keyframes scribble{0%,100%{transform:rotate(0)}10%{transform:rotate(-12deg)}20%{transform:rotate(8deg)}30%{transform:rotate(0)}}
.chk{position:absolute;left:252px;top:28px;width:28px;height:28px;border-radius:50%;background:#2fb344;color:#fff;font-weight:800;font-size:16px;display:grid;place-items:center;transform:scale(0)}
.bit{position:absolute;left:236px;top:55px;font-size:18px;pointer-events:none;animation:pop .95s ease-out forwards}
@keyframes pop{0%{transform:translate(0,0) scale(.3);opacity:1}100%{transform:translate(var(--dx),var(--dy)) scale(1.1);opacity:0}}
#sendov.ok .plane{display:none}
#sendov.ok .them{animation:landed .6s cubic-bezier(.3,1.6,.5,1)}
#sendov.ok .chk{animation:chk .45s .15s cubic-bezier(.3,1.6,.5,1) forwards}
#sendov.ok .arc path,#sendov.fail .arc path{animation:none;stroke:var(--soft)}
#sendov.ok .me,#sendov.fail .me,#sendov.fail .them{animation:none}
@keyframes landed{0%{transform:scale(1)}40%{transform:scale(1.25)}100%{transform:scale(1)}}
@keyframes chk{to{transform:scale(1)}}
#sendov.fail .plane{animation:fall .9s ease-in forwards}
@keyframes fall{0%{transform:translate(125px,15px) rotate(0);opacity:1}100%{transform:translate(140px,110px) rotate(150deg);opacity:0}}
.svt{font-size:18px;font-weight:700;margin-top:4px}
.svs{color:var(--mut);font-size:14px;margin-top:4px;min-height:2.6em}
.svq{margin:10px 0 0;font-size:14px;font-style:italic;color:var(--fg);opacity:.85;word-break:break-word}
.svok{margin-top:14px;min-width:120px}
@media (prefers-reduced-motion:reduce){
  .plane{animation:none;transform:translate(125px,15px)}
  .me,.them,.arc path{animation:none}
  .bit{display:none}}
#sheet{position:fixed;inset:0;z-index:40;background:rgba(0,0,0,.45);display:flex;align-items:flex-end}
#sheet[hidden]{display:none}
.shc{width:100%;background:var(--card);border-radius:18px 18px 0 0;padding:14px 14px calc(14px + env(safe-area-inset-bottom));display:grid;gap:8px}
.shc button{padding:13px}
.lbtop{display:flex;justify-content:space-between;align-items:center;padding:10px 14px;color:#fff;font-size:14px;font-variant-numeric:tabular-nums;min-height:58px}
.lbx{background:rgba(255,255,255,.18);color:#fff;width:38px;height:38px;padding:0;font-size:16px}
.lbs{flex:1;min-height:0;display:flex;overflow-x:auto;overflow-y:hidden;scroll-snap-type:x mandatory;scrollbar-width:none;-webkit-overflow-scrolling:touch;touch-action:pan-x;overscroll-behavior-x:contain}
.lbs::-webkit-scrollbar{display:none}
.lbi{flex:0 0 100%;height:100%;display:grid;place-items:center;scroll-snap-align:center;scroll-snap-stop:always;padding:0 6px 150px;overflow:hidden}
.lbi img{max-width:100%;max-height:100%;object-fit:contain;border-radius:6px;transform-origin:center center;will-change:transform;-webkit-user-select:none;user-select:none;-webkit-user-drag:none;pointer-events:none}
.lbbot{position:absolute;left:0;right:0;bottom:0;display:flex;flex-direction:column;align-items:center;gap:8px;padding:10px 0 calc(18px + env(safe-area-inset-bottom,0px));pointer-events:none;background:linear-gradient(transparent,rgba(0,0,0,.7))}
.lbthumbs{pointer-events:auto;display:flex;gap:6px;max-width:100%;overflow-x:auto;padding:4px 16px;scrollbar-width:none;scroll-behavior:smooth}
.lbthumbs::-webkit-scrollbar{display:none}
.lbthumbs:empty{display:none}
.lbthumbs button{flex:none;width:52px;height:52px;padding:0;border-radius:10px;overflow:hidden;background:#222;opacity:.5;outline:2px solid transparent;outline-offset:-2px;transition:opacity .2s,outline-color .2s,transform .2s}
.lbthumbs button.on{opacity:1;outline-color:#fff;transform:scale(1.08)}
.lbthumbs img{width:100%;height:100%;object-fit:cover;display:block;pointer-events:none}
.lbclose{pointer-events:auto;background:#fff;color:#111;font-size:16px;font-weight:700;padding:12px 28px;box-shadow:0 6px 20px rgba(0,0,0,.45)}
.lbhint{color:rgba(255,255,255,.6);font-size:12px;transition:opacity .3s}
#lb.zoomed .lbhint{opacity:0}
.photos img{height:132px;max-width:220px;border-radius:12px;flex:none;object-fit:cover;scroll-snap-align:start;background:var(--soft)}
.bar{display:flex;align-items:center;gap:6px;margin-top:12px}
.counts{flex:1;color:var(--mut);font-size:13px}.counts i{font-style:normal;font-variant-numeric:tabular-nums}
.cbox{margin-top:8px}.cbox[hidden]{display:none}
.crow{display:flex;gap:6px;align-items:flex-end}
.ai{display:flex;gap:6px;align-items:center;margin-top:8px}
.lng{background:transparent;color:var(--mut);padding:6px 10px;border:1px solid var(--line)}
.lng.on{background:var(--soft);color:var(--fg);border-color:var(--soft)}
.sugs{display:flex;flex-direction:column;gap:6px;margin-top:8px}
.sug{background:var(--soft);color:var(--fg);font-weight:500;text-align:left;border-radius:14px;padding:9px 12px;line-height:1.35}
.keyrow{display:flex;gap:6px}.keyrow input{flex:1;min-width:0;font:inherit;border-radius:12px;border:1px solid var(--line);background:var(--bg);color:var(--fg);padding:8px 10px}
.keyhelp{font-size:12px;color:var(--mut);margin:0}
textarea{flex:1;font:inherit;border-radius:14px;border:1px solid var(--line);background:var(--bg);color:var(--fg);padding:8px 10px;resize:none}
.center{text-align:center;color:var(--mut);padding:80px 20px}
.spin{width:28px;height:28px;border:3px solid var(--line);border-top-color:var(--accent);border-radius:50%;margin:0 auto 14px;animation:s 1s linear infinite}
@keyframes s{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.spin{animation-duration:3s}}
#toast{position:fixed;left:50%;bottom:calc(20px + env(safe-area-inset-bottom));z-index:80;transform:translate(-50%,calc(100% + 60px));opacity:0;visibility:hidden;background:var(--fg);color:var(--bg);padding:10px 16px;border-radius:18px;font-size:14px;text-align:center;max-width:90vw;pointer-events:none;transition:transform .25s,opacity .25s,visibility 0s linear .25s}
#toast.on{transform:translate(-50%,0);opacity:1;visibility:visible;transition:transform .25s,opacity .25s}
body.loading .person{opacity:.45}
</style></head><body>
${content}
<div id="sendov" hidden role="status" aria-live="polite"><div class="sv">
  <div class="stage">
    <svg class="arc" viewBox="0 0 280 130" aria-hidden="true"><path d="M62 65 Q140 -5 218 65"/></svg>
    <div class="me" aria-hidden="true">✍️</div>
    <div class="plane" aria-hidden="true">💬</div>
    <div class="them" aria-hidden="true"></div>
    <div class="chk" aria-hidden="true">✓</div>
  </div>
  <div class="svt"></div>
  <div class="svs"></div>
  <p class="svq"></p>
  <button class="svok" data-act="send-close" hidden>OK</button>
</div></div>
<div id="det" hidden><div class="detp" role="dialog" aria-label="Activity details">
  <div class="deth"><div class="detwho"></div><button class="lbx" data-act="det-close" aria-label="Close">✕</button></div>
  <div class="detb"></div>
  <div class="detf"><button data-act="det-app">Open in Strava app</button><button class="ghost" data-act="det-web">Strava website</button></div>
</div></div>
<div id="sheet" hidden><div class="shc">
  <button data-act="open-here">View here</button>
  <button class="ghost" data-act="open-app">Open in Strava app</button>
  <button class="ghost" data-act="sheet-close">Cancel</button>
</div></div>
<div id="lb" hidden><div class="lbtop"><span id="lbc"></span><button class="lbx" data-act="lb-close" aria-label="Close photos">✕</button></div><div class="lbs"></div><div class="lbbot"><div class="lbthumbs" aria-label="All photos"></div><span class="lbhint">Swipe for more, double-tap or pinch to zoom</span><button class="lbclose" data-act="lb-close">✕ Close photo</button></div></div>
<div id="kov" hidden role="status" aria-live="polite"><div class="kwrap">
  <div class="kst"><div class="kpc" aria-hidden="true">👍</div></div>
  <div class="ktitle"></div><div class="ksub"></div>
</div></div>
<div id="toast"></div>
<script>
['gesturestart','gesturechange','gestureend'].forEach(function(n){ document.addEventListener(n,function(e){ e.preventDefault(); },{passive:false}); });
var lastTouchEnd=0;
document.addEventListener('touchend',function(e){ var now=Date.now(); if(now-lastTouchEnd<300&&!e.target.closest('textarea,input')) e.preventDefault(); lastTouchEnd=now; },{passive:false});
var q=[],pending={},busy=false,armed=false;
document.addEventListener('click',function(e){ if(e.target.id==='sheet') e.target.hidden=true; });
function send(action,params,cb){
  var req='r'+Date.now().toString(36)+Math.random().toString(36).slice(2,6);
  pending[req]=cb||function(){};
  var p=Object.assign({req:req},params||{});
  var qs=Object.keys(p).map(function(k){return k+'='+encodeURIComponent(p[k]);}).join('&');
  q.push('${SCHEME}'+action+'?'+qs); pump();
}
function pump(){ if(busy||!q.length) return; busy=true; location.href=q.shift(); setTimeout(function(){busy=false;pump();},300); }
var aiLang=document.querySelector('.lng.on')?document.querySelector('.lng.on').dataset.lang:'';
function suggest(btn){
  if(btn.disabled) return;
  var box=btn.closest('.cbox'), sugs=box.querySelector('.sugs'), ta=box.querySelector('textarea');
  btn.disabled=true; btn.dataset.busy='1'; btn.textContent='✨ Thinking…';
  send('suggest',{id:btn.dataset.suggest,lang:aiLang,hint:ta.value.trim()},function(ok,msg){
    btn.disabled=false; delete btn.dataset.busy; btn.textContent='✨ More';
    sugs.innerHTML='';
    if(!ok&&msg==='NEED_KEY'){
      sugs.innerHTML='<p class="keyhelp">Paste your OpenAI API key once. It stays in this phone\u2019s Keychain and is only sent to OpenAI.</p><div class="keyrow"><input type="password" autocomplete="off" placeholder="sk-..."><button data-savekey>Save</button></div>';
      btn.textContent='✨ Suggest'; return;
    }
    if(!ok){ toast('Suggestions failed: '+(msg||'unknown error')); return; }
    var list=[]; try{ list=JSON.parse(msg); }catch(e){}
    list.forEach(function(c){ var b=document.createElement('button'); b.className='sug'; b.dataset.sug=''; b.textContent=c; sugs.appendChild(b); });
  });
}
window.__done=function(req,ok,msg){ var cb=pending[req]; delete pending[req]; if(cb) cb(ok,msg); };
window.__patchPerson=function(pid,html){
  var old=document.querySelector('section.person[data-pid="'+CSS.escape(pid)+'"]'); if(!old) return;
  if(old.querySelector('.cbox:not([hidden])')||old.querySelector('[data-busy]')||old.contains(document.activeElement)) return;
  var t=document.createElement('template'); t.innerHTML=html.trim(); old.replaceWith(t.content.firstElementChild);
};
window.__patchSummary=function(text){ var el=document.querySelector('.top .sub'); if(el) el.textContent=text; };
window.setStatus=function(s){ var el=document.getElementById('st'); if(el) el.textContent=s; };
function toast(t){ var el=document.getElementById('toast'); el.textContent=t; el.classList.add('on'); clearTimeout(el._t); el._t=setTimeout(function(){el.classList.remove('on');},2400); }
function hideToast(){ var el=document.getElementById('toast'); clearTimeout(el._t); el.classList.remove('on'); }
function markKudo(id,pid){
  document.querySelectorAll('[data-kudo="'+CSS.escape(id)+'"]').forEach(function(b){ b.classList.add('done'); b.disabled=true; b.textContent=b.classList.contains('small')?'✓':'✓ Kudos given'; });
  document.querySelectorAll('.act[data-id="'+CSS.escape(id)+'"] .kc').forEach(function(kc){ kc.textContent=(+kc.textContent||0)+1; });
  var pb=document.querySelector('.person-k[data-pid="'+CSS.escape(pid)+'"]'); if(pb){ pb.classList.add('done'); pb.disabled=true; pb.textContent='✓ Kudos given'; }
  setTimeout(updAll,0);
  var sec=document.querySelector('section.person[data-pid="'+CSS.escape(pid)+'"]');
  if(sec&&!sec.dataset.counted){ sec.dataset.counted='1';
    var t=document.querySelector('.sec.todo span'); if(t) t.textContent=Math.max(0,(+t.textContent||0)-1);
    var g=document.querySelector('.sec.given span'); if(g) g.textContent=(+g.textContent||0)+1; }
}
function kudo(btn, done){
  if(btn.disabled){ if(typeof done==='function') done(btn.classList.contains('done')); return; }
  var id=btn.dataset.kudo,pid=btn.dataset.pid,old=btn.textContent;
  btn.disabled=true; btn.textContent='…'; btn.dataset.busy='1';
  send('kudo',{id:id},function(ok,msg){
    delete btn.dataset.busy; setTimeout(updAll,0);
    if(ok) markKudo(id,pid);
    else { btn.disabled=false; btn.textContent=old; if(typeof done!=='function') toast('Kudos not sent: '+(msg||'unknown error')); }
    if(typeof done==='function') done(ok);
  });
}
function kudoAll(btn){
  var list=[].slice.call(document.querySelectorAll('section.person .person-k:not(.done)'));
  if(!list.length){ toast('Everyone already has kudos'); updAll(); return; }
  if(!armed){ armed=true; btn.classList.add('armed'); btn.textContent='Send '+list.length+'?';
    toast('Tap again to give '+list.length+' kudos, one each');
    setTimeout(function(){ if(!armed) return; armed=false; btn.classList.remove('armed'); updAll(); },4000); return; }
  armed=false; btn.classList.remove('armed'); btn.disabled=true; btn.textContent='Sending…';
  hideToast();
  kudosParty(list.map(function(b){ var sec=b.closest('section.person'); return { btn:b, av:sec?sec.querySelector('.av'):null }; }));
}

// ── kudos to everyone: thumbs fly from the centre to each athlete arranged in a circle ──
function kudosParty(items){
  var ov=document.getElementById('kov'), st=ov.querySelector('.kst'), n=items.length;
  var S=Math.round(Math.min(window.innerWidth*0.86,340)), A=n>16?32:n>10?40:50, R=S/2-A/2-6;
  st.style.width=S+'px'; st.style.height=S+'px'; st.style.setProperty('--A',A+'px');
  [].slice.call(st.querySelectorAll('.kaw,.fly')).forEach(function(x){ x.remove(); });
  var title=ov.querySelector('.ktitle'), sub=ov.querySelector('.ksub');
  title.textContent='Sending kudos to '+n+'…'; sub.textContent='One each, nobody gets spammed';
  ov.classList.remove('fin'); ov.hidden=false; lockScreen(true);
  var reduce=window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches;
  var nodes=items.map(function(it,i){
    var ang=-Math.PI/2+i*2*Math.PI/n, x=S/2+R*Math.cos(ang), y=S/2+R*Math.sin(ang);
    var w=document.createElement('div'); w.className='kaw'; w.style.left=x+'px'; w.style.top=y+'px';
    w.style.animationDelay=(i*40)+'ms';
    var a=document.createElement('div'); a.className='ka';
    if(it.av&&it.av.tagName==='IMG'){ var im=document.createElement('img'); im.src=it.av.src; im.alt=''; a.appendChild(im); }
    else a.textContent=it.av?it.av.textContent:'?';
    var b=document.createElement('span'); b.className='kk';
    w.appendChild(a); w.appendChild(b); st.appendChild(w);
    return {a:a,b:b,x:x-S/2,y:y-S/2};
  });
  var done=0, okc=0, gap=Math.min(320,2600/Math.max(1,n)), t0=Date.now();
  items.forEach(function(it,i){
    var nd=nodes[i];
    if(!reduce) setTimeout(function(){
      var f=document.createElement('div'); f.className='fly'; f.textContent='👍'; st.appendChild(f);
      requestAnimationFrame(function(){ requestAnimationFrame(function(){
        f.style.transform='translate('+nd.x+'px,'+nd.y+'px) scale(.75) rotate('+(i%2?16:-16)+'deg)';
      }); });
      setTimeout(function(){ f.style.opacity='0'; nd.a.classList.remove('hit'); void nd.a.offsetWidth; nd.a.classList.add('hit'); setTimeout(function(){ f.remove(); },260); },700);
    }, 250+i*gap);
    kudo(it.btn,function(ok){
      done++; if(ok) okc++;
      nd.a.classList.add(ok?'ok':'bad'); nd.b.textContent=ok?'✓':'!'; nd.b.className='kk '+(ok?'ok':'bad');
      if(done===n){
        var wait=reduce?0:Math.max(0,250+n*gap+700-Date.now()+t0);
        setTimeout(function(){
          title.textContent=okc===n?('Kudos sent to '+n+'! 🎉'):(okc+' of '+n+' kudos sent');
          sub.textContent=okc===n?'Everyone just got a little boost':'The rest are still waiting on their cards';
          ov.classList.add('fin'); setTimeout(closeParty,1900);
        },wait);
      }
    });
  });
}
function closeParty(){ var ov=document.getElementById('kov'); if(ov.hidden) return; ov.hidden=true; ov.classList.remove('fin'); lockScreen(false); updAll(); }
document.addEventListener('click',function(e){ if(e.target.closest&&e.target.closest('#kov')) closeParty(); });
function updAll(){
  var btn=document.querySelector('.allk'); if(!btn||armed) return;
  if(document.querySelector('section.person .person-k[data-busy]')) return;   // still sending
  var n=document.querySelectorAll('section.person .person-k:not(.done)').length;
  if(n>0){ btn.classList.remove('done'); btn.disabled=false; btn.textContent='👍 All '+n; btn.dataset.label=btn.textContent; }
  else { btn.classList.add('done'); btn.disabled=true; btn.textContent='✓ All'; }
}
// ── "comment in flight" overlay: locks the screen until Strava answers ──
function blockMove(e){ e.preventDefault(); }
function lockScreen(on){
  if(on){ document.addEventListener('touchmove',blockMove,{passive:false}); document.documentElement.style.overflow='hidden'; document.body.style.overflow='hidden'; }
  else { document.removeEventListener('touchmove',blockMove,{passive:false}); document.documentElement.style.overflow=''; document.body.style.overflow=''; }
}
function closeSending(){ var ov=document.getElementById('sendov'); ov.hidden=true; ov.className=''; lockScreen(false); }
function burst(stage){
  var bits=['🎉','✨','👏','💥','⭐','🏅'];
  for(var i=0;i<16;i++){
    var s=document.createElement('span'); s.className='bit'; s.textContent=bits[i%bits.length];
    var ang=(Math.PI*2*i/16)+Math.random()*0.4, dist=50+Math.random()*45;
    s.style.setProperty('--dx',Math.round(Math.cos(ang)*dist)+'px'); s.style.setProperty('--dy',Math.round(Math.sin(ang)*dist)+'px');
    s.style.animationDelay=(Math.random()*0.12)+'s';
    stage.appendChild(s); setTimeout(function(x){ return function(){ x.remove(); }; }(s),1400);
  }
}
function showSending(person,text){
  var ov=document.getElementById('sendov'), them=ov.querySelector('.them');
  var nameEl=person?person.querySelector('.pn b'):null;
  var name=((nameEl&&nameEl.firstChild?nameEl.firstChild.textContent:'')||'').trim().split(' ').filter(Boolean)[0]||'your friend';
  var av=person?person.querySelector('.av'):null;
  them.innerHTML='';
  if(av&&av.tagName==='IMG'){ var im=document.createElement('img'); im.src=av.src; im.alt=''; them.appendChild(im); }
  else them.textContent=av?av.textContent:'?';
  var quote=text.length>70?text.slice(0,67)+'…':text;
  ov.querySelector('.svq').textContent='“'+quote+'”';
  var ttl=ov.querySelector('.svt'), sub=ov.querySelector('.svs'), okb=ov.querySelector('.svok');
  var msgs=['Folding your comment into a paper plane','Dodging runners on the bike path','Holding race pace for the last 100 m','Knocking on '+name+'’s feed','Almost there, '+name+' is still stretching','Asking the segment leaderboard for directions'];
  var i=0; ttl.textContent='Sending to '+name+'…'; sub.textContent=msgs[0]; okb.hidden=true;
  var timer=setInterval(function(){ i=(i+1)%msgs.length; sub.textContent=msgs[i]; },1900);
  ov.className=''; ov.hidden=false; lockScreen(true);
  return { finish:function(ok,msg){
    clearInterval(timer);
    if(ok){
      ov.classList.add('ok'); ttl.textContent='Delivered to '+name+'!'; sub.textContent='Your comment landed right on target 🎯';
      burst(ov.querySelector('.stage')); setTimeout(closeSending,1900);
    } else {
      ov.classList.add('fail'); ttl.textContent='Your comment didn’t make it'; sub.textContent=(msg||'Unknown error')+'. Check the activity in Strava before trying again.';
      okb.hidden=false;
    }
  } };
}
// ── boot screen: runner collecting posts, counter ticking up to the real number ──
var cntShown=0,cntTarget=0,cntRaf=0;
window.setCount=function(n){
  var el=document.getElementById('cnt'); if(!el) return;
  cntTarget=Math.max(cntTarget,n||0); cancelAnimationFrame(cntRaf);
  var from=cntShown, t0=performance.now(), dur=Math.min(1200,300+(cntTarget-from)*25);
  var wrap=el.parentNode; wrap.classList.remove('tick'); void wrap.offsetWidth; wrap.classList.add('tick');
  (function step(now){ var k=Math.min(1,(now-t0)/dur); k=1-Math.pow(1-k,3);
    cntShown=Math.round(from+(cntTarget-from)*k); el.textContent=cntShown;
    if(k<1) cntRaf=requestAnimationFrame(step); })(t0);
  var pile=document.querySelector('.pile');
  if(pile){ var want=Math.min(14,Math.ceil(cntTarget/6)); while(pile.children.length<want) pile.appendChild(document.createElement('i')); }
};
(function(){
  var scene=document.querySelector('.scene'); if(!scene) return;
  var quips=['Lacing up your feed','Counting who ran before breakfast','Stretching the scroll muscles','Sorting the kudos-hungry','Drafting behind the 5 AM club','Hydrating the feed','Skipping the warm-up, grabbing posts','Checking who beat their PR'];
  var qi=0, q=document.getElementById('quip');
  setInterval(function(){ qi=(qi+1)%quips.length; q.style.opacity=0; setTimeout(function(){ q.textContent=quips[qi]; q.style.opacity=1; },250); },1700);
  if(window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  setInterval(function(){
    var p=document.createElement('div'); p.className='post';
    p.style.setProperty('--y',(20+Math.random()*50)+'px');
    scene.appendChild(p);
    setTimeout(function(){ p.remove(); var pile=document.querySelector('.pile'); if(pile){ pile.classList.remove('bump'); void pile.offsetWidth; pile.classList.add('bump'); } },1300);
  },420);
})();
// ── pull down at the top of the digest to refresh ──
(function(){
  if(!document.querySelector('.hdr .seg')) return;
  var ptr=document.createElement('div'); ptr.id='ptr'; ptr.setAttribute('aria-hidden','true');
  ptr.innerHTML='<span class="ptri">↓</span><span class="ptrt">Pull to refresh</span>';
  document.body.appendChild(ptr);
  var icon=ptr.querySelector('.ptri'), label=ptr.querySelector('.ptrt');
  var y0=null, x0=0, dist=0, armed=false, TH=75;
  function overlayOpen(){ return ['lb','sendov','sheet','det'].some(function(id){ var el=document.getElementById(id); return el&&!el.hidden; }); }
  function reset(){ y0=null; dist=0; armed=false; ptr.classList.remove('ready'); ptr.style.transform=''; ptr.style.opacity=0; icon.style.transform=''; label.textContent='Pull to refresh'; }
  document.addEventListener('touchstart',function(e){
    if(window.scrollY>0||overlayOpen()||document.body.classList.contains('loading')||e.target.closest('.hdr,.photos,textarea,input')){ y0=null; return; }
    y0=e.touches[0].clientY; x0=e.touches[0].clientX; dist=0;
  },{passive:true});
  document.addEventListener('touchmove',function(e){
    if(y0==null) return;
    var dy=e.touches[0].clientY-y0, dx=Math.abs(e.touches[0].clientX-x0);
    if(window.scrollY>0||dy<=0||dx>dy){ reset(); return; }
    dist=Math.min(150,dy*0.6);
    var p=Math.min(1,dist/TH);
    ptr.style.transform='translate(-50%,'+Math.round(dist-50)+'px)'; ptr.style.opacity=Math.min(1,p*1.3);
    icon.style.transform='rotate('+Math.round(p*180)+'deg)';
    var ready=dist>=TH;
    if(ready!==armed){ armed=ready; ptr.classList.toggle('ready',armed); label.textContent=armed?'Release to refresh':'Pull to refresh'; }
  },{passive:true});
  document.addEventListener('touchend',function(){
    if(y0==null) return;
    y0=null;
    if(!armed){ reset(); return; }
    armed=false; ptr.classList.remove('ready'); ptr.classList.add('busy');
    icon.style.transform=''; icon.textContent='↻'; label.textContent='Refreshing…';
    ptr.style.transform='translate(-50%,18px)'; ptr.style.opacity=1;
    document.body.classList.add('loading');
    send('refresh',{});
  },{passive:true});
})();
// ── activity details sheet: everything the digest knows, without leaving it ──
function openDetail(id){
  var art=document.querySelector('section.person .act[data-id="'+CSS.escape(id)+'"]');
  if(!art) return;
  var det=document.getElementById('det'), body=det.querySelector('.detb'), who=det.querySelector('.detwho');
  var person=art.closest('section.person');
  det.dataset.id=id; det.dataset.pid=person?person.dataset.pid:'';
  who.innerHTML='';
  if(person){
    var av=person.querySelector('.av'); if(av) who.appendChild(av.cloneNode(true));
    var nm=document.createElement('b'); nm.textContent=(person.querySelector('.pn b').firstChild||{}).textContent||''; who.appendChild(nm);
  }
  body.innerHTML='';
  if(art.dataset.map){ var m=document.createElement('img'); m.className='detmap'; m.src=art.dataset.map; m.alt='Route map'; m.onerror=function(){ m.remove(); }; body.appendChild(m); }
  var c=art.cloneNode(true); c.querySelectorAll('[data-detail]').forEach(function(x){ if(x.tagName==='BUTTON') x.remove(); else x.removeAttribute('data-detail'); });
  var cb=c.querySelector('.cbox'); if(cb){ cb.hidden=true; var ta=cb.querySelector('textarea'); if(ta) ta.value=''; var sg=cb.querySelector('.sugs'); if(sg) sg.innerHTML=''; }
  body.appendChild(c);
  det.hidden=false; document.body.style.overflow='hidden'; body.scrollTop=0;
}
// ── update pitch ──
window.__showUpdate=function(u){
  if(!u||document.getElementById('upd')) return;
  var ov=document.createElement('div'); ov.id='upd';
  var hl=(u.highlights||[]).map(function(h){
    return '<div class="updi"><span class="updic">'+escH(h.icon||'✨')+'</span><div><b>'+escH(h.title)+'</b><span>'+escH(h.text||'')+'</span></div></div>';
  }).join('');
  var since=u.skipped>1?' (and '+(u.skipped-1)+' more update'+(u.skipped>2?'s':'')+')':'';
  ov.innerHTML='<div class="updp" role="dialog" aria-label="Update available">'+
    '<div class="updtag">New version '+escH(u.latest)+'</div>'+
    '<h2 class="updt">'+escH(u.title||'An update is ready')+'</h2>'+
    '<div class="upds">You have '+escH(u.current)+since+'. Here’s what you get:</div>'+
    '<div class="updl">'+hl+'</div>'+
    '<div class="updmsg" aria-live="polite"></div>'+
    '<button class="updgo" data-act="upd-now">Update now</button>'+
    '<button class="ghost updlater" data-act="upd-later">Later, remind me in 2 days</button></div>';
  document.body.appendChild(ov);
  ov.addEventListener('click',function(e){ if(e.target===ov) updLater(); });
};
function escH(t){ var d=document.createElement('div'); d.textContent=String(t==null?'':t); return d.innerHTML; }
function updLater(){ var ov=document.getElementById('upd'); if(!ov) return; ov.remove(); send('update-later',{}); }
function updNow(btn){
  var ov=document.getElementById('upd'), msg=ov.querySelector('.updmsg'), later=ov.querySelector('.updlater');
  btn.disabled=true; btn.textContent='Updating…'; later.hidden=true; msg.textContent='';
  send('update-now',{},function(ok,res){
    if(ok){
      ov.querySelector('.updtag').textContent='Updated to '+res;
      msg.innerHTML='<b>✓ Done.</b> Close the digest and open it again to start using the new version.';
      btn.disabled=false; btn.textContent='Got it'; btn.dataset.act='upd-close';
    } else {
      msg.textContent=res||'Update failed'; btn.disabled=false; btn.textContent='Try again'; later.hidden=false;
    }
  });
}
function closeDetail(){ var det=document.getElementById('det'); det.hidden=true; det.querySelector('.detb').innerHTML=''; document.body.style.overflow=''; }
document.addEventListener('click',function(e){ if(e.target.id==='det') closeDetail(); });
(function(){
  var hdr=document.querySelector('.hdr'); if(!hdr) return;
  function upd(){ hdr.classList.toggle('stuck', window.scrollY>4); }
  window.addEventListener('scroll',upd,{passive:true}); upd();
})();
var lbN=0;
function lbIndex(){ var sc=document.querySelector('#lb .lbs'); return Math.max(0,Math.min(lbN-1,Math.round(sc.scrollLeft/Math.max(1,sc.clientWidth)))); }
function lbCount(){
  var i=lbIndex(); document.getElementById('lbc').textContent=lbN>1?(i+1)+' / '+lbN:'';
  var strip=document.querySelector('#lb .lbthumbs'), on=null;
  [].forEach.call(strip.children,function(b,k){ b.classList.toggle('on',k===i); if(k===i) on=b; });
  if(on){ var want=on.offsetLeft-(strip.clientWidth-on.offsetWidth)/2; if(Math.abs(strip.scrollLeft-want)>4) strip.scrollLeft=want; }
}
function lbGo(i){
  var sc=document.querySelector('#lb .lbs'); zReset(false);
  sc.scrollTo({left:i*sc.clientWidth,behavior:'smooth'});
}
function openPhotos(img){
  var imgs=[].slice.call(img.closest('.photos').querySelectorAll('img'));
  var i=Math.max(0,imgs.indexOf(img)), lb=document.getElementById('lb'), sc=lb.querySelector('.lbs');
  sc.innerHTML='';
  imgs.forEach(function(x){ var d=document.createElement('div'); d.className='lbi'; var im=document.createElement('img'); im.src=x.src; im.alt='Activity photo'; d.appendChild(im); sc.appendChild(d); });
  Z.img=null; Z.s=1; Z.x=0; Z.y=0; lb.classList.remove('zoomed'); sc.style.overflowX='';
  var strip=lb.querySelector('.lbthumbs'); strip.innerHTML='';
  if(imgs.length>1) imgs.forEach(function(x,k){ var b=document.createElement('button'); b.dataset.lbi=k; b.setAttribute('aria-label','Photo '+(k+1)); var im=document.createElement('img'); im.src=x.src; im.alt=''; b.appendChild(im); strip.appendChild(b); });
  lbN=imgs.length; lb.hidden=false; document.body.style.overflow='hidden';
  sc.scrollLeft=i*sc.clientWidth; requestAnimationFrame(function(){ sc.scrollLeft=i*sc.clientWidth; lbCount(); });
}
function closePhotos(){ zReset(false); Z.img=null; document.getElementById('lb').hidden=true; document.body.style.overflow=''; }
// ── photo zoom: pinch, double-tap, and drag while zoomed ──
var Z={s:1,x:0,y:0,img:null};
function zSc(){ return document.querySelector('#lb .lbs'); }
function zCurrent(){ var sc=zSc(); var i=Math.round(sc.scrollLeft/Math.max(1,sc.clientWidth)); return sc.querySelectorAll('.lbi img')[i]||null; }
function zApply(anim){
  if(!Z.img) return;
  Z.img.style.transition=anim?'transform .22s ease-out':'none';
  Z.img.style.transform='translate('+Z.x+'px,'+Z.y+'px) scale('+Z.s+')';
  var zoomed=Z.s>1.01; zSc().style.overflowX=zoomed?'hidden':''; document.getElementById('lb').classList.toggle('zoomed',zoomed);
}
function zClamp(){ if(!Z.img) return; var mx=(Z.s-1)*Z.img.clientWidth/2, my=(Z.s-1)*Z.img.clientHeight/2; Z.x=Math.max(-mx,Math.min(mx,Z.x)); Z.y=Math.max(-my,Math.min(my,Z.y)); }
function zReset(anim){ Z.s=1; Z.x=0; Z.y=0; zApply(anim); }
function zToggleAt(px,py){
  Z.img=zCurrent(); if(!Z.img) return;
  if(Z.s>1.01){ zReset(true); return; }
  var r=Z.img.getBoundingClientRect(), cx=r.left+r.width/2, cy=r.top+r.height/2, s=2.5;
  Z.s=s; Z.x=(px-cx)*(1-s); Z.y=(py-cy)*(1-s); zClamp(); zApply(true);
}
(function(){
  var lb=document.getElementById('lb'), sc=lb.querySelector('.lbs');
  var P=null, T=null, pinched=false, lastTap=0, lastX=0, lastY=0;
  sc.addEventListener('scroll',function(){ lbCount(); if(Z.img&&Z.s>1.01&&zCurrent()!==Z.img) zReset(false); },{passive:true});
  sc.addEventListener('touchstart',function(e){
    Z.img=zCurrent(); if(!Z.img) return;
    if(e.touches.length===2){
      var a=e.touches[0], b=e.touches[1], r=Z.img.getBoundingClientRect();
      P={d0:Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY)||1, s0:Z.s, x0:Z.x, y0:Z.y,
         cx:r.left+r.width/2-Z.x, cy:r.top+r.height/2-Z.y, mx:(a.clientX+b.clientX)/2, my:(a.clientY+b.clientY)/2};
      pinched=true; T=null;
    } else if(e.touches.length===1){
      var t=e.touches[0]; T={x:t.clientX,y:t.clientY,x0:Z.x,y0:Z.y,moved:false}; pinched=false;
    }
  },{passive:true});
  sc.addEventListener('touchmove',function(e){
    if(P&&e.touches.length===2){
      e.preventDefault();
      var a=e.touches[0], b=e.touches[1], d=Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY);
      var s=Math.max(1,Math.min(4,P.s0*d/P.d0)), mx=(a.clientX+b.clientX)/2, my=(a.clientY+b.clientY)/2;
      var px=(P.mx-P.cx-P.x0)/P.s0, py=(P.my-P.cy-P.y0)/P.s0;
      Z.s=s; Z.x=mx-P.cx-s*px; Z.y=my-P.cy-s*py; zClamp(); zApply(false); return;
    }
    if(T&&e.touches.length===1){
      var t=e.touches[0], dx=t.clientX-T.x, dy=t.clientY-T.y;
      if(Math.abs(dx)>8||Math.abs(dy)>8) T.moved=true;
      if(Z.s>1.01){ e.preventDefault(); Z.x=T.x0+dx; Z.y=T.y0+dy; zClamp(); zApply(false); }
    }
  },{passive:false});
  sc.addEventListener('touchend',function(e){
    if(P){ if(e.touches.length<2){ P=null; if(Z.s<1.05) zReset(true); } return; }
    if(!T) return;
    var t=e.changedTouches[0], now=Date.now(), dy=t.clientY-T.y, dx=t.clientX-T.x;
    if(!T.moved&&!pinched){
      if(now-lastTap<300&&Math.abs(t.clientX-lastX)<30&&Math.abs(t.clientY-lastY)<30){ zToggleAt(t.clientX,t.clientY); lastTap=0; }
      else { lastTap=now; lastX=t.clientX; lastY=t.clientY; }
    } else if(Z.s<=1.01&&!pinched&&dy>110&&Math.abs(dx)<60) closePhotos();   // swipe down closes when not zoomed
    T=null;
  },{passive:true});
  sc.addEventListener('dblclick',function(e){ zToggleAt(e.clientX,e.clientY); });
})();
document.addEventListener('click',function(e){
  var t=e.target.closest('button,[data-open],[data-photo],[data-athlete],[data-detail]'); if(!t) return;
  if(t.dataset.detail) return openDetail(t.dataset.detail);
  if(t.dataset.act==='det-close') return closeDetail();
  if(t.dataset.act==='det-app') return send('activity',{id:document.getElementById('det').dataset.id});
  if(t.dataset.act==='det-web'){ var did=document.getElementById('det').dataset.id; closeDetail(); return send('view',{id:did,y:Math.round(window.scrollY)}); }
  if(t.dataset.act==='open-here'||t.dataset.act==='open-app'||t.dataset.act==='sheet-close'){
    var sh2=document.getElementById('sheet'), aid=sh2.dataset.id; sh2.hidden=true;
    if(t.dataset.act==='open-here') send('view',{id:aid,y:Math.round(window.scrollY)});
    if(t.dataset.act==='open-app') send('activity',{id:aid});
    return;
  }
  if(t.dataset.athlete) return send('athlete',{id:t.dataset.athlete});
  if(t.dataset.photo) return openPhotos(t);
  if(t.dataset.lbi!==undefined) return lbGo(+t.dataset.lbi);
  if(t.dataset.day!==undefined){
    if(t.classList.contains('on')) return;
    document.querySelectorAll('.day').forEach(function(b){ b.classList.toggle('on', b===t); });
    document.body.classList.add('loading'); toast('Loading '+t.textContent);
    return send('day',{back:t.dataset.day});
  }
  if(t.dataset.kudo) return kudo(t);
  if(t.dataset.open) return send('open',{url:t.dataset.open});
  if(t.dataset.lang){
    var row=t.closest('.ai'); row.querySelectorAll('.lng').forEach(function(b){ b.classList.toggle('on', b===t); });
    document.querySelectorAll('.lng').forEach(function(b){ b.classList.toggle('on', b.dataset.lang===t.dataset.lang); });
    aiLang=t.dataset.lang; send('setlang',{lang:aiLang}); return;
  }
  if(t.dataset.suggest) return suggest(t);
  if(t.dataset.sug!==undefined){
    var ta=t.closest('.cbox').querySelector('textarea'); ta.value=t.textContent; ta.focus(); return;
  }
  if(t.dataset.savekey!==undefined){
    var box2=t.closest('.cbox'), inp=box2.querySelector('.keyrow input');
    t.disabled=true;
    send('setkey',{key:inp.value},function(ok,msg){
      t.disabled=false;
      if(!ok){ toast(msg||'Key not saved'); return; }
      toast('Key saved'); suggest(box2.querySelector('[data-suggest]'));
    });
    return;
  }
  if(t.dataset.comment){
    var box=t.closest('.cbox'),ta=box.querySelector('textarea'),text=ta.value.trim(),id=t.dataset.comment;
    if(!text) return;
    t.disabled=true; t.textContent='…';
    if(document.activeElement) document.activeElement.blur();
    var det=document.getElementById('det');
    var who=t.closest('section.person')||(t.closest('#det')&&det.dataset.pid?document.querySelector('section.person[data-pid="'+CSS.escape(det.dataset.pid)+'"]'):null);
    var flight=showSending(who, text);
    send('comment',{id:id,text:text},function(ok,msg){
      t.disabled=false; t.textContent='Post';
      if(ok){ ta.value=''; box.hidden=true; document.querySelectorAll('.act[data-id="'+CSS.escape(id)+'"] .cc').forEach(function(cc){ cc.textContent=(+cc.textContent||0)+1; }); }
      flight.finish(ok,msg);
    });
    return;
  }
  var act=t.dataset.act;
  if(act==='toggle-comment'){ var b=t.closest('.act').querySelector('.cbox'); b.hidden=!b.hidden; if(!b.hidden) b.querySelector('textarea').focus(); }
  if(act==='kudo-all') kudoAll(t);
  if(act==='upd-now') updNow(t);
  if(act==='upd-later') updLater();
  if(act==='upd-close'){ var uo=document.getElementById('upd'); if(uo) uo.remove(); }
  if(act==='send-close') closeSending();
  if(act==='lb-close') closePhotos();
  if(act==='refresh'){ document.body.classList.add('loading'); toast('Refreshing'); send('refresh',{}); }
});
</script></body></html>`;
}

// ───────────── entry point (last, so every const above is initialised) ─────────────

const wantsRefreshOnly = !!(qp.refresh || args.shortcutParameter === 'refresh');
if (config.runsInWidget || config.runsInAccessoryWidget) {
  await renderWidget();
} else if (wantsRefreshOnly) {
  try { await refreshOnly(); } catch (e) { console.error(e); }
} else {
  try { await main(); }
  catch (e) {
    const a = new Alert(); a.title = 'Strava digest'; a.message = String(e.message || e);
    a.addAction('OK'); await a.present();
  }
}
Script.complete();
