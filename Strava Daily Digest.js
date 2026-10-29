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
 * Opens on a 2.4 s launch screen with the route-digest logo (app-blueprints · launch-screen).
 * Home Screen and Lock Screen widget in the shared frame, from a snapshot the digest saves (app-blueprints · widgets).
 * The BLUEPRINTS block below lists every shared blueprint this app follows (Settings › Built with).
 */

// Fixed choices. Everything a user may want different lives in Settings (the sliders icon in the header):
// see the CONFIG registry and the settings defaults further down (github.com/gadominas/app-blueprints · settings).
const APP = 'StravaFeed';   // the app's folder in Scriptable's documents (settings.json lives there)
// Applied to every AI comment (Settings › Comment writing); the person can change it there.
const DEFAULT_COMMENT_RULES = `Role & Tone: Act as an encouraging, witty, and intelligent British running mate, using natural, conversational British phrasing.
Task: Write exactly one short, punchy, and funny sentence to congratulate a runner on their workout.
Content Requirements:
 * Core Message: Offer polite encouragement and genuine kudos while seamlessly weaving in a clever sports joke or a famous sports quote.
 * Early Risers: If the activity was early in the morning, playfully acknowledge their cracking dedication to beating the sun.
 * Pace and Distance: If they ran at a blazing speed or covered a massive distance, praise their flying feet or brilliant endurance naturally, but absolutely never mention the exact numbers, times, or distances in your response.
 * Formatting Constraints: The final output must be strictly a single, grammatically correct sentence that sounds totally human, containing absolutely zero emojis and zero dashes.`;

const DIGEST = {
  DAYS_BACK: 0,            // day shown first: 0 = today, 1 = yesterday, ... (or run with ?days=1)
  DEBUG_DUMP: false,       // save raw feed JSON to Scriptable/strava-feed-debug.json
  AI: {                    // ✨ comment ideas from Claude or OpenAI (your own key; Settings › AI settings)
    LANGUAGES: [['EN', 'English'], ['LT', 'Lithuanian']],
    MODES: [               // comment moods offered in the comment composer
      { key: 'mystyle', label: '✨ My style' },   // your instructions plus the style learned from your comments
      { key: 'funny', label: '😂 Funny', style: 'funny and warm, like a teammate teasing with affection' },
      { key: 'energetic', label: '⚡ Energetic', style: 'high-energy hype, like a coach cheering from the roadside: punchy, exclamation marks welcome' },
      { key: 'serious', label: '🎯 Serious', style: 'sincere and respectful, specific praise of the effort and the numbers, no jokes' },
      { key: 'funky', label: '🕺 Funky', style: 'playful and quirky, groovy slang and wordplay, a little absurd' },
    ],
  },
};

// This build's version. When releasing, bump it and add a matching entry to releases.json (see docs/RELEASING.md).
const VERSION = '1.15.2';
const APP_ID = 'stravafeed';   // unique per app, never changes

// ───────── Blueprints ─────────
// Shared blueprints this app was built with (github.com/gadominas/app-blueprints). One line per blueprint, in this exact shape:
// inventory tools read it without running the script, and Settings › Built with shows it.
const BLUEPRINTS_REPO = 'https://github.com/gadominas/app-blueprints';
const BLUEPRINTS = [
  { id: 'in-app-updates', name: 'In-app updates', version: '1.0.0', since: '1.10.0' },
  { id: 'settings', name: 'Settings', version: '1.0.0', since: '1.10.0' },
  { id: 'ai-configuration', name: 'AI configuration', version: '1.0.0', since: '1.9.1' },
  { id: 'launch-screen', name: 'Launch screen', version: '1.0.0', since: '1.12.0' },
  { id: 'widgets', name: 'Widgets', version: '1.0.0', since: '1.13.0' },
];
const REPO_RAW = 'https://raw.githubusercontent.com/gadominas/StravaFeed/main/';
const UPDATE_SNOOZE_MS = 2 * 24 * 3600 * 1000;

const STRAVA = 'https://www.strava.com';
const SCHEME = 'strava-digest://';

const qp = (args && args.queryParameters) || {};
if (qp.days) DIGEST.DAYS_BACK = parseInt(qp.days, 10) || 0;


// ───────────────────────────── main flow ─────────────────────────────

const KC_ATHLETE = 'strava-digest-athlete-id';
// 1.9.x and earlier kept settings and remembered picks in these Keychain entries; moved to settings.json on first run.
const KC_AI_LANG = 'strava-digest-ai-lang';
const KC_AI_MODE = 'strava-digest-ai-mode';
const KC_AI_CUSTOM = 'strava-digest-ai-custom';
const cleanPrompt = t => String(t || '').replace(/[\r\n]+/g, ' ').replace(/"/g, "'").trim().slice(0, 200);
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

  let settingsEffect = '';   // what closing Settings must do: '', 'render' or 'reload'
  const maxBack = () => Math.max(0, cfg('daysInPicker') - 1);
  let feed = null, daysBack = Math.min(maxBack(), Math.max(0, DIGEST.DAYS_BACK)), viewToken = 0, closed = false;
  const details = new Map();         // activity id -> details found on its page (kept for the session)

  let viewing = false, savedScroll = 0;
  let likeUnsupported = false;   // set once Strava's page offers no way to like a comment
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
    let me = athleteId() || (Keychain.contains(KC_ATHLETE) ? Keychain.get(KC_ATHLETE) : null);
    let first = me ? await firstPage(me) : null;
    if (first) return { me, first };

    status('Checking your Strava login');
    if (!(await authInfo(sx)).loggedIn) {
      await ui.loadHTML(page(`<div class="center"><h1>Log in to Strava</h1><p>Use email and password or the emailed code. Google sign-in usually doesn't work here.<br>The digest opens by itself once you're logged in.</p><br><button data-act="login">Log in to Strava</button></div>`));
      while (!closed && !(await authInfo(sx)).loggedIn) await sleep(2500);
      if (closed) return null;
      await ui.loadHTML(bootScreen('Logged in. Loading your feed'));
    }
    me = athleteId() || await sx('__SD.athleteId()');
    if (!me) throw new Error('Could not detect your athlete ID. Open your Strava profile, copy the number from strava.com/athletes/<ID>, and enter it in Settings › Account › Strava athlete ID.');
    first = await firstPage(me);
    if (!first) throw new Error("You're logged in, but Strava's feed didn't answer. Tap Try again.");
    if (!athleteId()) Keychain.set(KC_ATHLETE, me);
    return { me, first };
  }

  async function firstPage(me) {
    try { return await sx(`__SD.page(${JSON.stringify(me)}, null, null, 0, 1e15, ${DIGEST.DEBUG_DUMP})`, cfg('pageWait') * 1000); }
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
      await ui.loadHTML(renderDigest({ dayStart, daysBack, scan: feed.scan(), people: groupByAthlete(acts), count: acts.length, mine: mineList() }));
      saveSnapshot(feed);
      offerUpdate();
      enrich(acts, token, +dayStart, +dayEnd).catch(e => console.warn('Details: ' + e));
      fillMine(token).catch(e => console.warn('Your activities: ' + e));
    } catch (e) {
      if (token !== viewToken) return;
      await ui.loadHTML(page(`${appHeader(daysBack, 0, 0)}<div class="center">${esc(e.message || e)}<br><br><button class="ghost" data-act="refresh">Try again</button></div>`));
    }
  }

  // Your latest activities (today and yesterday, newest first, at most three).
  function mineList() {
    if (!feed) return [];
    return feed.mine(+dayBounds(1).dayStart, +dayBounds(0).dayEnd).slice(0, 3);
  }
  // Today's view may not have read back to yesterday: do it quietly, then refresh the strip.
  async function fillMine(token) {
    const y = dayBounds(1);
    if (feed.covers(+y.dayStart)) return;
    await feed.readBackTo(+y.dayStart, async () => {}, () => token !== viewToken || closed);
    if (token !== viewToken || closed) return;
    await js(`window.__patchMine(${JSON.stringify(mineHtml(mineList()))})`);
  }

  async function enrich(acts, token, dayStart, dayEnd) {
    if (!settings.enrich) return;
    const todo = acts.filter(a => !details.has(a.id)).map(a => a.id);
    if (!todo.length) return;
    if (!ev) { ev = new WebView(); await ev.loadURL(`${STRAVA}/robots.txt`); ex = makeSx(ev); }
    for (let i = 0; i < todo.length; i += cfg('enrichConcurrency')) {
      if (token !== viewToken || closed) return;
      const chunk = todo.slice(i, i + cfg('enrichConcurrency'));
      let det = {};
      try { det = await ex(`__SD.enrich(${JSON.stringify(chunk)}, ${chunk.length})`, cfg('detailsWait') * 1000); } catch (e) { console.warn(e.message); }
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
    if (AI_ACTIONS.includes(head)) {   // AI settings sheet (app-blueprints · ai-configuration)
      const msg = await aiAction(head, p);
      await js(`window.__aiState(${JSON.stringify(aiClientState())})`);
      if (msg) await js(`window.__aiToast(${JSON.stringify(msg)})`);
      await js(`window.__done(${JSON.stringify(p.req)}, true, '')`);
      return;
    }
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
    if (head === 'setlang') { if (setSetting('aiLang', p.lang) !== null) saveSettings(); return; }
    if (head === 'setmode') { if (setSetting('aiMode', p.mode) !== null) saveSettings(); return; }
    // Settings (app-blueprints · settings): every change is applied and saved at once; the reply is the fresh state.
    if (head === 'settings-get' || head === 'set' || head === 'cfg') {
      let ok = true, msg = '';
      try {
        if (head === 'set') {
          const effect = setSetting(p.k, p.v);
          if (effect === null) throw new Error('That setting can’t be changed here.');
          if (effect && effect !== settingsEffect) settingsEffect = settingsEffect === 'reload' ? 'reload' : effect;
          saveSettings();
        } else if (head === 'cfg') {
          const before = cfg('daysInPicker');
          if (p.k === '*') settings.cfg = {};
          else if (p.reset) setCfg(p.k, null);
          else { const err = setCfg(p.k, p.v); if (err) throw new Error(err); }
          if (cfg('daysInPicker') !== before) { settingsEffect = settingsEffect || 'render'; daysBack = Math.min(daysBack, Math.max(0, cfg('daysInPicker') - 1)); }
          saveSettings();
        }
        msg = JSON.stringify(settingsState());
      } catch (e) { ok = false; msg = String(e.message || e); }
      await js(`window.__done(${JSON.stringify(p.req)}, ${ok}, ${JSON.stringify(msg)})`);
      return;
    }
    if (head === 'settings-done') {   // the sheet closed: redraw or reload once for everything that needs it
      const effect = settingsEffect; settingsEffect = '';
      if (feed && effect) await showDay(effect === 'reload');
      return;
    }
    if (head === 'openurl') {   // Built with: only the blueprints repository opens from here
      if (p.v === BLUEPRINTS_REPO || String(p.v).startsWith(BLUEPRINTS_REPO + '/')) await Safari.openInApp(p.v, false);
      return;
    }
    if (head === 'update-check') {
      if (Keychain.contains(KC_UPDATE_SNOOZE)) Keychain.remove(KC_UPDATE_SNOOZE);
      const was = settings.checkUpdates; settings.checkUpdates = true;
      const u = await checkForUpdate(); settings.checkUpdates = was;
      await js(`window.__done(${JSON.stringify(p.req)}, true, ${JSON.stringify(u ? `Version ${u.latest} is available` : `You're on the latest version (${VERSION})`)})`);
      if (u) { pendingUpdate = u; offerUpdate(); }
      return;
    }
    if (head === 'retry') { await boot(); return; }
    if (!feed) return;
    if (head === 'refresh') { await showDay(true); return; }
    if (head === 'day') { daysBack = Math.min(maxBack(), Math.max(0, parseInt(p.back, 10) || 0)); await showDay(false); return; }
    if (head === 'style-learn' || head === 'style-clear') {
      let ok = true, msg = '';
      try {
        if (head === 'style-clear') { settings.styleProfile = ''; settings.styleMeta = null; saveSettings(); }
        else {
          if (!feed) throw new Error('Wait until the digest has loaded, then try again.');
          await learnStyle(feed, sx, t => js(`window.__styleProgress && window.__styleProgress(${JSON.stringify(t)})`), () => closed);
        }
        msg = JSON.stringify(settingsState());
      } catch (e) { ok = false; msg = String(e.message || e); }
      await js(`window.__done(${JSON.stringify(p.req)}, ${ok}, ${JSON.stringify(msg)})`);
      return;
    }
    if (head === 'mine-open') {
      const a = feed.mineGet(String(p.id));
      let data = { ok: false };
      if (a) {
        let soc = { kudoers: [], comments: [] };
        try { soc = (await sx(`__SD.social(${JSON.stringify(String(p.id))})`, cfg('detailsWait') * 1000)) || soc; } catch (e) { console.warn('Kudos and comments: ' + e.message); }
        const kudoers = soc.kudoers && soc.kudoers.length ? soc.kudoers : (a.kudoers || []);
        const comments = soc.comments && soc.comments.length ? soc.comments : (a.cmts || []);
        if (comments.length > (a.comments || 0)) a.comments = comments.length;
        data = {
          ok: true, id: a.id, name: a.name || a.type, emoji: emoji(a.type), line: mineLine(a),
          kudos: Math.max(a.kudos || 0, kudoers.length), commentCount: Math.max(a.comments || 0, comments.length),
          kudoers, comments: comments.map(c => Object.assign({}, c, { ago: agoLabel(c.at) })), likeable: !likeUnsupported,
        };
      }
      await js(`window.__done(${JSON.stringify(p.req)}, ${!!data.ok}, ${JSON.stringify(JSON.stringify(data))})`);
      return;
    }
    if (head === 'comment-like') {
      let r;
      try { r = await likeComment(sx, String(p.aid), String(p.cid || ''), String(p.text || ''), p.on === '1'); }
      catch (e) { r = { ok: false, error: e.message }; }
      if (r.unsupported) likeUnsupported = true;
      if (r.via) console.log('Comment like sent via ' + r.via);
      await js(`window.__done(${JSON.stringify(p.req)}, ${!!r.ok}, ${JSON.stringify(r.ok ? '' : (r.unsupported ? 'UNSUPPORTED' : (r.error || 'Like not sent')))})`);
      return;
    }
    let ok = false, msg = '';
    try {
      if (head === 'kudo') {
        const r = await sx(`__SD.kudo(${JSON.stringify(p.id)})`, cfg('pageWait') * 1000); ok = !!r.ok; msg = r.error || '';
        if (ok) { feed.update(p.id, a => { a.hasKudoed = true; a.kudos++; }); saveSnapshot(feed); }
      } else if (head === 'comment') {
        const r = await postComment(sx, String(p.id), String(p.text || ''));
        ok = !!r.ok; msg = r.error || '';
        if (r.via) console.log('Comment sent via ' + r.via);
        if (ok) { feed.update(p.id, a => { a.comments++; }); rememberSent(String(p.text || '').trim()); }
      } else if (head === 'suggest') {
        const a = feed.get(p.id);
        if (!a) msg = 'Activity not found.';
        else {
          const r = await aiSuggest(a, p.lang || settings.aiLang, p.hint || '', p.mode || settings.aiMode);
          if (r.needKey) msg = 'NEED_KEY';
          else { ok = true; msg = JSON.stringify({ comments: r.comments, by: r.by }); }
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

// ─────────────── AI configuration ───────────────
// Follows github.com/gadominas/app-blueprints · blueprints/ai-configuration.md (reference: BlogPulse.js).
// Every AI request goes through aiCall. Keys live in the iOS Keychain only; the page sees them masked.

// AI providers. Keychain names are unique per app; models are defaults until the user picks one.
const AI = {
  anthropic: { key: "STRAVA_DIGEST_ANTHROPIC_KEY", model: "claude-haiku-5-5" },
  openai:    { key: "STRAVA_DIGEST_OPENAI_KEY",    model: "gpt-5.4-mini" },
};
const PROVIDERS = { anthropic: "Claude", openai: "OpenAI" };

// AI settings and token usage live in their own small JSON files on this iPhone (never the keys).
const aiFm = FileManager.local();
const aiPath = name => aiFm.joinPath(aiFm.documentsDirectory(), "strava-digest-" + name + ".json");
function aiLoad(name, fallback) {
  try { const p = aiPath(name); if (aiFm.fileExists(p)) return JSON.parse(aiFm.readString(p)); }
  catch (e) { console.log("AI: couldn't read " + name + ": " + e); }
  return fallback;
}
function aiWrite(name, data) {
  try { aiFm.writeString(aiPath(name), JSON.stringify(data)); } catch (e) { console.log("AI: couldn't save " + name + ": " + e); }
}
const aiSettings = Object.assign({
  aiProvider: "anthropic",   // the provider marked "In use"
  ai: true,                  // background AI jobs on/off ("What AI does")
  // model:  { anthropic: "…", openai: "…" }   set when the user picks a model
  // models: { anthropic: { at, list: [{ id, name }] }, openai: … }   cached model lists
}, aiLoad("ai-settings", {}));
const saveAiSettings = () => aiWrite("ai-settings", aiSettings);

const keyFor   = p => Keychain.contains(AI[p].key) ? Keychain.get(AI[p].key) : null;
const aiKey    = () => keyFor(aiSettings.aiProvider);   // the key of the provider in use
const modelFor = p => (aiSettings.model && aiSettings.model[p]) || AI[p].model;
const maskKey  = k => k ? (k.length > 14 ? k.slice(0, 7) + "…" + k.slice(-4) : "…" + k.slice(-4)) : null;

// Run once at start: move a key an earlier version stored elsewhere, then use whichever provider has a key.
function aiMigrate(oldKeyNames, oldModel) {
  for (const old of oldKeyNames || []) {
    if (!Keychain.contains(old)) continue;
    if (!Keychain.contains(AI.openai.key)) Keychain.set(AI.openai.key, Keychain.get(old));
    Keychain.remove(old);
    if (!keyFor("anthropic")) aiSettings.aiProvider = "openai";   // use the key that now exists
  }
  if (oldModel && !(aiSettings.model && aiSettings.model.openai)) aiSettings.model = Object.assign({}, aiSettings.model, { openai: oldModel });
  if (!PROVIDERS[aiSettings.aiProvider]) aiSettings.aiProvider = "anthropic";
  if (!aiKey()) { const other = Object.keys(PROVIDERS).find(p => keyFor(p)); if (other) aiSettings.aiProvider = other; }
  saveAiSettings();
}

async function askKey(p) {
  const cur = keyFor(p);
  const al = new Alert();
  al.title = `${PROVIDERS[p]} API key`;
  al.message = cur ? `The saved key ends in …${cur.slice(-4)}. Paste a new key to replace it.`
                   : "Paste your API key. It's stored in the iOS Keychain on this device only.";
  al.addSecureTextField(p === "openai" ? "sk-…" : "sk-ant-…", "");
  al.addAction("Save key");
  al.addCancelAction("Cancel");
  if (await al.present() !== 0) return false;
  const v = al.textFieldValue(0).trim();
  if (!v) return false;
  Keychain.set(AI[p].key, v);
  if (!aiKey()) aiSettings.aiProvider = p;   // first key saved: use that provider
  return true;
}

function removeKey(p) {
  if (Keychain.contains(AI[p].key)) Keychain.remove(AI[p].key);
}

// The only way the app calls AI. feature: a short tag for the usage table.
// provider: defaults to the one in use; "Test connection" passes the card's provider.
async function aiCall(system, user, maxTokens = 2500, feature = "other", provider = aiSettings.aiProvider) {
  const key = keyFor(provider);
  if (!key) throw new Error(`No ${PROVIDERS[provider]} key saved`);
  const openai = provider === "openai", model = modelFor(provider);
  const r = new Request(openai ? "https://api.openai.com/v1/chat/completions" : "https://api.anthropic.com/v1/messages");
  r.method = "POST";
  r.timeoutInterval = 90;
  if (openai) {
    r.headers = { "Authorization": "Bearer " + key, "Content-Type": "application/json" };
    r.body = JSON.stringify({ model, messages: [{ role: "system", content: system }, { role: "user", content: user }] });
  } else {
    r.headers = { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" };
    r.body = JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] });
  }
  const j = await r.loadJSON();
  if (j.error) throw new Error(j.error.message || "AI request failed");
  const u = j.usage || {};
  recordUsage(provider, model, feature,
    openai ? (u.prompt_tokens || 0) : (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0),
    openai ? (u.completion_tokens || 0) : (u.output_tokens || 0));
  return openai ? ((j.choices && j.choices[0] && j.choices[0].message.content) || "")
                : (j.content || []).map(c => c.text || "").join("");
}

// For prompts that ask for JSON: tolerate code fences and stray text around it.
function parseJSON(txt) {
  const s = String(txt).replace(/```json|```/g, "").trim();
  const a = s.search(/[\[{]/), b = Math.max(s.lastIndexOf("}"), s.lastIndexOf("]"));
  return JSON.parse(s.slice(a, b + 1));
}

// Token usage, counted from what the provider reports, per provider, model, feature and local day.
let usage = aiLoad("usage", { since: Date.now(), p: {} });
const aiDayKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function recordUsage(provider, model, feature, tin, tout) {
  const P = usage.p[provider] = usage.p[provider] || { calls: 0, in: 0, out: 0, models: {}, features: {}, days: {} };
  const b = (o, k) => o[k] = o[k] || { calls: 0, in: 0, out: 0 };
  for (const x of [P, b(P.models, model), b(P.features, feature), b(P.days, aiDayKey())]) {
    x.calls++; x.in += tin; x.out += tout;
  }
  const days = Object.keys(P.days).sort();
  while (days.length > 400) delete P.days[days.shift()];   // keep about 13 months of days
  aiWrite("usage", usage);   // save after every call: the app can be closed at any moment
}

function resetUsage() { usage = { since: Date.now(), p: {} }; aiWrite("usage", usage); }

// The models the user's own key can call, newest first; cached so the menu works offline.
async function fetchModels(p) {
  const key = keyFor(p);
  if (!key) throw new Error(`Add a ${PROVIDERS[p]} key first`);
  const r = new Request(p === "openai" ? "https://api.openai.com/v1/models" : "https://api.anthropic.com/v1/models?limit=100");
  r.headers = p === "openai" ? { "Authorization": "Bearer " + key } : { "x-api-key": key, "anthropic-version": "2023-06-01" };
  r.timeoutInterval = 20;
  const j = await r.loadJSON();
  if (j.error) throw new Error(j.error.message || "Couldn't load models");
  let list = (j.data || []).map(m => ({
    id: m.id, name: m.display_name || m.id,
    t: m.created_at ? Date.parse(m.created_at) : (m.created || 0) * 1000,
  }));
  // OpenAI lists every model the key can reach; keep only the ones that write text.
  if (p === "openai") list = list.filter(m => /^(gpt-|o\d|chatgpt-)/.test(m.id)
    && !/(audio|realtime|tts|transcribe|image|search|embedding|instruct|moderation)/.test(m.id));
  list.sort((a, b) => b.t - a.t);
  aiSettings.models = aiSettings.models || {};
  aiSettings.models[p] = { at: Date.now(), list: list.map(m => ({ id: m.id, name: m.name })) };
  saveAiSettings();
  return list.length;
}

// Bridge actions from the AI settings sheet. Returns the toast to show ("" for none).
const AI_ACTIONS = ["aistate", "aikey", "airm", "aiprov", "aimodels", "aimodel", "aitest", "usagereset", "aitoggle"];
async function aiAction(head, m) {
  const P = PROVIDERS[m.v] ? m.v : aiSettings.aiProvider;
  let msg = "";
  switch (head) {
    case "aikey":
      if (await askKey(P)) {
        aiSettings.ai = true; saveAiSettings();
        try { const n = await fetchModels(P); msg = `${PROVIDERS[P]} key saved — ${n} models available`; }
        catch (e) { msg = `Key saved, but checking it failed: ${String(e.message || e).slice(0, 70)}`; }
      }
      break;
    case "airm": removeKey(P); msg = `${PROVIDERS[P]} key removed`;
      if (!aiKey()) { const other = Object.keys(PROVIDERS).find(p => keyFor(p)); if (other) aiSettings.aiProvider = other; }
      break;
    case "aiprov": if (PROVIDERS[m.v] && keyFor(m.v)) aiSettings.aiProvider = m.v; break;
    case "aimodels":
      try { const n = await fetchModels(P); msg = `${n} ${PROVIDERS[P]} models found`; }
      catch (e) { msg = String(e.message || e).slice(0, 90); }
      break;
    case "aimodel":
      if (PROVIDERS[m.p] && m.v) { aiSettings.model = aiSettings.model || {}; aiSettings.model[m.p] = m.v; msg = `${PROVIDERS[m.p]} now uses ${m.v}`; }
      break;
    case "aitest": {
      const t0 = Date.now();
      try {
        await aiCall("Reply with the single word OK.", "Connection test.", 10, "test", P);
        msg = `${PROVIDERS[P]} works — ${modelFor(P)} answered in ${((Date.now() - t0) / 1000).toFixed(1)} s`;
      } catch (e) { msg = `${PROVIDERS[P]} test failed: ${String(e.message || e).slice(0, 80)}`; }
      break;
    }
    case "usagereset": resetUsage(); msg = "Usage counters reset"; break;
    case "aitoggle": aiSettings.ai = !aiSettings.ai; break;
  }
  saveAiSettings();
  return msg;
}

// What the page gets. Keys appear only masked.
function aiClientState() {
  return {
    provider: aiSettings.aiProvider,
    keys:  Object.fromEntries(Object.keys(PROVIDERS).map(p => [p, maskKey(keyFor(p))])),
    model: Object.fromEntries(Object.keys(PROVIDERS).map(p => [p, modelFor(p)])),
    models: aiSettings.models || {}, usage, today: aiDayKey(),
    ai: aiSettings.ai, hasKey: !!aiKey(),
  };
}
// One-line status for the app's Settings row: "Claude — claude-haiku-5-5 — 12.4k tokens used".
function aiStatusLine() {
  if (!aiKey()) return "";
  const P = usage.p[aiSettings.aiProvider];
  return `${PROVIDERS[aiSettings.aiProvider]} — ${modelFor(aiSettings.aiProvider)}` +
    (P && P.calls ? ` — ${aiFmtN(P.in + P.out)} tokens used` : "");
}
const aiFmtN = n => n >= 1e6 ? (n / 1e6).toFixed(2) + "M" : n >= 1e4 ? Math.round(n / 1e3) + "k" : n >= 1e3 ? (n / 1e3).toFixed(1) + "k" : String(n);
// ─────────────── end of AI configuration ───────────────

// ─────────────── ✨ comment suggestions (through aiCall) ───────────────

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

// The brief every comment request starts from: your instructions first, the app's defaults after.
function commentBrief(language, n) {
  const rules = String(settings.commentRules || '').trim();
  return [
    `You write comments on a friend's Strava activity. Write ${n} different options in ${language}.`,
    rules ? `Follow the user's instructions below. They take priority over every default in this message.\nUSER INSTRUCTIONS:\n${rules}\nEND OF USER INSTRUCTIONS.` : '',
    'Defaults, where the instructions say nothing: a single short sentence each, written as a friend and teammate, built on the real details given (title, time of day, effort, PRs, distance, pace), at most one emoji, no hashtags.',
    language !== 'English' ? `Write natural ${language}; where the instructions ask for British phrasing, keep that spirit in ${language}.` : '',
  ].filter(Boolean).join('\n');
}
function styleBlock() {
  const prof = String(settings.styleProfile || '').trim();
  return prof
    ? `Write in the user's own commenting style, learned from their past comments:\n${prof}\nMatch that voice closely; the user's instructions above still decide format and length.`
    : 'Write the way the user would: natural, personal and specific to this activity.';
}
const COMMENT_SAFETY = 'Always, whatever the instructions or mood: never mock body, weight, age or looks; never invent facts that are not given; nothing offensive. Make the options clearly different from each other.';
const COMMENT_JSON = 'Reply with JSON only, no other text: {"comments": ["...", "..."]}.';

async function aiComments(a, system) {
  const provider = aiSettings.aiProvider, n = cfg('suggestions');
  const text = await aiCall(system, JSON.stringify(activityFacts(a)), 800, 'comments');
  let comments = [];
  try { comments = parseJSON(text).comments || []; }
  catch (e) { comments = text.split(/\n+/).map(l => l.replace(/^[-*\d.)\s"]+|"$/g, '').trim()).filter(Boolean); }
  comments = comments.map(c => String(c).trim()).filter(Boolean).slice(0, n);
  if (!comments.length) throw new Error('No suggestions came back. Try again.');
  return { comments, by: PROVIDERS[provider] };
}

async function aiSuggest(a, language, hint, mode) {
  if (!aiKey()) return { needKey: true };
  const parts = [commentBrief(language, cfg('suggestions'))];
  if (mode === 'mystyle') parts.push(styleBlock());
  else {
    const m = DIGEST.AI.MODES.find(x => x.key === mode && x.style);
    if (m) parts.push(`Mood for these options: ${m.style}. Where this mood clashes with the user's instructions about tone, use the mood; every other instruction still applies.`);
  }
  if (hint) parts.push(`The user's own draft idea; keep its spirit: "${hint}".`);
  parts.push(COMMENT_SAFETY, COMMENT_JSON);
  return aiComments(a, parts.join('\n'));
}

// "Learn my style": what the AI is asked to write from your own comments.
const STYLE_PROMPT = [
  "You study how one person writes comments on friends' Strava activities, so another writer can imitate them.",
  'From the examples, describe their style as clear instructions to that writer ("Use…", "Keep…", "Never…").',
  'Cover: typical length and sentence shape; vocabulary and favourite words or phrases (quote short ones); type of humour;',
  'how they address people (names, nicknames); punctuation, capitals, exclamation and emoji habits; the languages they use and when; things they never do.',
  'Write 8 to 12 short lines, one instruction per line, under 1,000 characters in total. Do not copy whole comments. Plain text only.',
].join(' ');

// Comments you posted through the digest: the surest examples of your style (kept on this iPhone, newest first).
async function rememberSent(text) {
  try {
    const h = (await load('sent-comments', [])).filter(x => x && x.text !== text);
    h.unshift({ text, at: Date.now() });
    write('sent-comments', h.slice(0, 50));
  } catch (e) { console.warn('Comment history: ' + e); }
}

// "Learn my style": collect your latest comments, then have the AI describe how you write.
// Is this commenter you? Same first name, and the same surname or its initial ("Gediminas S."), accents ignored.
function nameMatches(name, mine) {
  const norm = (x) => String(x || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\s]/gu, ' ').trim().split(/\s+/).filter(Boolean);
  const a = norm(name), b = norm(mine);
  if (!a.length || !b.length) return false;
  if (a.join(' ') === b.join(' ')) return true;
  if (a.length < 2 || b.length < 2 || a[0] !== b[0]) return false;
  const lastA = a[a.length - 1], lastB = b[b.length - 1];
  return lastA === lastB || (lastA.length === 1 && lastA === lastB[0]);
}

async function learnStyle(feed, sx, progress, isClosed) {
  if (!aiKey()) throw new Error('Add a Claude or OpenAI key first, in AI settings.');
  const n = cfg('styleComments'), me = String(feed.me() || '');
  let myName = feed.myName();
  if (!myName) { try { myName = ((await sx(`__SD.whoAmI(${JSON.stringify(me)})`, cfg('pageWait') * 1000)) || {}).name || ''; } catch (e) {} }
  const texts = [], seen = new Set();
  let read = 0;   // everyone's comments looked at, yours or not
  const take = (t) => { t = String(t || '').trim(); const k = t.toLowerCase(); if (t && texts.length < n && !seen.has(k)) { seen.add(k); texts.push(t); } };
  const isMine = (c) => (c.athleteId && me && String(c.athleteId) === me) || nameMatches(c.name, myName);
  for (const h of await load('sent-comments', [])) take(h && h.text);
  for (const a of feed.all()) (a.cmts || []).filter(isMine).forEach(c => take(c.text));
  const checked = new Set();
  let scanned = 0;
  for (let round = 0; texts.length < n && round < 4 && !isClosed(); round++) {
    const todo = feed.all().filter(a => a.athleteId !== me && (a.comments || 0) > 0 && !checked.has(a.id));
    for (let i = 0; i < todo.length && texts.length < n && scanned < 150 && !isClosed(); i += 8) {
      const ids = todo.slice(i, i + 8).map(a => a.id);
      ids.forEach(id => checked.add(id)); scanned += ids.length;
      await progress(`Reading comments: ${texts.length} of ${n} yours found in ${read} read, ${scanned} activities checked`);
      let got = {};
      try { got = (await sx(`__SD.commentsMany(${JSON.stringify(ids)}, 4)`, cfg('detailsWait') * 2000)) || {}; } catch (e) { console.warn('Style: ' + e.message); }
      for (const id of ids) { const list = got[id] || []; read += list.length; list.filter(isMine).forEach(c => take(c.text)); }
    }
    if (texts.length >= n || scanned >= 150) break;
    const before = feed.scan().position || Date.now();     // reach a week further back in the feed
    await progress(`Reading older posts: ${texts.length} of ${n} found`);
    await feed.readBackTo(before - 7 * 864e5, async () => {}, isClosed);
    if ((feed.scan().position || before) >= before) break;  // nothing older came back
  }
  const who = myName ? ` (looking for ${myName})` : '';
  if (texts.length < 3) throw new Error(read
    ? `Read ${read} comments on ${scanned} activities, but only ${texts.length} were yours${who}. Comment a few more times, then try again.`
    : `Found only ${texts.length} of your comments and couldn\u2019t read others from Strava. Comment a few more times, then try again.`);
  await progress(`Studying ${texts.length} comments…`);
  const out = await aiCall(STYLE_PROMPT, JSON.stringify({ comments: texts }), 900, 'style');
  const prof = String(out || '').replace(/^```\w*\n?|```$/g, '').trim().slice(0, 1500);
  if (!prof) throw new Error('The AI sent back nothing. Try again.');
  settings.styleProfile = prof; settings.styleMeta = { at: Date.now(), count: texts.length, read, scanned };
  saveSettings();
}

// Everything read from the feed so far, newest first. Older days continue from where the last read stopped.
function makeFeed(sx, me, first) {
  let st;
  const reset = () => { st = { items: new Map(), mine: new Map(), next: null, position: null, oldest: null, done: false, stop: '', pages: 0, entries: 0, seenFirst: new Set(), raws: [] }; };
  const absorb = (r) => {
    st.pages++; st.entries += r.entryCount || 0;
    if (r.raw) st.raws.push(r.raw);
    if (r.firstId != null && st.seenFirst.has(r.firstId)) { st.done = true; st.stop = 'Strava returned the same page again'; return; }
    if (r.firstId != null) st.seenFirst.add(r.firstId);
    for (const a of r.items) {
      if (!a.id || a.id === 'undefined') continue;
      if (a.athleteId === me) { derive(a); st.mine.set(a.id, a); }   // your own: for the strip on top
      if (!settings.includeMe && a.athleteId === me) continue;
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
      const limit = st.pages + cfg('maxPages') + cfg('extraPagesPerDay') * 3;
      while (!this.covers(dayStart) && st.pages < limit) {
        if (cancelled()) return;
        await status(`Reading feed${st.position ? `, back to ${dayLabel(st.position)}` : ''}`);
        const r = await sx(`__SD.page(${JSON.stringify(me)}, ${JSON.stringify(st.next.before)}, ${JSON.stringify(st.next.cursor)}, 0, 1e15, ${DIGEST.DEBUG_DUMP})`, cfg('pageWait') * 1000);
        absorb(r);
        if (onCount) await onCount(st.entries);
      }
      if (!this.covers(dayStart)) st.stop = 'page limit reached';
      if (DIGEST.DEBUG_DUMP) dump(st.raws);
    },
    async restart(status) {
      await status('Refreshing');
      const r = await sx(`__SD.page(${JSON.stringify(me)}, null, null, 0, 1e15, ${DIGEST.DEBUG_DUMP})`, cfg('pageWait') * 1000);
      reset(); absorb(r);
    },
    day: (from, to) => [...st.items.values()].filter(a => a.ts != null && a.ts >= from && a.ts < to),
    get: (id) => st.items.get(id),
    mine: (from, to) => [...st.mine.values()].filter(a => a.ts != null && a.ts >= from && a.ts < to).sort((x, y) => y.ts - x.ts),
    mineGet: (id) => st.mine.get(id),
    all: () => [...st.items.values(), ...[...st.mine.values()].filter(a => !st.items.has(a.id))].sort((x, y) => (y.ts || 0) - (x.ts || 0)),
    me: () => me,
    myName: () => { for (const a of st.mine.values()) if (a.athleteName) return a.athleteName; return ''; },
    update: (id, fn) => { const a = st.items.get(id); if (a) fn(a); },
    scan: () => ({ pages: st.pages, entries: st.entries, position: st.position, oldest: st.oldest, stop: st.stop || 'reached the day before' }),
  };
}

// ─────────────── settings (⚙︎ in the header) ───────────────
// The CONFIG block above holds the defaults; anything changed in Settings is saved in the iOS Keychain
// and applied on top of it at start, so updates never wipe your choices.

// ---------- storage ----------
const fm = (() => { try { return FileManager.iCloud(); } catch (e) { return FileManager.local(); } })();
const DIR = fm.joinPath(fm.documentsDirectory(), APP);
if (!fm.fileExists(DIR)) fm.createDirectory(DIR, true);
const P = n => fm.joinPath(DIR, n + ".json");
async function load(n, def) {
  const p = P(n);
  if (!fm.fileExists(p)) return def;
  try {
    if (fm.isFileStoredIniCloud(p) && !fm.isFileDownloaded(p)) await fm.downloadFileFromiCloud(p);
    return JSON.parse(fm.readString(p));
  } catch (e) { return def; }   // a broken file falls back to defaults, never crashes
}
const write = (n, v) => { try { fm.writeString(P(n), JSON.stringify(v)); return true; } catch (e) { console.warn("Couldn't save " + n + ": " + e); return false; } };

// Defaults first, saved choices on top (loadSettings, at the entry point, before any branch).
const settings = {
  includeMe: false, enrich: true, widgetNames: true,
  checkUpdates: true,   // offer new versions from GitHub (asks again 2 days after "Later")
  theme: "auto", density: "comfortable", font: "sans", textSize: 1,
  aiLang: DIGEST.AI.LANGUAGES[0][1], aiMode: DIGEST.AI.MODES[0].key,   // remembered picks, also set in the composer
  commentRules: DEFAULT_COMMENT_RULES,   // instructions for every AI comment
  styleProfile: "", styleMeta: null,     // written by "Learn my style" from your own comments
  cfg: {},
};
const saveSettings = () => write("settings", settings);

// Every key the page may change, with its check and what closing Settings must then do.
const SET_KEYS = {
  includeMe: ["bool", "reload"], enrich: ["bool", "reload"], widgetNames: ["bool", ""], checkUpdates: ["bool", ""],
  theme: [v => v === "auto" || !!PALETTES[v], ""], density: [v => ["comfortable", "compact", "tiny"].includes(v), "render"],
  font: [v => ["sans", "serif"].includes(v), ""], textSize: [v => [0.92, 1, 1.12, 1.25].includes(+v), ""],
  aiLang: [v => DIGEST.AI.LANGUAGES.some(l => l[1] === v), "render"], aiMode: [v => DIGEST.AI.MODES.some(m => m.key === v), "render"],
  commentRules: ["rules", ""],
};
// Returns the effect ('', 'render', 'reload'), or null when the key or value isn't allowed.
function setSetting(k, v) {
  const s = SET_KEYS[k];
  if (!s) return null;
  if (s[0] === "bool") v = v === true || v === "true";
  else if (s[0] === "text") v = cleanPrompt(v);
  else if (s[0] === "rules") v = String(v == null ? "" : v).replace(/\r\n?/g, "\n").slice(0, 2000).trim();
  else if (!s[0](v)) return null;
  if (k === "textSize") v = +v;
  settings[k] = v;
  return s[1];
}

async function loadSettings() {
  const saved = await load("settings", null);
  if (saved) Object.assign(settings, saved);
  else {   // first run of 1.10: move the choices 1.9.x kept in the Keychain into settings.json
    try {
      if (Keychain.contains(KC_SETTINGS_OLD)) {
        const o = JSON.parse(Keychain.get(KC_SETTINGS_OLD));
        LEGACY_AI_MODEL = o.aiModel || null;
        for (const k of ["includeMe", "enrich", "widgetNames", "checkUpdates"]) if (k in o) settings[k] = !!o[k];
        if (/^\d+$/.test(String(o.athleteId || "").trim())) settings.cfg.athleteId = String(o.athleteId).trim();
      }
    } catch (e) {}
    for (const [k, kc] of [["aiLang", KC_AI_LANG], ["aiMode", KC_AI_MODE]]) if (Keychain.contains(kc)) settings[k] = Keychain.get(kc);
    if (saveSettings()) for (const kc of [KC_SETTINGS_OLD, KC_AI_LANG, KC_AI_MODE, KC_AI_CUSTOM]) if (Keychain.contains(kc)) Keychain.remove(kc);
  }
  // A stale or hand-edited file can't break the app: anything invalid falls back to its default.
  const d = { theme: "auto", density: "comfortable", font: "sans", textSize: 1, aiLang: DIGEST.AI.LANGUAGES[0][1], aiMode: DIGEST.AI.MODES[0].key };
  for (const k of Object.keys(d)) if (setSetting(k, settings[k]) === null) settings[k] = d[k];
  settings.cfg = settings.cfg && typeof settings.cfg === "object" ? settings.cfg : {};
}
const KC_SETTINGS_OLD = 'strava-digest-settings';
let LEGACY_AI_MODEL = null;   // the OpenAI model 1.8.x kept with the settings; handed to aiMigrate once

// Everything tunable lives here; the Settings screen edits these (stored in settings.cfg, defaults below).
const CONFIG = [
  ["Reading the feed", [
    { k: "maxPages", label: "Feed pages read for today", help: "About 20 posts each; more finds late posts but takes longer", unit: "pages", def: 15, min: 5, max: 40, step: 1 },
    { k: "extraPagesPerDay", label: "Extra pages per earlier day", help: "Added for each day further back", unit: "pages", def: 10, min: 0, max: 30, step: 1 },
    { k: "enrichConcurrency", label: "Activities opened at once for details", help: "Higher fills in heart rate and PRs faster but is heavier on the network", unit: "", def: 4, min: 1, max: 8, step: 1 },
    { k: "pageWait", label: "Time limit per feed page", help: "Also used for kudos and comments", unit: "s", def: 20, min: 10, max: 60, step: 5 },
    { k: "detailsWait", label: "Time limit per activity page", unit: "s", def: 30, min: 10, max: 60, step: 5 },
  ]],
  ["Digest", [
    { k: "daysInPicker", label: "Days in the header", help: "Today, yesterday and further back", unit: "days", def: 2, min: 1, max: 7, step: 1 },
  ]],
  ["Comments", [
    { k: "styleComments", label: "Comments read to learn your style", help: "Your latest comments on Strava", unit: "comments", def: 20, min: 5, max: 50, step: 5 },
    { k: "suggestions", label: "✨ Comment ideas per tap", unit: "", def: 3, min: 1, max: 5, step: 1 },
  ]],
  ["Widget", [
    { k: "widgetRefreshMin", label: "Ask iOS to refresh every", help: "iOS decides the exact timing", unit: "min", def: 15, min: 15, max: 120, step: 15 },
    { k: "widgetStaleMin", label: "Mark the widget as out of date after", help: "Older data shows \"Updated …\" in amber", unit: "min", def: 720, min: 60, max: 2880, step: 60 },
  ]],
  ["Account", [
    { k: "athleteId", label: "Strava athlete ID", help: "The number from strava.com/athletes/<ID>. Leave empty to detect it. Applies next time you open the digest.", type: "text", def: "", pattern: "^\\d*$", bad: "The athlete ID is the number from strava.com/athletes/<ID>." },
  ]],
];
const CFG_FLAT = CONFIG.flatMap(([, items]) => items);
const cfgDef = k => CFG_FLAT.find(x => x.k === k);
const cfg = k => { const v = settings.cfg && settings.cfg[k]; return v === undefined ? cfgDef(k).def : v; };
// Validates and stores one tunable; returns an error message only for a text value that doesn't match its pattern.
function setCfg(k, v) {
  const d = cfgDef(k);
  if (!d) return "Unknown setting";
  settings.cfg = settings.cfg || {};
  if (v === null) { delete settings.cfg[k]; return ""; }   // Reset
  if (d.type === "text") { v = String(v || "").trim(); if (d.pattern && !new RegExp(d.pattern).test(v)) return d.bad || "That value isn't valid."; if (!v) v = d.def; }
  else if (d.type === "lines") { v = String(Array.isArray(v) ? v.join("\n") : v || "").split("\n").map(x => x.trim()).filter(Boolean).slice(0, 20); if (!v.length) v = d.def; }
  else {
    v = Number(String(v).replace(",", "."));   // accept a decimal comma
    if (!isFinite(v)) v = d.def;
    v = Math.min(d.max, Math.max(d.min, v));
    v = d.step < 1 ? Math.round(v / d.step) * d.step : Math.round(v);
    v = Number(v.toFixed(2));
  }
  if (JSON.stringify(v) === JSON.stringify(d.def)) delete settings.cfg[k]; else settings.cfg[k] = v;   // store only what differs
  return "";
}
const athleteId = () => /^\d+$/.test(String(cfg("athleteId"))) ? String(cfg("athleteId")) : null;

// Six palettes on the shared colour tokens. Strava orange is the accent in all of them; hr (heart rate) is this app's own extra colour.
const PALETTES = {
  ink:      { paper: "#f2f1ee", sheet: "#ffffff", ink: "#17171a", ink2: "#3a3a40", muted: "#6d6c72", rule: "#e3e1dc", signal: "#fc4c02", signalWash: "#ffe7dc", amber: "#9a6200", amberWash: "#fdf0d2", danger: "#c42b2b", hr: "#c92a5c", scheme: "light" },
  sepia:    { paper: "#f3ead6", sheet: "#fbf5e6", ink: "#2a1f14", ink2: "#4b3b2a", muted: "#73604a", rule: "#e1d3b5", signal: "#e8470a", signalWash: "#f8dcc8", amber: "#8a5a06", amberWash: "#f6e5bf", danger: "#9f1239", hr: "#b0294f", scheme: "light" },
  mint:     { paper: "#f1f6f3", sheet: "#ffffff", ink: "#0d2318", ink2: "#2c4a3b", muted: "#556d60", rule: "#d3e2d9", signal: "#f04a06", signalWash: "#fde3d6", amber: "#9a6200", amberWash: "#fbeed8", danger: "#b91c1c", hr: "#c92a5c", scheme: "light" },
  contrast: { paper: "#ffffff", sheet: "#ffffff", ink: "#000000", ink2: "#111111", muted: "#333333", rule: "#9a9a9a", signal: "#c43c00", signalWash: "#ffe2d3", amber: "#7a4b00", amberWash: "#ffeec2", danger: "#a30000", hr: "#a3123f", scheme: "light" },
  slate:    { paper: "#1c2128", sheet: "#22272e", ink: "#e6edf3", ink2: "#c5ced8", muted: "#9aa5b1", rule: "#373e47", signal: "#fc5c1a", signalWash: "#3a2216", amber: "#e3b341", amberWash: "#3a2f12", danger: "#ff8a7a", hr: "#ff7aa2", scheme: "dark" },
  night:    { paper: "#121214", sheet: "#1c1c20", ink: "#f1f0ee", ink2: "#d4d3d0", muted: "#9b9aa2", rule: "#2c2c31", signal: "#fc4c02", signalWash: "#3a1a0c", amber: "#f3c15c", amberWash: "#3b2d0f", danger: "#ff8f7a", hr: "#ff7aa2", scheme: "dark" },
};
const PALETTE_CSS = Object.entries(PALETTES).map(([k, p]) => `[data-theme=${k}]{--paper:${p.paper};--sheet:${p.sheet};--ink:${p.ink};--ink-2:${p.ink2};--muted:${p.muted};--rule:${p.rule};--signal:${p.signal};--signal-wash:${p.signalWash};--amber:${p.amber};--amber-wash:${p.amberWash};--danger:${p.danger};--hr:${p.hr};color-scheme:${p.scheme}}`).join("\n");

// The look for the first paint, so the page never flashes the default palette (the page keeps Auto live afterwards).
function lookState() {
  return { theme: settings.theme, density: settings.density, font: settings.font, textSize: settings.textSize,
           shown: settings.theme === "auto" ? (Device.isUsingDarkAppearance() ? "night" : "ink") : settings.theme };
}

// What the Settings sheet shows. Keys never go to the page: AI settings has its own sheet.
function settingsState() {
  return {
    settings: Object.fromEntries(Object.keys(SET_KEYS).map(k => [k, settings[k]])),
    cfg: Object.fromEntries(CFG_FLAT.map(d => [d.k, cfg(d.k)])),
    cfgSchema: CONFIG.map(([title, items]) => ({ title, items })),
    palettes: PALETTES, version: VERSION, appName: "Daily Digest",
    blueprints: BLUEPRINTS, blueprintsRepo: BLUEPRINTS_REPO,
    hasKey: !!aiKey(), aiStatus: aiStatusLine(),
    langs: DIGEST.AI.LANGUAGES, modes: DIGEST.AI.MODES.map(m => ({ key: m.key, label: m.label })),
    defaultRules: DEFAULT_COMMENT_RULES, styleProfile: settings.styleProfile || "", styleMeta: settings.styleMeta || null,
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
  if (!settings.checkUpdates || updateSnoozed()) return null;
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
  if (!code200 || !code.includes(`const APP_ID = '${APP_ID}'`) || !m) throw new Error("The download didn't look right. Try again later.");
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
      const r = await sx(`__SD.commentDirect(${JSON.stringify(tpl)}, ${JSON.stringify(id)}, ${JSON.stringify(text)})`, cfg('pageWait') * 1000);
      if (r.ok || !r.definite) return r;                 // posted, or unclear: never risk a double post
      Keychain.remove(KC_COMMENT_TPL);                    // Strava changed something: relearn below
    } catch (e) { return { ok: false, error: e.message }; }
  }
  let cv = new WebView();
  cv.shouldAllowRequest = req => /^(https?:|about:)/i.test((req && req.url) || '');   // never hand off to the Strava app
  try {
    const cx = makeSx(cv);
    await openStrava(cv, `/activities/${encodeURIComponent(id)}`);
    const r = await cx(`__SD.commentViaUI(${JSON.stringify(text)})`, cfg('detailsWait') * 1000);
    if (r.ok && r.req) learnCommentRequest(r.req, id, text);
    return r;
  } finally {
    try { await cv.loadHTML('<html></html>'); } catch (e) {}  // drop Strava's heavy page right away
    cv = null;
  }
}

// ─────────────── liking a comment on your own activity ───────────────
// Same pattern as posting comments: replay the request Strava's page sent last time,
// otherwise press Strava's own like button on the activity page and learn that request.

const KC_CLIKE_TPL = 'strava-digest-comment-like-request';

function readLikeTemplates() {
  try { return Keychain.contains(KC_CLIKE_TPL) ? JSON.parse(Keychain.get(KC_CLIKE_TPL)) : {}; } catch (e) { return {}; }
}

function learnLikeRequest(req, aid, cid, on) {
  if (!req || !req.url || !cid) return;
  const sub = (x) => String(x || '')
    .replace(new RegExp(`(^|[^0-9])${cid}(?![0-9])`, 'g'), '$1{{CID}}')
    .replace(new RegExp(`(^|[^0-9])${aid}(?![0-9])`, 'g'), '$1{{ID}}');
  const url = sub(req.url), body = req.body ? sub(String(req.body).replace(/(authenticity_token=)[^&]*/, '$1{{CSRF}}')) : '';
  if (!url.includes('{{CID}}') && !body.includes('{{CID}}')) return;   // can't tell which comment it targets
  const all = readLikeTemplates();
  all[on ? 'like' : 'unlike'] = { method: req.method || 'POST', url, body, ct: req.ct || '' };
  Keychain.set(KC_CLIKE_TPL, JSON.stringify(all));
  console.log(`Learned Strava's comment ${on ? 'like' : 'unlike'} request: ${req.method} ${url}`);
}

async function likeComment(sx, aid, cid, text, on) {
  const all = readLikeTemplates(), tpl = all[on ? 'like' : 'unlike'];
  if (tpl && cid) {
    const r = await sx(`__SD.likeDirect(${JSON.stringify(tpl)}, ${JSON.stringify(aid)}, ${JSON.stringify(cid)})`, cfg('pageWait') * 1000);
    if (r.ok || !r.definite) return r;                  // done, or unclear: never risk a double toggle
    delete all[on ? 'like' : 'unlike']; Keychain.set(KC_CLIKE_TPL, JSON.stringify(all));   // Strava changed: relearn
  }
  let cv = new WebView();
  cv.shouldAllowRequest = req => /^(https?:|about:)/i.test((req && req.url) || '');
  try {
    const cx = makeSx(cv);
    await openStrava(cv, `/activities/${encodeURIComponent(aid)}`);
    const r = await cx(`__SD.likeCommentViaUI(${JSON.stringify(text)}, ${!!on})`, cfg('detailsWait') * 1000);
    if (r.ok && r.req) learnLikeRequest(r.req, aid, cid, on);
    return r;
  } finally {
    try { await cv.loadHTML('<html></html>'); } catch (e) {}   // release Strava's heavy page at once
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
  try { return await sx('__SD.auth()', cfg('pageWait') * 1000); }
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
// Widgets can't use your Strava login, so the digest saves a small snapshot every time it loads
// today (and after each kudos) with saveWidget(); the widget only reads it (app-blueprints · widgets).

const dayKey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const LEGACY_SNAPSHOT = 'strava-digest-widget.json';   // 1.12.0 and earlier kept the summary here (iCloud Documents)

// Only what widgetModel() shows: counts and first names of people waiting, never tokens or the login.
function saveSnapshot(feed) {
  try {
    const { dayStart, dayEnd } = dayBounds(0);
    if (!feed.covers(+dayStart)) return;                 // today not fully read yet
    const acts = feed.day(+dayStart, +dayEnd);
    const people = groupByAthlete(acts);
    const waiting = people.filter(p => !p.kudoed);
    saveWidget({
      date: dayKey(dayStart),
      waiting: waiting.length, people: people.length,
      prs: acts.reduce((n, a) => n + (a.ach.prs || 0), 0),
      early: people.filter(p => p.early).length,
      list: waiting.slice(0, 6).map(p => ({
        name: String(p.name || '').split(/\s+/)[0], icon: emoji(p.primary.type),
        early: p.early ? p.early.icon : '', n: p.acts.length,
      })),
    });
    try {   // drop the old summary file once the new snapshot exists
      const ofm = (() => { try { return FileManager.iCloud(); } catch (e) { return FileManager.local(); } })();
      const old = ofm.joinPath(ofm.documentsDirectory(), LEGACY_SNAPSHOT);
      if (ofm.fileExists(old)) ofm.remove(old);
    } catch (e) {}
  } catch (e) { console.warn('Widget summary not saved: ' + e); }
}

// Kudos at a glance: people still waiting as the big number, who they are as rows; large adds PRs and early risers.
// Reads only the snapshot: no network, no Strava login, nothing written.
async function widgetModel() {
  const snap = readWidget();
  if (!snap || snap.date !== dayKey(new Date())) {
    return {
      empty: 'Open to load today',
      footer: snap && snap.at ? 'Last checked ' + wWhen(snap.at) : '',
      accessory: { glyph: '👍', inline: '👍 Open to load today' },
    };
  }
  const n = snap.waiting || 0;
  const rows = settings.widgetNames ? (snap.list || []).map(p => ({
    icon: p.icon, text: p.name + (p.early ? ' ' + p.early : '') + (p.n > 1 ? ' ×' + p.n : ''),
  })) : [];
  if (config.widgetFamily === 'large') {   // the frame shows 6 rows at most: keep room for the totals
    const extra = [];
    if (snap.prs) extra.push({ icon: '🏆', text: snap.prs + (snap.prs > 1 ? ' PRs' : ' PR'), tone: 'soft' });
    if (snap.early) extra.push({ icon: '🌅', text: snap.early + (snap.early > 1 ? ' early risers' : ' early riser'), tone: 'soft' });
    rows.splice(6 - extra.length);
    rows.push(...extra);
  }
  return {
    kicker: '👍 Kudos',
    value: n,
    caption: n ? (n === 1 ? 'person waiting' : 'people waiting') : snap.people ? 'All caught up 🎉' : 'Nobody posted yet',
    rows,
    footer: 'of ' + snap.people + ' today, ' + wWhen(snap.at),
    at: snap.at,
    accessory: { glyph: '👍', inline: '👍 ' + n + ' waiting for kudos' },
  };
}

// ───────── Widget ─────────
// Shared widget frame (github.com/gadominas/app-blueprints › blueprints/widgets.md).
// An app changes only WIDGET and widgetModel(); everything below WB is the same in every app.
const WIDGET = {
  name: ['Daily ', 'Digest'],             // as on the launch screen: plain part, highlighted part, optional rest
  accent: '#FB7185',                      // the logo's focal colour (the launch screen's --sp-accent)
  icon: REPO_RAW + 'docs/icon-1024.png',  // the app icon, cached on the phone after the first fetch
  words: { open: 'Tap to open', nothing: 'Nothing to show yet.', updated: 'Updated', yesterday: 'yesterday' },   // in the app's language
};
// Brand colours, the same in every app and in light and dark mode: the logo tile's ground and lines.
const WB = { ground: '#0E1116', raised: '#171B22', ink: '#F6F7F9', ink2: '#C9CED6', muted: '#9AA3AE', good: '#2DD4BF', warn: '#FBBF24' };
const wfm = FileManager.local();
const wPath = (n) => wfm.joinPath(wfm.documentsDirectory(), APP_ID + '-' + n);

// What the widget shows is saved by the app and only read by the widget: fast, offline, no sign-in.
function saveWidget(data) {
  try { wfm.writeString(wPath('widget.json'), JSON.stringify(Object.assign({}, data, { at: Date.now() }))); }
  catch (e) { console.log('Widget: not saved: ' + e); }
}
function readWidget() {
  try { const p = wPath('widget.json'); return wfm.fileExists(p) ? JSON.parse(wfm.readString(p)) : null; }
  catch (e) { return null; }
}

// Tones: ink, soft, muted, accent, good, warn, or a hex colour.
const wColor = (c, a = 1) => {
  const k = c === 'soft' ? 'ink2' : c;
  return new Color(k === 'accent' ? WIDGET.accent : (WB[k] || k), a);
};
// Rounded system fonts, falling back to the plain system font on older Scriptable versions.
function wFont(weight, size) {
  const name = { bold: 'boldRoundedSystemFont', semi: 'semiboldRoundedSystemFont', med: 'mediumRoundedSystemFont' }[weight] || 'regularRoundedSystemFont';
  if (typeof Font[name] === 'function') return Font[name](size);
  return weight === 'bold' ? Font.boldSystemFont(size) : weight === 'semi' ? Font.semiboldSystemFont(size) : weight === 'med' ? Font.mediumSystemFont(size) : Font.systemFont(size);
}
function wText(stack, s, size, weight, tone, lines = 1) {
  const t = stack.addText(String(s));
  t.font = wFont(weight, size);
  t.textColor = wColor(tone);
  t.lineLimit = lines;
  if (lines === 1) t.minimumScaleFactor = 0.75;
  return t;
}
function wWhen(ts) {
  const d = new Date(ts), now = new Date(), f = new DateFormatter();
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const ago = Math.round((day(now) - day(d)) / 864e5);
  if (ago === 1) return WIDGET.words.yesterday;
  f.dateFormat = ago === 0 ? 'HH:mm' : 'd MMM';
  return f.string(d);
}

// The app's logo tile, from the repository's icon, cached per app version; a monogram until then.
async function widgetIcon() {
  const p = wPath('widget-icon-' + VERSION + '.png');
  try {
    if (wfm.fileExists(p)) return wfm.readImage(p);
    const r = new Request(WIDGET.icon);
    r.timeoutInterval = 8;
    const dc = new DrawContext();
    dc.size = new Size(96, 96); dc.opaque = false; dc.respectScreenScale = false;
    dc.drawImageInRect(await r.loadImage(), new Rect(0, 0, 96, 96));
    const img = dc.getImage();
    const dir = wfm.documentsDirectory();
    wfm.listContents(dir).filter((f) => f.startsWith(APP_ID + '-widget-icon-')).forEach((f) => { try { wfm.remove(wfm.joinPath(dir, f)); } catch (e) {} });
    wfm.writeImage(p, img);
    return img;
  } catch (e) {
    return widgetMonogram();
  }
}
function widgetMonogram() {
  const dc = new DrawContext();
  dc.size = new Size(96, 96); dc.opaque = false; dc.respectScreenScale = false;
  dc.setFillColor(wColor('raised')); dc.fillRect(new Rect(0, 0, 96, 96));
  dc.setFont(wFont('bold', 54)); dc.setTextColor(wColor('accent')); dc.setTextAlignedCenter();
  dc.drawTextInRect(WIDGET.name.join('').charAt(0), new Rect(0, 14, 96, 70));
  return dc.getImage();
}

// Rows that fit: a line counts 1, a sub line 0.8; medium holds 5.5 (3 rows at most), large 12 (6 at most).
function wFit(rows, budget, max) {
  const out = [];
  let used = 0;
  for (const r of rows || []) {
    const n = (r.lines || 1) + (r.sub ? 0.8 : 0);
    if (out.length >= max || used + n > budget + 1e-9) break;   // 1e-9: 3 + 5 × 1.8 must still fit in 12
    used += n;
    out.push(r);
  }
  return out;
}
function wRows(stack, rows) {
  rows.forEach((r, i) => {
    if (i) stack.addSpacer(5);
    const row = stack.addStack();
    row.topAlignContent(); row.spacing = 6;
    if (r.url) row.url = r.url;
    if (r.icon) { const ic = row.addStack(); ic.size = new Size(15, 0); wText(ic, r.icon, 11.5, 'reg', 'ink'); }
    const tx = row.addStack();
    tx.layoutVertically();
    wText(tx, r.text, 12.5, r.lines ? 'reg' : 'med', r.tone || (r.lines ? 'soft' : 'ink'), r.lines || 1);
    if (r.sub) wText(tx, r.sub, 11, 'reg', 'muted');
  });
}

async function renderWidget(m) {
  const fam = config.widgetFamily || 'medium';
  const w = new ListWidget();
  w.url = m.url || URLScheme.forRunningScript();
  w.refreshAfterDate = new Date(Date.now() + cfg('widgetRefreshMin') * 60e3);
  if (fam.startsWith('accessory')) return renderAccessory(w, fam, m);
  const small = fam === 'small', medium = fam === 'medium', large = !small && !medium;
  const g = new LinearGradient();
  g.colors = [wColor('raised'), wColor('ground')]; g.locations = [0, 1];
  g.startPoint = new Point(0, 0); g.endPoint = new Point(0, 1);
  w.backgroundGradient = g;
  w.setPadding(14, 14, 14, 14);

  // 1. Header: logo tile, name (highlighted part in the accent), badge
  const hd = w.addStack();
  hd.centerAlignContent();
  const icon = hd.addImage(await widgetIcon());
  const is = small ? 18 : 20;
  icon.imageSize = new Size(is, is); icon.cornerRadius = is * 0.225;
  hd.addSpacer(6);
  WIDGET.name.forEach((part, i) => {
    if (!part) return;
    const t = hd.addText(part);
    t.font = wFont('bold', small ? 13 : 14); t.textColor = wColor(i === 1 ? 'accent' : 'ink'); t.lineLimit = 1;
  });
  hd.addSpacer();
  if (m.badge && !small) {
    const b = hd.addStack();
    b.setPadding(2, 7, 2, 7); b.cornerRadius = 8;
    b.backgroundColor = wColor(m.badgeTone || 'accent', 0.16);
    wText(b, m.badge, 11.5, 'semi', m.badgeTone || 'accent');
  }
  w.addSpacer(small ? 8 : 10);

  // Empty state: what to do next, never an error
  if (m.empty) {
    wText(w, m.empty, 13, 'semi', 'soft', 3);
    w.addSpacer();
    wText(w, m.footer || WIDGET.words.open, 11, 'reg', 'muted');
    Script.setWidget(w);
    return;
  }

  // 2. Hero: kicker, then a big value with its caption, or a title with its caption
  const body = w.addStack();
  body.topAlignContent();
  const left = body.addStack();
  left.layoutVertically();
  if (medium) left.size = new Size(136, 0);
  if (m.kicker) wText(left, m.kicker, 11, 'semi', m.kickerTone || 'accent');
  if (m.value != null && m.value !== '') {
    wText(left, m.value, small ? 40 : 42, 'bold', m.valueTone || 'ink');
    if (m.caption) wText(left, m.caption, 13, 'semi', 'ink');
  } else {
    if (m.title) wText(left, m.title, small ? 16 : 18, 'bold', 'ink', 2);
    if (m.caption) { left.addSpacer(2); wText(left, m.caption, 12, 'reg', 'soft', 2); }
  }

  // 3. Rows: beside the hero on medium, under it on large, none on small
  const rows = m.rows || [];
  if (medium && wFit(rows, 5.5, 3).length) {
    body.addSpacer(12);
    const right = body.addStack();
    right.layoutVertically();
    wRows(right, wFit(rows, 5.5, 3));
  }
  body.addSpacer();
  if (large && wFit(rows, 12, 6).length) { w.addSpacer(14); wRows(w, wFit(rows, 12, 6)); }

  // 4. Footer: one muted line; amber when the data is stale. Small shows the badge here if there's no footer.
  w.addSpacer();
  const ft = small ? (m.footer || m.badge) : m.footer;
  if (ft) wText(w, (m.stale ? '⟳ ' : '') + ft, 11, 'reg', m.stale ? 'warn' : 'muted');
  Script.setWidget(w);
}

// Lock Screen: iOS tints these, so text only, no colours or logo.
function renderAccessory(w, fam, m) {
  const name = WIDGET.name.join('');
  const a = m.accessory || {};
  const hasValue = m.value != null && m.value !== '';
  const hero = m.empty || (hasValue ? (m.value + ' ' + (m.caption || '')).trim() : (m.title || ''));
  if (fam === 'accessoryInline') {
    w.addText(a.inline || (hero ? name + ': ' + hero : name));
  } else if (fam === 'accessoryCircular') {
    w.addAccessoryWidgetBackground = true;
    const c = w.addStack();
    c.layoutVertically(); c.centerAlignContent();
    const gl = c.addText(a.glyph || name.charAt(0)); gl.font = Font.systemFont(11); gl.centerAlignText();
    const v = c.addText(String(a.value != null ? a.value : hasValue ? m.value : '–'));
    v.font = wFont('bold', 20); v.minimumScaleFactor = 0.5; v.centerAlignText();
  } else {
    const lines = [
      [[name, m.badge || m.kicker].filter(Boolean).join(' · '), 'semi', 12],
      [hero, 'bold', 15],
      [m.empty ? '' : hasValue ? (m.footer || '') : (m.caption || m.footer || ''), 'reg', 12],
    ];
    lines.forEach(([s, wt, size]) => { if (!s) return; const t = w.addText(s); t.font = wFont(wt, size); t.lineLimit = 1; t.minimumScaleFactor = 0.7; });
  }
  Script.setWidget(w);
}

// Widget runs come here and only here: no WebView, Alert or QuickLook may be built or presented.
async function runWidget() {
  const name = WIDGET.name.join('');
  let m = null;
  try { m = await widgetModel(args.widgetParameter || '', config.widgetFamily || 'medium'); }
  catch (e) { console.error('Widget model: ' + e); }
  if (!m) m = { empty: WIDGET.words.nothing };
  try {
    if (m.at && !m.empty && Date.now() - m.at > cfg('widgetStaleMin') * 60e3) {
      m.stale = true;
      m.footer = WIDGET.words.updated + ' ' + wWhen(m.at);
    }
    await renderWidget(m);
  } catch (e) {
    console.error('Widget render: ' + e);
    const w = new ListWidget();
    w.backgroundColor = wColor('ground');
    w.url = URLScheme.forRunningScript();
    wText(w, name, 14, 'bold', 'ink');
    w.addSpacer(4);
    wText(w, WIDGET.words.open, 12, 'reg', 'muted');
    Script.setWidget(w);
  }
}
// ───────── end of Widget ─────────

// Optional: run with ?refresh=1 (or the Shortcuts parameter "refresh") to update the widget
// summary without showing the digest, e.g. from a Shortcuts automation that runs Scriptable in-app.
async function refreshOnly() {
  const sv = new WebView(); const sx = makeSx(sv);
  await sv.loadURL(`${STRAVA}/robots.txt`);
  const me = athleteId() || (Keychain.contains(KC_ATHLETE) ? Keychain.get(KC_ATHLETE) : null);
  if (!me) throw new Error('Open the digest once first so it can log in.');
  const first = await sx(`__SD.page(${JSON.stringify(me)}, null, null, 0, 1e15, false)`, cfg('pageWait') * 1000);
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
      cmts: f.cmts || [], kudoers: f.kudoers || [],
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
        cmts: SD.commentsFrom(kc), kudoers: SD.peopleFrom(kc),
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

  // ── your own activities: who gave kudos, the comments, and liking a comment ──
  SD.nameOf = (o) => {
    if (!o || typeof o !== 'object') return '';
    const n = o.athleteName || o.athlete_name || o.displayName || o.display_name || o.fullName || o.full_name || o.name
      || [o.firstName || o.firstname || o.first_name, o.lastName || o.lastname || o.last_name].filter(Boolean).join(' ');
    return SD.text(typeof n === 'string' ? n : '');
  };
  SD.avatarOf = (o) => {
    const v = o && (o.avatarUrl || o.avatar_url || o.avatar || o.profile_medium || o.profileMedium || o.profile || o.picture || o.imageUrl);
    return typeof v === 'string' && /^https?:/.test(v) ? v : '';
  };
  SD.person = (o) => {
    const a = (o && (o.athlete || o.user || o.owner)) || o;
    const name = SD.nameOf(a);
    return name ? { id: String(a.id || a.athleteId || a.athlete_id || ''), name, avatar: SD.avatarOf(a) } : null;
  };
  // The longest list of people found under a key matching rx (kudos givers, by default).
  SD.peopleFrom = (o, rx) => {
    const keyRx = rx || /kudo|athletes|people|users|givers/i;
    let best = [];
    const take = (v) => { const list = v.map(SD.person).filter(Boolean); if (list.length > best.length) best = list; };
    if (Array.isArray(o)) take(o);
    // an array counts when its own key, or any key above it, matches (kudos: { athletes: [...] })
    const walk = (v, inside, depth) => {
      if (!v || typeof v !== 'object' || depth > 12) return;
      if (Array.isArray(v)) { v.forEach(x => walk(x, inside, depth + 1)); return; }
      for (const k of Object.keys(v)) {
        const x = v[k], hit = inside || keyRx.test(k);
        if (hit && Array.isArray(x) && x.length && x[0] && typeof x[0] === 'object') take(x);
        walk(x, hit, depth + 1);
      }
    };
    walk(o, false, 0);
    const seen = new Set();
    return best.filter(x => { const key = x.id || x.name; if (seen.has(key)) return false; seen.add(key); return true; });
  };
  SD.peopleFromHtml = (html) => {
    const out = [], seen = new Set(), re = /<a[^>]+href="\/athletes\/(\d+)"[^>]*>([\s\S]{0,600}?)<\/a>/gi;
    let m;
    while ((m = re.exec(html))) {
      const inner = m[2], alt = inner.match(/\balt="([^"]+)"/i) || inner.match(/\btitle="([^"]+)"/i);
      const name = SD.text(alt ? alt[1] : inner);
      if (!name || name.length > 60 || seen.has(m[1])) continue;
      const src = inner.match(/\bsrc="(https?:[^"]+)"/i);
      seen.add(m[1]); out.push({ id: m[1], name, avatar: src ? src[1] : '' });
    }
    return out;
  };
  SD.commentsFrom = (o) => {
    const conv = (c) => {
      if (!c || typeof c !== 'object') return null;
      const text = SD.text(c.text || c.body || c.content || c.comment || c.message || '');
      const nested = c.athlete || c.user || c.author || c.commenter;
      const who = SD.person(nested || c);
      if (!text || !who) return null;
      // the author's id: beside the comment (athlete_id) or inside its athlete record, never the comment's own id
      const aid = c.athlete_id ?? c.athleteId ?? c.author_id ?? c.authorId ?? c.user_id ?? c.userId
        ?? (nested && typeof nested === 'object' ? (nested.id ?? nested.athleteId ?? nested.athlete_id) : null);
      const likes = +(c.reactionCount ?? c.reaction_count ?? c.kudosCount ?? c.kudos_count ?? c.likeCount ?? c.likes ?? 0) || 0;
      const liked = !!(c.hasReacted ?? c.has_reacted ?? c.reacted ?? c.hasKudoed ?? c.kudosed ?? c.liked ?? false);
      const at = Date.parse(c.createdAt || c.created_at || c.timestamp || c.date || '');
      return { id: String(c.id ?? c.commentId ?? c.comment_id ?? ''), text, name: who.name, avatar: who.avatar, athleteId: aid != null ? String(aid) : '', likes, liked, at: isNaN(at) ? null : at };
    };
    let best = [];
    const take = (v) => { const list = v.map(conv).filter(Boolean); if (list.length > best.length) best = list; };
    if (Array.isArray(o)) take(o);
    SD.walk(o, (k, v) => { if (Array.isArray(v) && v.length && /comment/i.test(k)) take(v); });
    return best;
  };
  SD.getAny = async (path) => {
    try {
      const r = await fetch(path, { credentials: 'include', headers: XHR });
      if (!r.ok) return null;
      const t = await r.text();
      try { return JSON.parse(t); } catch (e) { return { __html: t }; }
    } catch (e) { return null; }
  };
  // The comments of one activity: Strava's comment endpoints first, then the page's own data.
  SD.commentsOf = async (id) => {
    for (const path of [`/feed/activity/${id}/comments`, `/activities/${id}/comments`]) {
      const d = await SD.getAny(path);
      if (!d || d.__html) continue;
      const list = SD.commentsFrom(d);
      if (list.length) return list;
    }
    const d = await SD.getAny(`/activities/${id}`);
    const nd = d && d.__html ? d.__html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/) : null;
    try { return nd ? SD.commentsFrom(JSON.parse(nd[1])) : []; } catch (e) { return []; }
  };
  // Your name as Strava shows it: profile settings first, then your athlete page.
  SD.whoAmI = async (id) => {
    const grab = (html, re) => { const m = html.match(re); return m ? SD.text(m[1]) : ''; };
    let d = await SD.getAny('/settings/profile');
    let html = d && d.__html ? d.__html : '';
    const first = grab(html, /name="athlete\[firstname\]"[^>]*value="([^"]*)"/i), last = grab(html, /name="athlete\[lastname\]"[^>]*value="([^"]*)"/i);
    if (first) return { name: [first, last].filter(Boolean).join(' ') };
    if (id) {
      d = await SD.getAny(`/athletes/${id}`);
      html = d && d.__html ? d.__html : '';
      const t = grab(html, /<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i) || grab(html, /<title>([^<]+)<\/title>/i);
      const name = t.split('|')[0].replace(/strava/i, '').trim();
      if (name) return { name };
    }
    return { name: '' };
  };
  // Comments for many activities, a few at a time (used by "Learn my style").
  SD.commentsMany = async (ids, conc) => {
    const out = {};
    for (let i = 0; i < ids.length; i += conc) {
      await Promise.all(ids.slice(i, i + conc).map(async (id) => { try { out[id] = await SD.commentsOf(id); } catch (e) { out[id] = []; } }));
    }
    return out;
  };
  // Who gave kudos and the comments for one activity, from whichever Strava source answers.
  SD.social = async (id) => {
    const out = { kudoers: [], comments: [], from: [] };
    for (const path of [`/feed/activity/${id}/kudos`, `/activities/${id}/kudos`]) {
      const d = await SD.getAny(path);
      if (!d) continue;
      const list = d.__html ? SD.peopleFromHtml(d.__html) : SD.peopleFrom(d);
      if (list.length) { out.kudoers = list; out.from.push(path); break; }
    }
    for (const path of [`/feed/activity/${id}/comments`, `/activities/${id}/comments`]) {
      const d = await SD.getAny(path);
      if (!d || d.__html) continue;
      const list = SD.commentsFrom(d);
      if (list.length) { out.comments = list; out.from.push(path); break; }
    }
    if (!out.kudoers.length || !out.comments.length) {
      const d = await SD.getAny(`/activities/${id}`);
      const html = d && d.__html ? d.__html : '';
      const nd = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
      let j = null;
      try { if (nd) j = JSON.parse(nd[1]); } catch (e) {}
      if (j && !out.kudoers.length) { const list = SD.peopleFrom(j, /kudo/i); if (list.length) { out.kudoers = list; out.from.push('page'); } }
      if (j && !out.comments.length) { const list = SD.commentsFrom(j); if (list.length) { out.comments = list; out.from.push('page'); } }
    }
    return out;
  };
  // Replays the like request Strava's page sent before (learned once, like comment posting).
  SD.likeDirect = async (tpl, aid, cid) => {
    const token = await SD.csrf();
    const fill = (x) => String(x || '').split('{{CID}}').join(cid).split('{{ID}}').join(aid).split('{{CSRF}}').join(encodeURIComponent(token || ''));
    const headers = Object.assign({}, XHR, { 'X-CSRF-Token': token });
    if (tpl.ct) headers['Content-Type'] = tpl.ct;
    let r;
    try { r = await fetch(fill(tpl.url), { method: tpl.method, credentials: 'include', headers, body: tpl.body ? fill(tpl.body) : undefined }); }
    catch (e) { return { ok: false, error: String(e), definite: false }; }
    if (r.ok) return { ok: true, via: `direct ${r.status}` };
    return { ok: false, error: `HTTP ${r.status}`, definite: r.status >= 400 && r.status < 500 };
  };
  // Likes (or unlikes) one comment with Strava's own button on the activity page.
  SD.likeCommentViaUI = async (text, on) => {
    SD.hookNet();
    const norm = (x) => String(x || '').replace(/\s+/g, ' ').trim();
    const want = norm(text).slice(0, 60);
    const find = () => {
      const els = [...document.querySelectorAll('li, article, div, section')].filter(el => visible(el) && norm(el.textContent).includes(want));
      els.sort((a, b) => a.textContent.length - b.textContent.length);
      return els[0] || null;
    };
    let el = await SD.waitFor(find, 8000);
    if (!el) {
      const more = [...document.querySelectorAll('button, a, [role="button"]')].find(b => visible(b) && COMMENT_RX.test(describe(b)));
      if (more) { more.click(); el = await SD.waitFor(find, 5000); }
    }
    if (!el) return { ok: false, error: 'that comment wasn’t found on Strava’s page' };
    const LIKE_RX = /like|kudo|react|heart|patinka|patiko|gef.llt|j.aime/i;
    // climb from the comment's text to its own like button; stop when more than one is in reach,
    // so a neighbouring comment's button is never pressed by mistake
    let btn = null, box = el;
    for (let i = 0; i < 5 && box && !btn; i++, box = box.parentElement) {
      const likes = [...box.querySelectorAll('button, [role="button"]')].filter(b => visible(b) && LIKE_RX.test(describe(b)) && !/reply|share|report|delete/i.test(describe(b)));
      if (likes.length > 1) return { ok: false, error: 'couldn’t tell which like button belongs to that comment' };
      btn = likes[0] || null;
    }
    if (!btn) return { ok: false, unsupported: true, error: 'Strava shows no like button for comments here' };
    const pressed = (b) => b.getAttribute('aria-pressed') === 'true' || /\b(liked|selected|active|is-active|filled)\b/i.test(String(b.className));
    if (pressed(btn) === on) return { ok: true, via: 'already' };
    window.__SDnet.length = 0;
    btn.click();
    const req = await SD.waitFor(() => window.__SDnet.find(r => r.method !== 'GET' && r.status), 10000);
    if (req && req.status >= 200 && req.status < 300) return { ok: true, via: `${req.method} ${req.url}`, req: { method: req.method, url: String(req.url), body: req.body || null, ct: req.ct || '' } };
    return { ok: false, error: req ? `Strava answered HTTP ${req.status}` : 'Strava did not respond' };
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
  for (let i = 0; i < cfg('daysInPicker'); i++) {
    const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - i);
    const label = i === 0 ? 'Today' : i === 1 ? 'Yesterday' : df.string(d);
    chips.push(`<button class="day${i === current ? ' on' : ''}" data-day="${i}"${i === current ? ' aria-current="date"' : ''}>${esc(label)}</button>`);
  }
  return `<nav class="seg" aria-label="Choose day">${chips.join('')}</nav>`;
}

// App logo: the route digest. A route from a teal start dot to a rose finish dot, with two faint digest lines,
// on its dark tile (#0E1116). Same geometry as docs/logo.svg, docs/icon-1024.png and the launch screen.
const LOGO_PARTS = '<path d="M140 162 H196 M152 186 H196" fill="none" stroke="#F6F7F9" stroke-opacity="0.35" stroke-width="7" stroke-linecap="round"/>'
  + '<path d="M62 184 C62 138 112 150 120 120 C128 90 176 102 176 58" fill="none" stroke="#F6F7F9" stroke-width="13" stroke-linecap="round" stroke-linejoin="round"/>'
  + '<circle cx="176" cy="56" r="20" fill="#FB7185" stroke="#0E1116" stroke-width="8"/>'
  + '<circle cx="62" cy="184" r="12" fill="#2DD4BF"/>';
const LOGO = '<svg viewBox="0 0 240 240" aria-hidden="true">' + LOGO_PARTS + '</svg>';

// Header icons: same size, same stroke, drawn in the text colour (Feather icons, MIT licence).
const ICON_GEAR = '<svg class="hico" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/></svg>';   // Settings (sliders)
const ICON_REFRESH = '<svg class="hico" viewBox="0 0 24 24" aria-hidden="true"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>';

// Sticky app header: brand row, then day switcher + "kudos to all", always within reach.
function appHeader(daysBack, open, people) {
  const all = !people ? ''
    : open > 0 ? `<button class="allk" data-act="kudo-all" data-label="👍 All ${open}" aria-label="Give kudos to all ${open}, one each">👍 All ${open}</button>`
    : `<button class="allk done" disabled aria-label="Everyone has your kudos">✓ All</button>`;
  return `<header class="hdr">
    <div class="brand"><span class="brand-mark">${LOGO}</span><span class="brand-name">Daily <span class="x">Digest</span></span>
      <button class="hbtn" data-act="settings" aria-label="Settings">${ICON_GEAR}</button><button class="hbtn" data-act="refresh" aria-label="Refresh">${ICON_REFRESH}</button></div>
    <div class="hrow">${daysNav(daysBack)}${all}</div>
    <div id="st" class="loadst" aria-live="polite"></div>
  </header>`;
}

function summaryText(people, count) {
  const prs = people.reduce((n, p) => n + p.acts.reduce((m, a) => m + (a.ach.prs || 0), 0), 0);
  const birds = people.filter(p => p.early).length;
  return `${people.length} ${people.length === 1 ? 'person' : 'people'}, ${count} ${count === 1 ? 'activity' : 'activities'}${prs ? `, ${prs} PR${prs > 1 ? 's' : ''}` : ''}${birds ? `, ${birds} early riser${birds > 1 ? 's' : ''}` : ''}`;
}

// "Today 06:42", "Yesterday 19:05"
function mineWhen(a) {
  const t = a.ts || a.start;
  if (!t) return '';
  const day = t >= +dayBounds(0).dayStart ? 'Today' : 'Yesterday';
  return a.clock ? `${day} ${fmtClock(a.clock)}` : day;
}
function mineLine(a) {
  const dist = a.km ? `${a.km.value.toFixed(1)} ${a.km.unit}` : ((a.stats || []).find(x => RX.time.test(x.label)) || {}).value;
  const pace = ((a.stats || []).find(x => RX.pace.test(x.label)) || {}).value;
  return [mineWhen(a), dist, pace].filter(Boolean).join(', ');
}
function agoLabel(t) {
  if (!t) return '';
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h` : `${Math.round(h / 24)}d`;
}
// Your latest activities, above everyone else's. Hidden when you have none today or yesterday.
function mineHtml(list) {
  if (!list || !list.length) return '<div id="mine" hidden></div>';
  const tiles = list.map(a => {
    const name = a.name || a.type || 'Activity', when = mineWhen(a);
    const sub = list.length === 1 ? [when, a.km ? `${a.km.value.toFixed(1)} ${a.km.unit}` : ''].filter(Boolean).join(', ') : when;
    return `<button class="mt" data-mine="${esc(a.id)}" data-name="${esc(name)}" data-emoji="${esc(emoji(a.type))}" data-line="${esc(mineLine(a))}" data-kudos="${+a.kudos || 0}" data-comments="${+a.comments || 0}" aria-label="${esc(name)}, ${+a.kudos || 0} kudos, ${+a.comments || 0} comments">
      <span class="mic" aria-hidden="true">${emoji(a.type)}</span>
      <span class="mtx"><b>${esc(name)}</b><small>${esc(sub)}</small></span>
      <span class="mcn"><span>👍 <b>${+a.kudos || 0}</b></span><span>💬 <b>${+a.comments || 0}</b></span></span></button>`;
  }).join('');
  return `<section id="mine" class="n${list.length}" aria-label="Your activities"><div class="mineh"><span>Your activities</span><small>Today &amp; yesterday</small></div><div class="minet">${tiles}</div></section>`;
}

function renderDigest({ dayStart, daysBack, scan, people, count, mine }) {
  const df = new DateFormatter(); df.dateFormat = 'EEEE, d MMMM';
  const summary = summaryText(people, count);
  const open = people.filter(p => !p.kudoed && p.primary.canKudo).length;
  const waiting = people.filter(p => !p.kudoed), given = people.filter(p => p.kudoed);
  const section = (title, list, cls) => list.length
    ? `<h2 class="sec ${cls}">${title}<span>${list.length}</span></h2>${list.map(personHtml).join('')}` : '';
  const body = people.length
    ? section('Waiting for your kudos', waiting, 'todo') + section('Kudos given', given, 'given')
    : `<div class="center"><svg class="idleMark" viewBox="0 0 240 240" role="img" aria-label="Daily Digest logo">${LOGO_PARTS}</svg>Nobody you follow has posted ${daysBack ? 'on that day' : 'yet today'}.<br><br><button class="ghost" data-act="refresh">Check again</button>${scanNote(scan)}</div>`;
  return page(`
    ${appHeader(daysBack, open, people.length)}
    <div class="top"><div><h1>${esc(df.string(dayStart))}</h1><div class="sub">${esc(summary)}</div></div></div>
    ${mineHtml(mine || [])}
    ${body}
    <p class="ver">Daily Digest v${VERSION}</p>`);
}

function scanNote(scan) {
  if (!scan) return '';
  const at = t => (t ? dayLabel(t) : 'unknown');
  return `<p class="scan">Read ${scan.pages} feed page${scan.pages === 1 ? '' : 's'} (${scan.entries} posts), feed reached ${esc(at(scan.position))}, oldest activity ${esc(at(scan.oldest))}. Stopped because ${esc(scan.stop)}.</p>`;
}

// What's inside an activity, as small chips: distance (or time), achievements, photos.
function actIndicators(a) {
  const out = [];
  if (a.km) out.push(`<span class="ic">📏 ${esc(a.km.value.toFixed(1))} ${esc(a.km.unit)}</span>`);
  else { const t = (a.stats || []).find(x => RX.time.test(x.label)); if (t) out.push(`<span class="ic">⏱ ${esc(t.value)}</span>`); }
  const pace = (a.stats || []).find(x => RX.pace.test(x.label));
  if (pace) out.push(`<span class="ic">👟 ${esc(pace.value)}</span>`);
  const ach = Math.max(a.ach.total || 0, a.ach.prs || 0);
  if (ach) out.push(`<span class="ic${a.ach.prs ? ' gold' : ''}">🏆 ${ach}</span>`);
  if (a.photos.length) out.push(`<span class="ic">📷 ${a.photos.length}</span>`);
  return out.join('');
}

// The same, totalled for one athlete's day (Tiny layout).
function personIndicators(p) {
  const out = [], ach = p.acts.reduce((n, a) => n + Math.max(a.ach.total || 0, a.ach.prs || 0), 0);
  const prs = p.acts.some(a => a.ach.prs), pics = p.acts.reduce((n, a) => n + a.photos.length, 0);
  if (p.total) out.push(`<span class="ic">📏 ${esc(p.total)}</span>`);
  else { const t = (p.primary.stats || []).find(x => RX.time.test(x.label)); if (t) out.push(`<span class="ic">⏱ ${esc(t.value)}</span>`); }
  const pace = (p.primary.stats || []).find(x => RX.pace.test(x.label));
  if (pace) out.push(`<span class="ic" title="${esc(pace.value)}">👟 ${esc(String(pace.value).replace(/\s*\/\s*\w+$/, ''))}</span>`);   // Tiny is tight: 4:38 rather than 4:38 /km
  if (ach) out.push(`<span class="ic${prs ? ' gold' : ''}">🏆 ${ach}</span>`);
  if (pics) out.push(`<span class="ic">📷 ${pics}</span>`);
  return out.join('');
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
  if (settings.density === 'tiny') {   // one line per athlete; the full activities stay in the DOM for the details sheet and comments
    const a = p.primary;
    return `<section class="person tiny" data-pid="${pid}"${p.kudoed ? ' data-counted="1"' : ''}>
    <header>${avatar}<div class="pn" data-expandp="${pid}" role="button" aria-expanded="false"><b>${esc(p.name)}${p.early ? ` <span class="nb">${p.early.icon}</span>` : ''}</b><span class="tline">${emoji(a.type)} ${esc(a.name || a.type || '')}${p.acts.length > 1 ? ` <span class="more">+${p.acts.length - 1} more</span>` : ''}</span><span class="ind">${personIndicators(p)}</span></div><span class="chev" data-expandp="${pid}" aria-hidden="true">⌄</span>${btn}</header>
    <div class="tacts" hidden>${p.acts.map(x => actHtml(x, p)).join('')}</div>
  </section>`;
  }
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
  const fold = settings.density === 'compact';
  return `<article class="act${fold ? ' fold' : ''}" data-id="${id}" data-who="${esc(String(p.name || '').split(/\s+/)[0])}" data-map="${esc(a.map || '')}">
    <div class="ah"${fold ? ` data-expand="${id}" role="button" aria-expanded="false"` : ''}><span class="emo">${emoji(a.type)}</span><div class="at"><b class="ttl"${fold ? '' : ` data-detail="${id}"`}>${esc(a.name || a.type || 'Activity')}</b>${main}<small>${meta}</small></div>${fold ? '<span class="chev" aria-hidden="true">⌄</span>' : ''}</div>
    ${fold ? `<div class="ind" data-expand="${id}">${actIndicators(a)}</div>` : ''}
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
      <div class="crow"><textarea rows="3" placeholder="${aiKey() ? 'Write a comment, or tap Suggest' : 'Write a comment'}"></textarea><button data-comment="${id}">Post</button></div>
      <div class="modes" role="group" aria-label="Comment mood">${DIGEST.AI.MODES.map(m =>
        `<button class="mode${m.key === settings.aiMode ? ' on' : ''}" data-mode="${esc(m.key)}">${esc(m.label)}</button>`).join('')}</div>
      <div class="ai"><button class="small" data-suggest="${id}">✨ Suggest 3</button>${DIGEST.AI.LANGUAGES.map(([code, name]) =>
        `<button class="lng${name === settings.aiLang ? ' on' : ''}" data-lang="${esc(name)}">${esc(code)}</button>`).join('')}</div>
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
  return page(`<div class="center">${isError ? '' : '<div class="loadspin"></div>'}<div id="st">${msg}</div>
    ${isError ? '<br><button class="ghost" data-act="refresh">Try again</button>' : ''}</div>`);
}

// Launch screen (app-blueprints · launch-screen 1.0.0). The digest loads a new page for every screen
// (boot, login, digest, refresh), so only the first page of a run carries it.
let launchDue = true;
function launchScreen() {
  if (!launchDue) return '';
  launchDue = false;
  return `<div class="splash" id="splash" role="img" aria-label="Daily Digest. Catch up. Cheer. Move on.">
  <div class="spIcon"><svg viewBox="0 0 240 240" aria-hidden="true">
    <path class="spFrame" d="M140 162 H196 M152 186 H196"></path>
    <path class="spDraw" pathLength="100" d="M62 184 C62 138 112 150 120 120 C128 90 176 102 176 58"></path>
    <circle class="spPop" cx="176" cy="56" r="20"></circle>
    <circle class="spDetail spStart" cx="62" cy="184" r="12"></circle>
  </svg></div>
  <div class="spWord">Daily <span>Digest</span></div>
  <div class="spTag">Catch up. Cheer. Move on.</div>
</div>
`;
}

function page(content) {
  const look = lookState();
  return `<!doctype html><html data-theme="${look.shown}" data-font="${look.font}" style="--ts:${look.textSize}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
<style>
:root{
  --ts:1; --serif: ui-serif, "New York", Georgia, serif; --sans: -apple-system, system-ui, "SF Pro Text", sans-serif; --display: var(--sans);
  --pad:14px; --gap:12px; --av:44px; --ph:132px;
}
html[data-font=serif]{--display:var(--serif)}
${PALETTE_CSS}
:root{--bg:var(--paper);--card:var(--sheet);--fg:var(--ink);--mut:var(--muted);--line:var(--rule);--accent:var(--signal);--gold:var(--amber);--goldbg:var(--amber-wash);--soft:color-mix(in srgb,var(--ink) 7%,var(--sheet))}
body.d-compact{--pad:10px;--gap:8px;--av:36px;--ph:96px}
body.d-tiny{--pad:9px;--gap:6px;--av:32px;--ph:96px}
*{box-sizing:border-box}
html,body{touch-action:pan-x pan-y;-webkit-text-size-adjust:100%}
button,img{touch-action:manipulation}
textarea,input{font-size:16px!important}
body{margin:0;background:var(--bg);color:var(--fg);font:calc(15px * var(--ts))/1.4 var(--sans);padding:max(14px,env(safe-area-inset-top)) 12px 70px;-webkit-text-size-adjust:100%}
.top{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:4px 4px 14px}
h1{font-family:var(--display);font-size:calc(24px * var(--ts));line-height:1.15;margin:0;letter-spacing:-.01em}
.sub{color:var(--mut);font-size:calc(13px * var(--ts));margin-top:2px}
button{font:inherit;border:0;border-radius:999px;padding:8px 14px;background:var(--accent);color:#fff;font-weight:600;cursor:pointer}
button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
button.ghost{background:var(--soft);color:var(--fg)}
button.round{width:40px;height:40px;padding:0;font-size:calc(18px * var(--ts));flex:none}
button.small{background:var(--soft);color:var(--fg);padding:6px 12px}
button.done,button:disabled{background:var(--soft);color:var(--mut)}
button.all{width:100%;margin:0 0 14px;padding:12px}
.person{background:var(--card);border-radius:18px;padding:var(--pad);margin-bottom:var(--gap)}
.person header{display:flex;align-items:center;gap:10px}
.av{width:var(--av);height:var(--av);border-radius:50%;object-fit:cover;flex:none;background:var(--soft)}
.av.ph{display:grid;place-items:center;font-weight:700;color:var(--mut)}
.pn{flex:1;min-width:0}.pn b{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-family:var(--display);font-size:calc(16px * var(--ts))}.pn span{color:var(--mut);font-size:calc(13px * var(--ts))}
.act{border-top:1px solid var(--line);margin-top:var(--pad);padding-top:var(--pad)}
.ah{display:flex;gap:10px;align-items:flex-start}.emo{font-size:calc(22px * var(--ts));line-height:1.1}
.at b{font-family:var(--display);font-size:calc(16px * var(--ts))}.at small{display:block;color:var(--mut);font-size:calc(12px * var(--ts))}
.main{font-size:calc(11px * var(--ts));color:var(--accent);font-weight:700;margin-left:6px}
.stats{display:grid;grid-template-columns:repeat(auto-fill,minmax(88px,1fr));gap:12px 10px;margin-top:12px}
.st b{display:block;font-size:calc(19px * var(--ts));font-weight:650;letter-spacing:-.01em;font-variant-numeric:tabular-nums;line-height:1.15}
.st small{color:var(--mut);font-size:calc(12px * var(--ts))}
.st.hr b{color:var(--hr)}
.badges{display:flex;gap:6px;margin-top:10px;flex-wrap:wrap}
.pr{background:var(--goldbg);color:var(--gold);border-radius:999px;padding:3px 10px;font-weight:700;font-size:calc(13px * var(--ts))}
.pr.soft{font-weight:600}
.alist{margin:6px 0 0;padding-left:18px;color:var(--mut);font-size:calc(13px * var(--ts))}
.desc{margin:10px 0 0;font-size:calc(14px * var(--ts));white-space:pre-wrap}
.photos{display:flex;gap:6px;overflow-x:auto;margin:var(--gap) calc(-1 * var(--pad)) 0;padding:0 var(--pad);scroll-snap-type:x mandatory}
.hdr{position:sticky;top:0;z-index:20;margin:calc(-1 * max(14px, env(safe-area-inset-top))) -12px 14px;padding:max(4px, env(safe-area-inset-top)) 12px 8px;background:var(--bg);border-bottom:1px solid var(--line);transition:box-shadow .2s}
.hdr.stuck{box-shadow:0 8px 18px -12px rgba(0,0,0,.6)}
.brand{display:flex;align-items:center;gap:8px;min-height:44px}
.brand-mark{display:block;width:30px;height:30px;border-radius:8px;background:#0E1116;flex:none;overflow:hidden;box-shadow:inset 0 0 0 1px rgba(246,247,249,.14)}
.brand-mark svg{display:block;width:100%;height:100%}
.brand-name{font-family:var(--display);font-weight:800;font-size:calc(19px * var(--ts));line-height:1;letter-spacing:-.01em;margin-right:auto}
.brand-name .x{color:#E11D48}
[data-theme=slate] .brand-name .x,[data-theme=night] .brand-name .x{color:#FB7185}
.hbtn{background:var(--card);border:1px solid var(--line);color:var(--fg);width:40px;height:40px;border-radius:20px;padding:0;display:grid;place-items:center}
.hbtn .hico{width:20px;height:20px}
.hico{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;display:block}
.hrow{display:flex;align-items:center;gap:8px}
.seg{flex:1;min-width:0;display:flex;gap:2px;padding:3px;border-radius:999px;background:var(--card);overflow-x:auto;scrollbar-width:none}
.seg::-webkit-scrollbar{display:none}
.day{flex:1 0 auto;background:transparent;color:var(--mut);padding:6px 10px;font-size:calc(13px * var(--ts));font-weight:600;white-space:nowrap}
.day.on{background:var(--fg);color:var(--bg)}
.allk{flex:none;padding:8px 13px;font-size:calc(13px * var(--ts));white-space:nowrap;font-variant-numeric:tabular-nums}
.allk.done{background:var(--card);color:var(--mut)}
.allk.armed{background:var(--fg);color:var(--bg)}
.scan{margin:28px auto 0;max-width:34em;font-size:calc(12px * var(--ts));line-height:1.5;color:var(--mut);word-break:break-word}
.sec{display:flex;align-items:center;gap:8px;font-size:calc(13px * var(--ts));font-weight:700;color:var(--mut);margin:18px 6px 10px}
.sec:first-of-type{margin-top:4px}
.sec span{background:var(--soft);color:var(--fg);border-radius:999px;padding:1px 9px;font-size:calc(12px * var(--ts));font-variant-numeric:tabular-nums}
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
.cnt b{display:block;font-size:calc(56px * var(--ts));line-height:1;font-weight:800;letter-spacing:-.02em;font-variant-numeric:tabular-nums;margin-top:6px}
.cnt span{color:var(--mut);font-size:calc(13px * var(--ts))}
.cnt.tick b{animation:tick .3s ease-out}
@keyframes tick{40%{transform:scale(1.12);color:var(--accent)}}
.quip{font-size:calc(16px * var(--ts));font-weight:600;margin-top:16px;min-height:1.4em;transition:opacity .25s}
.bootst{color:var(--mut);font-size:calc(13px * var(--ts));margin-top:4px}
@media (prefers-reduced-motion:reduce){.track,.sunb,.post,.cnt.tick b,.runner .body,.thigh,.shin,.uarm{animation:none}.post{display:none}}
#ptr{position:fixed;left:50%;top:env(safe-area-inset-top,0px);transform:translate(-50%,-60px);opacity:0;z-index:30;display:flex;align-items:center;gap:8px;background:var(--card);color:var(--fg);padding:9px 15px;border-radius:999px;font-size:calc(13px * var(--ts));font-weight:600;box-shadow:0 6px 18px rgba(0,0,0,.28);pointer-events:none;transition:opacity .15s}
#ptr .ptri{display:inline-block;font-size:calc(16px * var(--ts));line-height:1}
#ptr.ready{color:var(--accent)}
#ptr.busy{transition:transform .2s,opacity .15s}
#ptr.busy .ptri{animation:s .8s linear infinite}
.loadst{display:none;color:var(--mut);font-size:calc(12px * var(--ts));margin:6px 4px 0}
body.loading .loadst{display:block}
.clk{font-weight:700;color:var(--fg);font-variant-numeric:tabular-nums}
.nb{font-size:calc(15px * var(--ts))}
.early{border-radius:999px;padding:3px 11px;font-weight:700;font-size:calc(13px * var(--ts));color:#fff}
.early.e4{background:linear-gradient(135deg,#070b1f,#2a1d5e);box-shadow:inset 0 0 0 1px #6c5ce7}
.early.e5{background:linear-gradient(135deg,#1c2a6e,#8a3f8f)}
.early.e6{background:linear-gradient(135deg,#f9a826,#f2541b)}
#lb{position:fixed;inset:0;z-index:50;background:#000;display:flex;flex-direction:column}
#lb[hidden]{display:none}
#upd{position:fixed;inset:0;z-index:48;background:rgba(0,0,0,.55);display:flex;align-items:flex-end}
.updp{width:100%;background:var(--card);border-radius:22px 22px 0 0;padding:20px 18px calc(16px + env(safe-area-inset-bottom));display:flex;flex-direction:column;gap:8px;animation:up .25s ease-out}
.updtag{align-self:flex-start;background:var(--accent);color:#fff;font-size:calc(12px * var(--ts));font-weight:800;padding:4px 10px;border-radius:999px;letter-spacing:.02em}
.updt{margin:6px 0 0;font-family:var(--display);font-size:calc(22px * var(--ts));line-height:1.2;letter-spacing:-.01em}
.upds{color:var(--mut);font-size:calc(14px * var(--ts))}
.updl{display:flex;flex-direction:column;gap:10px;margin:8px 0 6px}
.updi{display:flex;gap:12px;align-items:flex-start;background:var(--soft);border-radius:14px;padding:12px}
.updic{font-size:calc(24px * var(--ts));line-height:1.1;flex:none}
.updi b{display:block;font-size:calc(15px * var(--ts))}
.updi span{display:block;color:var(--mut);font-size:calc(13px * var(--ts));line-height:1.35;margin-top:2px}
.updmsg{font-size:calc(14px * var(--ts));min-height:0}
.updmsg:empty{display:none}
.updgo{padding:13px;font-size:calc(16px * var(--ts))}
.updlater{padding:11px}
.ver{text-align:center;color:var(--mut);font-size:calc(12px * var(--ts));margin:24px 0 0;opacity:.7}
#kov{position:fixed;inset:0;z-index:66;background:rgba(0,0,0,.86);display:grid;place-items:center;touch-action:none}
#kov[hidden]{display:none}
.kwrap{text-align:center;padding:20px}
.kst{position:relative;margin:0 auto}
.kpc{position:absolute;left:50%;top:50%;width:76px;height:76px;margin:-38px 0 0 -38px;border-radius:50%;background:var(--accent);display:grid;place-items:center;font-size:calc(44px * var(--ts));animation:kpulse 1.1s ease-out infinite;z-index:2}
@keyframes kpulse{0%{box-shadow:0 0 0 0 rgba(252,76,2,.6)}100%{box-shadow:0 0 0 28px rgba(252,76,2,0)}}
#kov.fin .kpc{animation:kdone .6s cubic-bezier(.3,1.6,.5,1) forwards}
@keyframes kdone{40%{transform:scale(1.25) rotate(-12deg)}100%{transform:scale(1.05)}}
.kaw{position:absolute;width:var(--A);height:var(--A);margin:calc(var(--A) / -2) 0 0 calc(var(--A) / -2);animation:kin .4s ease-out both}
@keyframes kin{from{transform:scale(.3);opacity:0}}
.ka{width:100%;height:100%;border-radius:50%;overflow:hidden;background:#2a2a30;color:#bbb;display:grid;place-items:center;font-weight:700;font-size:calc(13px * var(--ts));box-shadow:0 0 0 2px rgba(255,255,255,.18);transition:box-shadow .25s}
.ka img{width:100%;height:100%;object-fit:cover}
.ka.hit{animation:khit .45s cubic-bezier(.3,1.6,.5,1)}
@keyframes khit{40%{transform:scale(1.28)}}
.ka.ok{box-shadow:0 0 0 3px #2fb344}
.ka.bad{box-shadow:0 0 0 3px #e5484d}
.kk{position:absolute;right:-4px;bottom:-4px;width:18px;height:18px;border-radius:50%;font-size:calc(11px * var(--ts));font-weight:800;color:#fff;display:grid;place-items:center;transform:scale(0);transition:transform .3s cubic-bezier(.3,1.6,.5,1)}
.kk.ok{background:#2fb344;transform:scale(1)}
.kk.bad{background:#e5484d;transform:scale(1)}
.fly{position:absolute;left:50%;top:50%;width:30px;height:30px;margin:-15px 0 0 -15px;font-size:calc(26px * var(--ts));line-height:30px;text-align:center;z-index:3;pointer-events:none;transition:transform .7s cubic-bezier(.25,.7,.35,1),opacity .25s}
.ktitle{color:#fff;font-size:calc(19px * var(--ts));font-weight:700;margin-top:22px}
.ksub{color:rgba(255,255,255,.7);font-size:calc(14px * var(--ts));margin-top:4px;min-height:1.3em}
@media (prefers-reduced-motion:reduce){.kpc,.kaw,.ka.hit{animation:none}}
#csheet{position:fixed;inset:0;z-index:47;background:rgba(0,0,0,.5);display:flex;align-items:flex-end}
#csheet[hidden]{display:none}
.csp{width:100%;max-height:94vh;background:var(--bg);border-radius:20px 20px 0 0;display:flex;flex-direction:column;overflow:hidden;animation:up .22s ease-out}
.csh{display:flex;align-items:center;gap:12px;padding:8px 16px 12px;border-bottom:1px solid var(--line)}
.csb{overflow-y:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;padding:14px 16px calc(18px + env(safe-area-inset-bottom,0px))}
.incs{margin-top:0}
.incs textarea{font-size:16px;min-height:100px;line-height:1.4}
.cslab{font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--mut);margin:18px 0 0}
.incs .modes{margin:8px -16px 0;padding:0 16px}
body.nokey .incs .cslab{display:none}
#cfgsheet textarea.rules{display:block;width:100%;box-sizing:border-box;min-height:200px;margin-top:8px;font-size:15px;line-height:1.45}
.stylebtns{display:flex;align-items:center;gap:10px;margin-top:10px;flex-wrap:wrap}
.styleprof{margin-top:10px;padding:10px 12px;border-radius:12px;background:var(--soft)}
.styleprof p{margin:6px 0 0;white-space:pre-wrap;font-size:13px;line-height:1.45}
#mine{background:var(--card);border-radius:18px;padding:12px;margin:0 0 14px}
#mine[hidden]{display:none}
.mineh{display:flex;align-items:baseline;justify-content:space-between;gap:8px;padding:0 2px 10px}
.mineh span{font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--mut)}
.mineh small{font-size:12px;color:var(--mut)}
.minet{display:grid;gap:8px}
#mine.n1 .minet{grid-template-columns:minmax(0,1fr)}
#mine.n2 .minet{grid-template-columns:repeat(2,minmax(0,1fr))}
#mine.n3 .minet{grid-template-columns:repeat(3,minmax(0,1fr))}
.mt{min-width:0;display:flex;flex-direction:column;align-items:flex-start;gap:8px;padding:10px 12px;border-radius:14px;background:var(--soft);color:var(--fg);text-align:left;font-weight:400}
.mt .mic{width:30px;height:30px;border-radius:50%;background:var(--bg);display:grid;place-items:center;font-size:16px;flex:none}
.mtx{display:flex;flex-direction:column;gap:2px;min-width:0;width:100%}
.mtx b{font-size:calc(13px * var(--ts));white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mtx small{font-size:calc(12px * var(--ts));color:var(--mut);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mcn{display:flex;gap:10px;font-size:calc(13px * var(--ts));font-variant-numeric:tabular-nums;white-space:nowrap}
#mine.n1 .mt{flex-direction:row;align-items:center;gap:12px}
#mine.n1 .mt .mic{width:40px;height:40px;font-size:20px}
#mine.n1 .mtx{flex:1;width:auto}
#mine.n1 .mtx b{font-size:calc(15px * var(--ts))}
#mine.n1 .mcn{font-size:calc(15px * var(--ts))}
#mine.n2 .mt{display:grid;grid-template-columns:auto minmax(0,1fr);column-gap:10px;row-gap:4px;align-items:center}
#mine.n2 .mt .mic{grid-row:span 2}
#mine.n2 .mtx small{display:none}
#mine.n3 .mt{padding:10px}
#mine.n3 .mtx b{white-space:normal;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;line-height:1.25}
#mine.n3 .mtx small{white-space:normal;line-height:1.25}
#mine.n3 .mcn{gap:8px;flex-wrap:wrap;margin-top:auto}
#msheet{position:fixed;inset:0;z-index:46;background:rgba(0,0,0,.5);display:flex;align-items:flex-end}
#msheet[hidden]{display:none}
.msp{width:100%;max-height:92vh;background:var(--bg);border-radius:20px 20px 0 0;display:flex;flex-direction:column;overflow:hidden;animation:up .22s ease-out}
.msgrab{width:40px;height:5px;border-radius:999px;background:var(--line);margin:8px auto 0;flex:none}
.msh{display:flex;align-items:center;gap:12px;padding:10px 16px 14px;border-bottom:1px solid var(--line)}
.msh .mic{width:42px;height:42px;border-radius:50%;background:var(--soft);display:grid;place-items:center;font-size:22px;flex:none}
.mtt{flex:1;min-width:0}
.mtt b{display:block;font-size:19px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mtt small{display:block;color:var(--mut);font-size:13px}
.mbtn{width:40px;height:40px;border-radius:50%;padding:0;background:var(--soft);color:var(--fg);font-size:18px;flex:none}
.msb{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;padding:14px 16px;display:flex;flex-direction:column;gap:18px}
.msect{font-size:16px;margin-bottom:8px}
.mbox{display:flex;align-items:center;gap:12px;width:100%;padding:12px;border-radius:14px;background:var(--card);color:var(--fg);text-align:left;font-weight:400;font-size:14px;line-height:1.35}
.mbox.muted{color:var(--mut)}
.mstack{display:flex;flex:none}
.mstack .mavw{margin-left:-6px;box-shadow:0 0 0 2px var(--card);font-size:11px}
.mstack .mavw:first-child{margin-left:0}
.mkt{flex:1;min-width:0}
.mall{color:var(--accent);font-weight:700;font-size:13px;white-space:nowrap}
.mavw{position:relative;border-radius:50%;background:var(--soft);color:var(--mut);display:grid;place-items:center;font-weight:700;font-size:12px;flex:none;overflow:hidden}
.mavw img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.mcom{display:flex;gap:10px;align-items:flex-start;padding:12px 0;border-top:1px solid var(--line)}
.mctx{flex:1;min-width:0}
.mctx b{font-size:14px}
.mctx small{color:var(--mut);font-size:12px;margin-left:4px}
.mctx p{margin:3px 0 0;font-size:15px;line-height:1.35;word-break:break-word}
.mheart{flex:none;min-width:52px;height:44px;border-radius:12px;background:transparent;color:var(--mut);display:flex;align-items:center;justify-content:center;gap:5px;padding:0 6px;font-size:13px;font-weight:700;font-variant-numeric:tabular-nums}
.mheart svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:2;stroke-linejoin:round;stroke-linecap:round}
.mheart.on{color:var(--accent)}
.mheart.on svg{fill:currentColor}
.mheart:disabled{background:transparent;opacity:.55}
.mrow{display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--line)}
.mname{flex:1;min-width:0;font-weight:600;font-size:15px}
.mtag{font-size:12px;color:var(--mut);font-weight:600;white-space:nowrap}
.msf{padding:10px 16px calc(14px + env(safe-area-inset-bottom,0px));border-top:1px solid var(--line);flex:none}
.msf button{width:100%;padding:12px}
.mnote{color:var(--mut);font-size:13px;margin:0}
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
.detf button{padding:11px 8px;font-size:calc(14px * var(--ts))}
.ttl{cursor:pointer}
#sendov{position:fixed;inset:0;z-index:70;background:rgba(0,0,0,.8);display:grid;place-items:center;touch-action:none;padding:20px}
#sendov[hidden]{display:none}
.sv{width:min(330px,100%);background:var(--card);border-radius:24px;padding:20px 18px 22px;text-align:center;box-shadow:0 24px 60px rgba(0,0,0,.45)}
.stage{position:relative;width:280px;height:130px;margin:0 auto 8px}
.arc{position:absolute;inset:0;width:280px;height:130px;overflow:visible}
.arc path{fill:none;stroke:var(--line);stroke-width:2.5;stroke-linecap:round;stroke-dasharray:3 8;animation:ants .7s linear infinite}
@keyframes ants{to{stroke-dashoffset:-22}}
.me,.them{position:absolute;top:37px;width:56px;height:56px;border-radius:50%;background:var(--soft);display:grid;place-items:center;overflow:hidden}
.me{left:6px;font-size:calc(26px * var(--ts));animation:scribble 1.9s ease-in-out infinite}
.them{left:218px;font-weight:700;color:var(--mut);font-size:calc(18px * var(--ts));box-shadow:0 0 0 3px var(--card),0 0 0 5px var(--accent);animation:catch 1.9s ease-in-out infinite}
.them img{width:100%;height:100%;object-fit:cover}
.plane{position:absolute;left:0;top:0;width:30px;height:30px;font-size:calc(26px * var(--ts));line-height:30px;animation:fly 1.9s ease-in-out infinite;will-change:transform}
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
.chk{position:absolute;left:252px;top:28px;width:28px;height:28px;border-radius:50%;background:#2fb344;color:#fff;font-weight:800;font-size:calc(16px * var(--ts));display:grid;place-items:center;transform:scale(0)}
.bit{position:absolute;left:236px;top:55px;font-size:calc(18px * var(--ts));pointer-events:none;animation:pop .95s ease-out forwards}
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
.svt{font-size:calc(18px * var(--ts));font-weight:700;margin-top:4px}
.svs{color:var(--mut);font-size:calc(14px * var(--ts));margin-top:4px;min-height:2.6em}
.svq{margin:10px 0 0;font-size:calc(14px * var(--ts));font-style:italic;color:var(--fg);opacity:.85;word-break:break-word}
.svok{margin-top:14px;min-width:120px}
@media (prefers-reduced-motion:reduce){
  .plane{animation:none;transform:translate(125px,15px)}
  .me,.them,.arc path{animation:none}
  .bit{display:none}}
#sheet{position:fixed;inset:0;z-index:40;background:rgba(0,0,0,.45);display:flex;align-items:flex-end}
#sheet[hidden]{display:none}
.shc{width:100%;background:var(--card);border-radius:18px 18px 0 0;padding:14px 14px calc(14px + env(safe-area-inset-bottom));display:grid;gap:8px}
.shc button{padding:13px}
.lbtop{display:flex;justify-content:space-between;align-items:center;padding:10px 14px;color:#fff;font-size:calc(14px * var(--ts));font-variant-numeric:tabular-nums;min-height:58px}
.lbx{background:rgba(255,255,255,.18);color:#fff;width:38px;height:38px;padding:0;font-size:calc(16px * var(--ts))}
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
.lbclose{pointer-events:auto;background:#fff;color:#111;font-size:calc(16px * var(--ts));font-weight:700;padding:12px 28px;box-shadow:0 6px 20px rgba(0,0,0,.45)}
.lbhint{color:rgba(255,255,255,.6);font-size:calc(12px * var(--ts));transition:opacity .3s}
#lb.zoomed .lbhint{opacity:0}
.photos img{height:var(--ph);max-width:220px;border-radius:12px;flex:none;object-fit:cover;scroll-snap-align:start;background:var(--soft)}
.bar{display:flex;align-items:center;gap:6px;margin-top:12px}
.counts{flex:1;color:var(--mut);font-size:calc(13px * var(--ts))}.counts i{font-style:normal;font-variant-numeric:tabular-nums}
.cbox{margin-top:8px}.cbox[hidden]{display:none}
.crow{display:flex;gap:6px;align-items:flex-end}
.ai{display:flex;gap:6px;align-items:center;margin-top:8px}
.modes{display:flex;gap:6px;margin:10px -14px 0;padding:0 14px;overflow-x:auto;scrollbar-width:none}
.modes::-webkit-scrollbar{display:none}
.mode{flex:none;background:var(--soft);color:var(--fg);padding:7px 12px;font-size:calc(13px * var(--ts));font-weight:600;border:1px solid transparent}
.mode.on{background:var(--fg);color:var(--bg)}
.lng{background:transparent;color:var(--mut);padding:6px 10px;border:1px solid var(--line)}
.lng.on{background:var(--soft);color:var(--fg);border-color:var(--soft)}
.sugs{display:flex;flex-direction:column;gap:6px;margin-top:8px}
.sug{background:var(--soft);color:var(--fg);font-weight:500;text-align:left;border-radius:14px;padding:9px 12px;line-height:1.35}
.keyrow{display:flex;gap:6px}.keyrow input{flex:1;min-width:0;font:inherit;border-radius:12px;border:1px solid var(--line);background:var(--bg);color:var(--fg);padding:8px 10px}
.keyhelp{font-size:calc(12px * var(--ts));color:var(--mut);margin:0}
textarea{flex:1;font:inherit;border-radius:14px;border:1px solid var(--line);background:var(--bg);color:var(--fg);padding:8px 10px;resize:none}
.center{text-align:center;color:var(--mut);padding:80px 20px}
.loadspin{width:28px;height:28px;border:3px solid var(--line);border-top-color:var(--accent);border-radius:50%;margin:0 auto 14px;animation:s 1s linear infinite}
@keyframes s{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.loadspin{animation-duration:3s}}
/* Route-digest logo on the empty day */
.idleMark{display:block;width:76px;height:76px;margin:0 auto 14px;border-radius:18px;background:#0E1116}
/* Launch screen (app-blueprints · launch-screen 1.0.0) */
.splash{--sp-bg:#0E1116;--sp-ink:#F6F7F9;--sp-accent:#FB7185;--sp-accent2:#2DD4BF;--sp-muted:#9AA3AE;--sp-font:var(--display);
  position:fixed;inset:0;z-index:90;background:var(--sp-bg);color:var(--sp-ink);
  display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;cursor:pointer;
  animation:spOut .4s ease 2.4s forwards}
.splash.gone{display:none}
.spIcon{width:148px;height:148px;opacity:0;transform:scale(.86);animation:spIn .5s cubic-bezier(.2,.9,.3,1.2) .05s forwards}
.spIcon svg{width:100%;height:100%;display:block;overflow:visible}
.spFrame{fill:none;stroke:var(--sp-ink);stroke-opacity:.35;stroke-width:7;stroke-linecap:round;stroke-linejoin:round;opacity:0;animation:spFade .4s ease .25s forwards}
.spDraw{fill:none;stroke:var(--sp-ink);stroke-width:13;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:100;stroke-dashoffset:100;animation:spDraw .8s ease-in-out .15s forwards}
.spPop{fill:var(--sp-accent);transform-box:fill-box;transform-origin:center;transform:scale(0);animation:spPop .45s cubic-bezier(.3,1.7,.5,1) .75s forwards}
.spDetail{fill:var(--sp-ink);opacity:0;animation:spFade .3s ease 1.05s forwards}
.spSweep{fill:none;stroke:var(--sp-accent2);stroke-width:7;stroke-linecap:round;opacity:0;transform:translateX(var(--sp-sweep-from,-120px));animation:spSweep 1s ease-in-out .95s forwards}
.spWord{font:800 40px/1 var(--sp-font,ui-rounded,-apple-system,system-ui,sans-serif);letter-spacing:-.02em;opacity:0;transform:translateY(10px);animation:spUp .45s ease 1.05s forwards}
.spWord span{color:var(--sp-accent)}
.spTag{font:600 15px/1.3 -apple-system,system-ui,sans-serif;letter-spacing:.06em;color:var(--sp-muted);opacity:0;transform:translateY(8px);animation:spUp .45s ease 1.4s forwards}
/* Logo parts the blueprint's classes don't colour: the teal start dot and the finish dot's cut-out ring */
.splash .spStart{fill:var(--sp-accent2)}
.splash .spPop{stroke:var(--sp-bg);stroke-width:8}
@keyframes spIn{to{opacity:1;transform:scale(1)}}
@keyframes spFade{to{opacity:1}}
@keyframes spDraw{to{stroke-dashoffset:0}}
@keyframes spPop{to{transform:scale(1)}}
@keyframes spSweep{0%{opacity:0}15%{opacity:1}100%{opacity:1;transform:translateX(0)}}
@keyframes spUp{to{opacity:1;transform:none}}
@keyframes spOut{to{opacity:0;visibility:hidden}}
@media (prefers-reduced-motion:reduce){
  .splash *{animation:none!important;opacity:1!important;transform:none!important;stroke-dashoffset:0!important}
  .splash{animation:spOut .3s ease 1.6s forwards!important}
}
#toast{position:fixed;left:50%;bottom:calc(20px + env(safe-area-inset-bottom));z-index:80;transform:translate(-50%,calc(100% + 60px));opacity:0;visibility:hidden;background:var(--fg);color:var(--bg);padding:10px 16px;border-radius:18px;font-size:calc(14px * var(--ts));text-align:center;max-width:90vw;pointer-events:none;transition:transform .25s,opacity .25s,visibility 0s linear .25s}
#toast.on{transform:translate(-50%,0);opacity:1;visibility:visible;transition:transform .25s,opacity .25s}
body.loading .person{opacity:.45}
.person.tiny header{gap:9px}
.person.tiny .pn{cursor:pointer;flex:1;min-width:0}
.ind{display:flex;flex-wrap:wrap;gap:6px}
.ic{background:var(--soft);color:var(--fg);border-radius:999px;padding:2px 9px;font-size:calc(12px * var(--ts));font-weight:600;line-height:1.5;white-space:nowrap;font-variant-numeric:tabular-nums}
.ic.gold{background:var(--goldbg);color:var(--gold)}
.chev{flex:none;align-self:center;color:var(--mut);font-size:calc(18px * var(--ts));line-height:1;padding:4px;cursor:pointer;transition:transform .2s}
.act.fold .ah{cursor:pointer}
.act.fold > .ind{margin:8px 0 0 calc(22px * var(--ts) + 10px);cursor:pointer}
.act.fold:not(.open) > *:not(.ah):not(.ind){display:none}
.act.fold.open > .ind{display:none}
.act.fold.open .chev,.person.tiny.open .chev{transform:rotate(180deg)}
.act.fold .at{flex:1;min-width:0}
.person.tiny .pn .ind{margin-top:3px;flex-wrap:nowrap;overflow:hidden;gap:10px}
.person.tiny .ic{background:none;padding:0;color:var(--mut)}
.person.tiny .ic.gold{color:var(--gold)}
.person.tiny .tline{margin-top:1px}
.tline .more{color:var(--mut);font-weight:600}
.person.tiny .person-k{font-size:0;width:44px;height:36px;padding:0;flex:none}
.person.tiny .person-k::before{content:'👍';font-size:17px}
.person.tiny .person-k.done::before{content:'✓';font-size:17px}
.person.tiny .person-k[data-busy]::before{content:'…'}
.person.tiny .ic{flex:none}
.person.tiny .ic.cut{display:none}
.tline{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
body.d-compact .stats,body.d-tiny .stats{margin-top:8px;gap:8px}
#cfgsheet{position:fixed;inset:0;z-index:49;background:var(--paper);color:var(--ink);transform:translateY(102%);visibility:hidden;transition:transform .28s ease,visibility 0s linear .28s;overflow-y:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;text-align:left}
#cfgsheet.open{transform:none;visibility:visible;transition:transform .28s ease}
#cfgsheet button{font:inherit;color:inherit;background:none;border:0;border-radius:0;padding:0;font-weight:inherit;cursor:pointer;text-align:inherit}
#cfgsheet .sh-head{position:sticky;top:0;z-index:2;background:var(--paper);display:flex;justify-content:space-between;align-items:center;padding:calc(env(safe-area-inset-top) + 14px) 18px 12px;border-bottom:1px solid var(--rule)}
#cfgsheet .sh-head h2{font:700 calc(24px * var(--ts))/1 var(--display);margin:0}
#cfgsheet .sh-body{padding:16px 18px calc(env(safe-area-inset-bottom) + 40px);max-width:680px;margin:0 auto}
#cfgsheet .link{color:var(--signal);font-weight:600;font-size:16px}
#cfgsheet .link.small{font-size:calc(14px * var(--ts))}
#cfgsheet .hint{font-size:calc(13px * var(--ts));color:var(--muted);margin:8px 2px 0}
#cfgsheet .muted{color:var(--muted)}
#cfgsheet .sec{display:block;font:700 calc(17px * var(--ts))/1.2 var(--display);color:var(--ink);margin:26px 0 6px}
#cfgsheet .srow{display:flex;align-items:center;gap:8px;padding:11px 0;border-bottom:1px solid var(--rule)}
#cfgsheet .grow{flex:1;min-width:0}
#cfgsheet .grow b{display:block;font-weight:600}
#cfgsheet .grow small{display:block;font-size:calc(13px * var(--ts));color:var(--ink-2)}
#cfgsheet .switch{width:46px;height:28px;border-radius:14px;background:var(--rule);position:relative;flex:none;transition:background .2s}
#cfgsheet .switch::after{content:"";position:absolute;top:3px;left:3px;width:22px;height:22px;border-radius:11px;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.25);transition:transform .2s}
#cfgsheet .switch.on{background:var(--signal)}
#cfgsheet .switch.on::after{transform:translateX(18px)}
#cfgsheet .sm{font-size:calc(13px * var(--ts));padding:6px 11px;border-radius:8px;border:1px solid var(--rule);background:var(--sheet);white-space:nowrap;flex:none}
#cfgsheet .danger{color:var(--danger)}
#cfgsheet .danger.armed{background:var(--danger);color:#fff;border-color:var(--danger)}
#cfgsheet .seg{display:flex;flex:none;gap:0;padding:0;border:1px solid var(--rule);border-radius:9px;overflow:hidden;background:var(--sheet)}
#cfgsheet .seg button{font-size:calc(12.5px * var(--ts));padding:6px 10px;color:var(--ink-2);white-space:nowrap}
#cfgsheet .seg button.on{background:var(--ink);color:var(--paper);font-weight:600}
#cfgsheet .seg.wide button{flex:1;text-align:center;padding:9px 4px;font-size:calc(13.5px * var(--ts))}
#cfgsheet .lk-row{margin:10px 0 14px}
#cfgsheet .lk-l{display:block;font-size:calc(13px * var(--ts));font-weight:600;color:var(--ink-2);margin-bottom:6px}
#cfgsheet .sws{display:flex;gap:12px;overflow-x:auto;scrollbar-width:none;padding:3px 3px 2px}
#cfgsheet .sws::-webkit-scrollbar{display:none}
#cfgsheet .sw{display:flex;flex-direction:column;align-items:center;gap:5px;flex:none}
#cfgsheet .sw .prev{position:relative;width:50px;height:50px;border-radius:13px;display:grid;place-items:center;border:1px solid rgba(127,127,127,.35);font:700 18px/1 var(--display)}
#cfgsheet .sw .prev i{position:absolute;right:6px;bottom:6px;width:9px;height:9px;border-radius:5px}
#cfgsheet .sw.on .prev{outline:2.5px solid var(--signal);outline-offset:2px}
#cfgsheet .sw small{font-size:12px;color:var(--ink-2)}
#cfgsheet .sw.on small{color:var(--ink);font-weight:600}
#cfgsheet .cfg{padding:12px 0;border-bottom:1px solid var(--rule)}
#cfgsheet .cfg.ch .cfg-h b::after{content:"";display:inline-block;width:7px;height:7px;border-radius:4px;background:var(--signal);margin-left:7px;vertical-align:2px}
#cfgsheet .cfg-h{display:flex;justify-content:space-between;align-items:baseline;gap:10px}
#cfgsheet .cfg-h b{font-weight:600}
#cfgsheet .cfg small{display:block;font-size:calc(13px * var(--ts));margin-top:2px}
#cfgsheet .stepper{display:flex;align-items:center;gap:6px;margin-top:8px;flex-wrap:wrap}
#cfgsheet .stepper button{width:38px;height:36px;border-radius:9px;border:1px solid var(--rule);background:var(--sheet);font-size:20px;font-weight:600;text-align:center}
#cfgsheet .stepper button[disabled]{opacity:.35}
#cfgsheet .stepper input{width:86px;text-align:center;font:600 16px var(--sans);padding:7px 6px;border-radius:9px;border:1px solid var(--rule);background:var(--paper);color:var(--ink)}
#cfgsheet .stepper .unit{font-size:calc(14px * var(--ts));color:var(--ink-2);min-width:2.5em}
#cfgsheet .stepper .range{flex-basis:100%;font-size:calc(12px * var(--ts));color:var(--muted)}
#cfgsheet .cfgin.wide,#cfgsheet .cfgsel{display:block;width:100%;margin-top:8px;font:16px/1.45 var(--sans);padding:9px 11px;border-radius:9px;border:1px solid var(--rule);background:var(--paper);color:var(--ink);-webkit-appearance:none;appearance:none}
#cfgsheet textarea.cfgsel{resize:none}
#cfgsheet .cfgin:focus,#cfgsheet .cfgsel:focus{outline:2px solid var(--signal);outline-offset:-1px}
#cfgsheet .cfg-foot{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px;margin-top:18px}
#cfgsheet .note{font-size:12.5px;color:var(--muted)}
#cfgsheet .srow.bp{width:100%;text-align:left}
#cfgsheet .chev{flex:none;color:var(--muted);font-size:calc(20px * var(--ts));line-height:1}
#aisheet{--ai-paper:var(--bg);--ai-sheet:var(--card);--ai-rule:var(--line);--ai-ink:var(--fg);--ai-muted:var(--mut);--ai-signal:var(--accent);--ai-wash:color-mix(in srgb,var(--ai-signal) 14%,transparent);--ai-danger:#d93636;
  position:fixed;inset:0;z-index:56;background:var(--ai-paper);color:var(--ai-ink);transform:translateY(102%);visibility:hidden;transition:transform .28s ease,visibility 0s linear .28s;overflow-y:auto;-webkit-overflow-scrolling:touch;font:15px/1.4 -apple-system,system-ui,sans-serif;text-align:left}
#aisheet.open{transform:none;visibility:visible;transition:transform .28s ease}
#aisheet *{box-sizing:border-box}
#aisheet button{font:inherit;color:inherit;background:none;border:0;margin:0;padding:0;cursor:pointer;-webkit-appearance:none;appearance:none;touch-action:manipulation}
#aisheet .sh-head{position:sticky;top:0;z-index:1;display:flex;align-items:center;justify-content:space-between;padding:calc(10px + env(safe-area-inset-top,0px)) 16px 10px;background:var(--ai-paper);border-bottom:1px solid var(--ai-rule)}
#aisheet .sh-head h2{margin:0;font-size:22px;font-weight:700}
#aisheet .sh-body{padding:4px 16px calc(28px + env(safe-area-inset-bottom,0px));max-width:680px;margin:0 auto}
#aisheet .link{color:var(--ai-signal);font-weight:600;font-size:17px;padding:8px 0 8px 12px}
#aisheet .hint{font-size:14px;color:var(--ai-muted);margin:12px 0 0}
#aisheet .muted{color:var(--ai-muted)} #aisheet .small{font-size:13px} #aisheet .pad{padding:4px 0 8px;margin:0}
#aisheet .note{font-size:12.5px;color:var(--ai-muted);margin:6px 0 0}
#aisheet .sec{font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--ai-muted);margin:24px 0 8px}
#aisheet .sm{font-size:14px;font-weight:600;padding:8px 12px;border-radius:9px;border:1px solid var(--ai-rule);background:var(--ai-sheet);color:var(--ai-ink)}
#aisheet .sm.primary{background:var(--ai-signal);border-color:var(--ai-signal);color:#fff}
#aisheet .srow{display:flex;align-items:center;gap:12px;background:var(--ai-sheet);border:1px solid var(--ai-rule);border-radius:14px;padding:12px 14px;margin:8px 0}
#aisheet .grow{flex:1;min-width:0} #aisheet .grow b{display:block;font-weight:600} #aisheet .grow small{display:block;font-size:13px;margin-top:2px}
#aisheet .switch{flex:none;width:51px;height:31px;border-radius:16px;background:var(--ai-rule);position:relative;transition:background .2s}
#aisheet .switch::after{content:"";position:absolute;top:2px;left:2px;width:27px;height:27px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.3);transition:transform .2s}
#aisheet .switch.on{background:var(--ai-signal)} #aisheet .switch.on::after{transform:translateX(20px)}
#aisheet .aicard,#aisheet .ucard{background:var(--ai-sheet);border:1px solid var(--ai-rule);border-radius:14px;padding:14px;margin:14px 0}
#aisheet .aicard.active{border-color:var(--ai-signal);box-shadow:0 0 0 1px var(--ai-signal)}
#aisheet .aic-h{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:17px}
#aisheet .aic-row{display:flex;align-items:center;gap:10px;margin-top:10px;font-size:14px}
#aisheet .aic-row.lbl,#aisheet .aic-row .lbl{font-weight:600}
#aisheet code{font:13px ui-monospace,Menlo,monospace;background:var(--ai-paper);border:1px solid var(--ai-rule);border-radius:6px;padding:2px 6px}
#aisheet .aic-btns{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:10px}
#aisheet .sm[disabled]{opacity:.5}
#aisheet .modelsel{display:block;width:100%;margin-top:6px;font:16px -apple-system,system-ui,sans-serif;color:var(--ai-ink);background:var(--ai-paper);border:1px solid var(--ai-rule);border-radius:9px;padding:9px 10px}
#aisheet .danger{color:var(--ai-danger)} #aisheet .danger.armed{background:var(--ai-danger);color:#fff;border-color:var(--ai-danger)}
#aisheet .ustat{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:10px 0 4px}
#aisheet .ustat div{background:var(--ai-paper);border-radius:10px;padding:8px 10px}
#aisheet .ustat b{display:block;font-size:20px;font-weight:700}
#aisheet .ustat small{color:var(--ai-muted);font-size:12px}
#aisheet .ubars{display:flex;align-items:flex-end;gap:3px;height:56px;margin-top:10px}
#aisheet .ubars span{flex:1;background:var(--ai-signal);border-radius:3px 3px 0 0;min-height:2px}
#aisheet .ubars span.zero{background:var(--ai-rule)}
#aisheet .ubars-l{display:flex;justify-content:space-between;font-size:11.5px;color:var(--ai-muted);margin-top:4px}
#aisheet .utab{width:100%;border-collapse:collapse;margin-top:12px;font-size:13px}
#aisheet .utab th{text-align:left;font-weight:600;color:var(--ai-muted);padding:4px 4px 4px 0;border-bottom:1px solid var(--ai-rule)}
#aisheet .utab td{padding:6px 4px 6px 0;border-bottom:1px solid var(--ai-rule);word-break:break-word}
#aisheet .utab th:not(:first-child),#aisheet .utab td:not(:first-child){text-align:right;white-space:nowrap}
.badge-ai{display:inline-block;font-size:12px;font-weight:700;color:var(--accent);background:color-mix(in srgb,var(--accent) 14%,transparent);border-radius:6px;padding:2px 8px}
.badge-ex{display:inline-block;font-size:12px;font-weight:600;color:var(--mut);border:1px dashed var(--mut);border-radius:6px;padding:1px 8px}
body.nokey .ai,body.nokey .modes{display:none!important}
.sugs .badge-ai{align-self:flex-start}
</style></head><body class="d-${look.density}${aiKey() ? '' : ' nokey'}">
${launchScreen()}${content}
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
// Launch screen (app-blueprints · launch-screen 1.0.0): first, self-contained
(function () {
  var sp = document.getElementById("splash");
  if (!sp) return;
  function gone() { sp.classList.add("gone"); sp.setAttribute("aria-hidden", "true"); }
  sp.addEventListener("click", gone);   // tap to skip
  setTimeout(gone, 2900);               // out of the page once the CSS fade is done
})();
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
var aiMode=document.querySelector('.mode.on')?document.querySelector('.mode.on').dataset.mode:'mystyle';
function setMode(mode, from){
  aiMode=mode;
  document.querySelectorAll('.mode').forEach(function(b){ b.classList.toggle('on', b.dataset.mode===mode); });
  send('setmode',{mode:mode});
}
// ── the comment composer: a pop-up with the draft and AI ideas ──
var DRAFTS={};
function composerSheet(){
  var ov=document.getElementById('csheet');
  if(!ov){
    ov=document.createElement('div'); ov.id='csheet'; ov.hidden=true;
    ov.innerHTML='<div class="csp" role="dialog" aria-label="Write a comment"><div class="msgrab"></div><div class="csh"></div><div class="csb"></div></div>';
    document.body.appendChild(ov);
    ov.addEventListener('click',function(e){ if(e.target===ov) closeComposer(); });
  }
  return ov;
}
function openComposer(art){
  var src=art&&art.querySelector('.cbox'); if(!src) return;
  var id=art.dataset.id, ov=composerSheet(), det=document.getElementById('det');
  var sec=document.querySelector('section.person .act[data-id="'+CSS.escape(id)+'"]');
  ov.dataset.id=id;
  ov.dataset.pid=sec?sec.closest('section.person').dataset.pid:(det&&!det.hidden?det.dataset.pid||'':'');
  var ttl=(art.querySelector('.ttl')||{}).textContent||'';
  ov.querySelector('.csh').innerHTML='<div class="mtt"><b>Comment for '+escH(art.dataset.who||'your friend')+'</b><small>'+escH(ttl)+'</small></div><button class="mbtn" data-act="cs-close" aria-label="Close">✕</button>';
  var box=src.cloneNode(true); box.hidden=false; box.classList.add('incs');
  var ta=box.querySelector('textarea'); ta.rows=4; ta.value=DRAFTS[id]||''; ta.setAttribute('aria-label','Your comment');
  var lab=document.createElement('div'); lab.className='cslab'; lab.textContent='Write it for me';
  var crow=box.querySelector('.crow'); crow.parentNode.insertBefore(lab,crow.nextSibling);
  var body=ov.querySelector('.csb'); body.innerHTML=''; body.appendChild(box); body.scrollTop=0;
  ov.hidden=false; document.body.style.overflow='hidden';
  setTimeout(function(){ try{ ta.focus(); }catch(e){} },250);
}
function closeComposer(posted){
  var ov=document.getElementById('csheet'); if(!ov||ov.hidden) return;
  var ta=ov.querySelector('.csb textarea');
  if(posted) delete DRAFTS[ov.dataset.id]; else if(ta) DRAFTS[ov.dataset.id]=ta.value;
  ov.hidden=true; ov.querySelector('.csb').innerHTML='';
  var det=document.getElementById('det'); document.body.style.overflow=(det&&!det.hidden)?'hidden':'';
}
function aiReply(box,ok,msg,label){
  var sugs=box.querySelector('.sugs'); sugs.innerHTML='';
  if(!ok&&msg==='NEED_KEY'){
    sugs.innerHTML='<p class="keyhelp">✨ AI writing needs a Claude or OpenAI key. Add one in Settings › AI settings.</p><button class="small" data-act="ai-open" style="align-self:flex-start">AI settings</button>';
    return false;
  }
  if(!ok){ toast(label+' failed: '+(msg||'unknown error')); return false; }
  var res={}; try{ res=JSON.parse(msg); }catch(e){}
  var list=res.comments||[];
  if(list.length){ var lab=document.createElement('span'); lab.className='badge-ai'; lab.textContent='✨ '+label+' by '+(res.by||'AI'); sugs.appendChild(lab); }
  list.forEach(function(c){ var b=document.createElement('button'); b.className='sug'; b.dataset.sug=''; b.textContent=c; sugs.appendChild(b); });
  return true;
}
function suggest(btn){
  if(btn.disabled) return;
  var box=btn.closest('.cbox'), sugs=box.querySelector('.sugs'), ta=box.querySelector('textarea');
  btn.disabled=true; btn.dataset.busy='1'; btn.textContent='✨ Thinking…';
  send('suggest',{id:btn.dataset.suggest,lang:aiLang,hint:ta.value.trim(),mode:aiMode},function(ok,msg){
    btn.disabled=false; delete btn.dataset.busy; btn.textContent='✨ More';
    if(!aiReply(box,ok,msg,'Suggestions')&&!ok&&msg==='NEED_KEY') btn.textContent='✨ Suggest';
  });
}
window.__done=function(req,ok,msg){ var cb=pending[req]; delete pending[req]; if(cb) cb(ok,msg); };
window.__patchPerson=function(pid,html){
  var old=document.querySelector('section.person[data-pid="'+CSS.escape(pid)+'"]'); if(!old) return;
  if(old.querySelector('.cbox:not([hidden])')||old.querySelector('[data-busy]')||old.contains(document.activeElement)) return;
  var openActs=[].map.call(old.querySelectorAll('.act.open'),function(a){ return a.dataset.id; }), pOpen=old.classList.contains('open');
  var t=document.createElement('template'); t.innerHTML=html.trim(); var neu=t.content.firstElementChild; old.replaceWith(neu);
  openActs.forEach(function(id){ var a=neu.querySelector('.act[data-id="'+CSS.escape(id)+'"]'); if(a){ a.classList.add('open'); var hd=a.querySelector('.ah'); if(hd) hd.setAttribute('aria-expanded','true'); } });
  if(pOpen){ var b=neu.querySelector('.tacts'); if(b){ b.hidden=false; neu.classList.add('open'); } }
  fitTinyChips(neu);
};
// Tiny lines: hide indicator chips that don't fit whole, instead of cutting one in half.
function fitTinyChips(root){
  (root||document).querySelectorAll('.person.tiny .pn .ind').forEach(function(box){
    var cs=box.querySelectorAll('.ic'); cs.forEach(function(c){ c.classList.remove('cut'); });
    var edge=box.getBoundingClientRect().right+0.5;
    cs.forEach(function(c){ if(c.getBoundingClientRect().right>edge) c.classList.add('cut'); });
  });
}
window.addEventListener('load',function(){ fitTinyChips(); });
window.addEventListener('resize',function(){ fitTinyChips(); });
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
  function overlayOpen(){ return cfgOpen||['lb','sendov','sheet','det','upd','kov','msheet','csheet'].some(function(id){ var el=document.getElementById(id); return el&&!el.hidden; }); }
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
  var c=art.cloneNode(true); c.classList.remove('fold'); c.querySelectorAll('.chev,.act > .ind').forEach(function(x){ x.remove(); }); c.querySelectorAll('[data-expand]').forEach(function(x){ x.removeAttribute('data-expand'); x.removeAttribute('role'); }); c.querySelectorAll('[data-detail]').forEach(function(x){ if(x.tagName==='BUTTON') x.remove(); else x.removeAttribute('data-detail'); });
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
// ── Settings (app-blueprints · settings): every change applies at once and is saved; Done closes ──
var LOOK=${JSON.stringify(lookState())};
var SET=null, cfgOpen=false, cfgArmed=false;
var darkMQ=window.matchMedia?matchMedia('(prefers-color-scheme: dark)'):{matches:false};
function applyLook(){
  var root=document.documentElement;
  root.dataset.theme=LOOK.theme==='auto'?(darkMQ.matches?'night':'ink'):LOOK.theme;
  root.dataset.font=LOOK.font;
  root.style.setProperty('--ts',LOOK.textSize);
  document.body.classList.remove('d-comfortable','d-compact','d-tiny');
  document.body.classList.add('d-'+LOOK.density);
}
if(darkMQ.addEventListener) darkMQ.addEventListener('change',function(){ if(LOOK.theme==='auto') applyLook(); }); else if(darkMQ.addListener) darkMQ.addListener(function(){ if(LOOK.theme==='auto') applyLook(); });
function cfgSheet(){ var el=document.getElementById('cfgsheet'); if(!el){ el=document.createElement('div'); el.id='cfgsheet'; el.setAttribute('role','dialog'); el.setAttribute('aria-label','Settings'); document.body.appendChild(el); } return el; }
function cfgItem(k){ for(var i=0;i<SET.cfgSchema.length;i++){ var it=SET.cfgSchema[i].items; for(var j=0;j<it.length;j++) if(it[j].k===k) return it[j]; } return null; }
function cfgChanged(k){ var d=cfgItem(k); return !!d&&JSON.stringify(SET.cfg[k])!==JSON.stringify(d.def); }
function fmtCfg(d,v){ return d.step&&d.step<1?Number(v).toFixed(String(d.step).split('.')[1].length):String(v); }
function segRow(k,opts){ return '<div class="seg wide">'+opts.map(function(o){ return '<button class="'+(String(LOOK[k])===String(o[0])?'on':'')+'" data-act="look" data-k="'+k+'" data-v="'+o[0]+'">'+o[1]+'</button>'; }).join('')+'</div>'; }
function lookHTML(){
  var P=SET.palettes, themes=[['auto','Auto']].concat(Object.keys(P).map(function(k){ return [k,k.charAt(0).toUpperCase()+k.slice(1)]; }));
  return '<div class="lk-row"><span class="lk-l">Colours</span><div class="sws">'+themes.map(function(t){
      var st=t[0]==='auto'?'background:linear-gradient(135deg,'+P.ink.paper+' 50%,'+P.night.sheet+' 50%);color:'+P.night.signal:'background:'+P[t[0]].paper+';color:'+P[t[0]].ink;
      return '<button class="sw '+(LOOK.theme===t[0]?'on':'')+'" data-act="look" data-k="theme" data-v="'+t[0]+'" aria-label="'+t[1]+' colours"><span class="prev" style="'+st+'">Aa<i style="background:'+(P[t[0]]||P.night).signal+'"></i></span><small>'+t[1]+'</small></button>';
    }).join('')+'</div></div>'+
    '<div class="lk-row"><span class="lk-l">Layout</span>'+segRow('density',[['comfortable','Comfortable'],['compact','Compact'],['tiny','Tiny']])+'</div>'+
    '<div class="lk-row"><span class="lk-l">Text size</span>'+segRow('textSize',[[0.92,'Small'],[1,'Default'],[1.12,'Large'],[1.25,'Larger']])+'</div>'+
    '<div class="lk-row"><span class="lk-l">Headline font</span>'+segRow('font',[['sans','Sans serif'],['serif','Serif']])+'</div>';
}
function swRow(k,label,help){ return '<div class="srow"><div class="grow"><b>'+label+'</b><small>'+help+'</small></div><button class="switch '+(SET.settings[k]?'on':'')+'" data-act="toggle" data-v="'+k+'" aria-label="'+label+'"></button></div>'; }
function pickRow(k,label,opts){ return '<div class="cfg"><div class="cfg-h"><b>'+label+'</b></div><select class="cfgsel" data-k="'+k+'">'+opts.map(function(o){ return '<option value="'+escH(o[0])+'"'+(String(o[0])===String(SET.settings[k])?' selected':'')+'>'+escH(o[1])+'</option>'; }).join('')+'</select></div>'; }
function fieldHTML(d){
  var v=SET.cfg[d.k], ch=cfgChanged(d.k);
  var reset=ch?'<button class="link small" data-act="cfgreset" data-k="'+d.k+'">Reset</button>':'';
  var head='<div class="cfg-h"><b>'+escH(d.label)+'</b>'+reset+'</div>'+(d.help?'<small class="muted">'+escH(d.help)+'</small>':'');
  if(d.type==='text') return '<div class="cfg '+(ch?'ch':'')+'">'+head+'<input class="cfgin wide" data-k="'+d.k+'" value="'+escH(v)+'" autocapitalize="off" autocorrect="off" spellcheck="false" inputmode="'+(d.pattern?'numeric':'text')+'"></div>';
  return '<div class="cfg '+(ch?'ch':'')+'">'+head+
    '<div class="stepper"><button data-act="cfgstep" data-k="'+d.k+'" data-v="-1" aria-label="Decrease" '+(v<=d.min?'disabled':'')+'>−</button>'+
    '<input class="cfgin" data-k="'+d.k+'" value="'+fmtCfg(d,v)+'" inputmode="decimal" aria-label="'+escH(d.label)+'">'+
    '<button data-act="cfgstep" data-k="'+d.k+'" data-v="1" aria-label="Increase" '+(v>=d.max?'disabled':'')+'>+</button>'+
    '<span class="unit">'+escH(d.unit||'')+'</span><span class="range">'+fmtCfg(d,d.min)+'–'+fmtCfg(d,d.max)+(ch?' — original '+fmtCfg(d,d.def):'')+'</span></div></div>';
}
function bpLink(b){ return SET.blueprintsRepo+'/blob/'+b.id+'-v'+b.version+'/blueprints/'+b.id+'.md'; }
function builtWithHTML(){
  return '<h3 class="sec">Built with</h3><p class="hint">'+escH(SET.appName)+' is built from shared blueprints that the other apps use too. Tap one to read how that part works.</p>'+
    SET.blueprints.map(function(b){ return '<button class="srow bp" data-act="openurl" data-v="'+escH(bpLink(b))+'"><div class="grow"><b>'+escH(b.name)+'</b><small class="muted">Blueprint '+escH(b.version)+' · since '+escH(SET.appName)+' '+escH(b.since)+'</small></div><span class="chev" aria-hidden="true">›</span></button>'; }).join('')+
    '<button class="srow bp" data-act="openurl" data-v="'+escH(SET.blueprintsRepo)+'"><div class="grow"><b>All blueprints</b><small class="muted">'+escH(SET.blueprintsRepo.replace('https://',''))+'</small></div><span class="chev" aria-hidden="true">›</span></button>';
}
var STYLEBUSY=false, STYLEMSG='';
window.__styleProgress=function(t){ STYLEMSG=t; var sm=document.getElementById('stylemsg'); if(sm) sm.textContent=t; };
function writingHTML(){
  var rules=SET.settings.commentRules||'', changed=rules!==SET.defaultRules, prof=SET.styleProfile||'', meta=SET.styleMeta||{};
  var sec=SET.cfgSchema.filter(function(x){ return x.title==='Comments'; })[0];
  var when=meta.at?new Date(meta.at).toLocaleDateString(undefined,{day:'numeric',month:'short'}):'';
  return '<h3 class="sec">Comment writing</h3>'+
    '<div class="cfg'+(changed?' ch':'')+'"><div class="cfg-h"><b>Instructions for every AI comment</b>'+(changed?'<button class="link small" data-act="rules-reset">Reset to default</button>':'')+'</div>'+
      '<small class="muted">Used for every AI comment idea. They win over the app’s own defaults.</small>'+
      '<textarea class="cfgsel rules" data-k="commentRules" rows="9" maxlength="2000" aria-label="Instructions for every AI comment">'+escH(rules)+'</textarea></div>'+
    (sec?sec.items.map(fieldHTML).join(''):'')+
    '<div class="cfg"><div class="cfg-h"><b>Learn my style</b></div>'+
      '<small class="muted">Reads the comments on recent activities, picks out yours and describes how you write. ✨ My style then writes like you, on top of your instructions.</small>'+
      '<div class="stylebtns"><button class="sm" data-act="style-learn"'+(STYLEBUSY?' disabled':'')+'>'+(STYLEBUSY?'Learning…':(prof?'Learn again':'Learn my style'))+'</button>'+
      '<small id="stylemsg" class="muted" aria-live="polite">'+escH(STYLEMSG)+'</small></div>'+
      (prof?'<div class="styleprof"><div class="cfg-h"><small class="muted">Learned from '+(meta.count||0)+' of your comments'+(when?', '+escH(when):'')+(meta.read?'<br>'+meta.read+' comments read on '+(meta.scanned||0)+' activities; only yours are used':'')+'</small><button class="link small" data-act="style-clear">Clear</button></div><p>'+escH(prof)+'</p></div>':'')+
    '</div>';
}
function renderCfg(){
  var el=cfgSheet(), keep=el.scrollTop;
  el.classList.toggle('open',cfgOpen); document.body.style.overflow=cfgOpen?'hidden':'';
  if(!cfgOpen||!SET) return;
  var changed=Object.keys(SET.cfg).filter(cfgChanged).length;
  el.innerHTML='<div class="sh-head"><h2>Settings</h2><button class="link" data-act="cfgclose">Done</button></div><div class="sh-body">'+
    '<p class="hint">Changes apply right away and are kept on this iPhone.</p>'+
    '<h3 class="sec">Appearance</h3>'+lookHTML()+
    '<h3 class="sec">Digest</h3>'+
      swRow('includeMe','Show my own activities','The feed reloads when you close Settings')+
      swRow('enrich','Load extra details','Heart rate, PRs, start times, route maps')+
      swRow('widgetNames','Names on the widget','First names of people waiting for your kudos')+
    '<h3 class="sec">AI comments</h3>'+
      '<div class="srow"><div class="grow"><b>Keys, models and token usage</b><small id="s-aistatus">'+(SET.hasKey?escH(SET.aiStatus):'Add a Claude or OpenAI key for ✨ comment ideas')+'</small></div><button class="sm" data-act="ai-open">AI settings</button></div>'+
      pickRow('aiMode','Default mood',SET.modes.map(function(m){ return [m.key,m.label]; }))+
      pickRow('aiLang','Language',SET.langs.map(function(l){ return [l[1],l[1]]; }))+
    writingHTML()+
    '<h3 class="sec">Updates</h3>'+
      swRow('checkUpdates','Offer new versions','You have Daily Digest '+escH(SET.version)+'. “Later” waits two days.')+
      '<div class="srow"><div class="grow"><b>Check for updates now</b><small id="updmsg" class="muted" aria-live="polite"></small></div><button class="sm" data-act="updcheck">Check</button></div>'+
    SET.cfgSchema.filter(function(sec){ return sec.title!=='Comments'; }).map(function(sec){ return '<h3 class="sec">'+escH(sec.title)+'</h3>'+sec.items.map(fieldHTML).join(''); }).join('')+
    '<div class="cfg-foot"><span class="note">'+(changed?changed+' setting'+(changed===1?'':'s')+' changed':'All settings are at their original values')+'</span>'+
      (changed?'<button class="sm danger '+(cfgArmed?'armed':'')+'" data-act="cfgall">'+(cfgArmed?'Confirm reset':'Reset all')+'</button>':'')+'</div>'+
    builtWithHTML()+'</div>';
  el.scrollTop=keep;   // re-renders must not jump back to the top
}
function setState(ok,msg){ if(!ok){ toast(msg||'Could not save'); } else { try{ SET=JSON.parse(msg); }catch(e){} } renderCfg(); }
function openSettings(){
  if(cfgOpen) return;
  send('settings-get',{},function(ok,msg){ if(!ok){ toast('Settings could not be loaded'); return; } cfgOpen=true; setState(ok,msg); cfgSheet().scrollTop=0; });
}
function closeSettings(){ cfgOpen=false; cfgArmed=false; renderCfg(); send('settings-done',{}); }
function cfgAction(t,act){
  var v=t.dataset.v, k=t.dataset.k;
  if(act==='look'){ var val=k==='textSize'?+v:v; LOOK[k]=val; applyLook(); renderCfg(); send('set',{k:k,v:val},setState); return; }
  if(act==='toggle'){ SET.settings[v]=!SET.settings[v]; renderCfg(); send('set',{k:v,v:SET.settings[v]},setState); return; }
  if(act==='cfgreset'){ send('cfg',{k:k,reset:1},setState); return; }
  if(act==='cfgstep'){ var d=cfgItem(k), step=d.step||1; SET.cfg[k]=Number(Math.min(d.max,Math.max(d.min,Number(SET.cfg[k])+step*(+v))).toFixed(2)); renderCfg(); send('cfg',{k:k,v:SET.cfg[k]},setState); return; }
  if(act==='cfgall'){ if(cfgArmed){ cfgArmed=false; send('cfg',{k:'*'},setState); } else { cfgArmed=true; renderCfg(); setTimeout(function(){ if(cfgArmed){ cfgArmed=false; renderCfg(); } },3500); } return; }
  if(act==='updcheck'){ var um=document.getElementById('updmsg'); t.disabled=true; if(um) um.textContent='Checking…';
    send('update-check',{},function(ok,res){ t.disabled=false; if(um) um.textContent=res||''; if(/available/.test(res||'')) closeSettings(); }); return; }
  if(act==='openurl'){ send('openurl',{v:v}); return; }
  if(act==='rules-reset'){ send('set',{k:'commentRules',v:SET.defaultRules},setState); return; }
  if(act==='style-clear'){ STYLEMSG=''; send('style-clear',{},setState); return; }
  if(act==='style-learn'){
    if(STYLEBUSY) return; STYLEBUSY=true; STYLEMSG='Starting…'; renderCfg();
    send('style-learn',{},function(ok,msg){
      STYLEBUSY=false;
      if(ok){ STYLEMSG='Done. ✨ My style now writes like you.'; setState(true,msg); }
      else { STYLEMSG=msg||'Couldn’t learn your style'; renderCfg(); }
    });
    return;
  }
}
// Typed and picked values arrive through "change".
document.addEventListener('change',function(e){
  var el=e.target; if(!el.closest||!el.closest('#cfgsheet')) return;
  if(el.classList.contains('cfgin')) send('cfg',{k:el.dataset.k,v:el.value},setState);
  if(el.classList.contains('cfgsel')) send('set',{k:el.dataset.k,v:el.value},setState);
});
applyLook();
// ── AI settings sheet (app-blueprints · ai-configuration) ──
// Opened with window.__aiOpen(); the Scriptable side pushes state with window.__aiState(state).
var AIS=null, aiIsOpen=false, aiArmed=null, aiLoading={};
var AI_PN={ anthropic:'Claude', openai:'OpenAI' };
var AI_FEAT={"comments": "Comment ideas", "style": "Style learning", "test": "Connection tests", "other": "Other"};
var AI_JOBS=[];
function aiSend(act,data){ send(act,data); }
function aiEsc(t){ var d=document.createElement('div'); d.textContent=String(t==null?'':t); return d.innerHTML; }
function aiFmtN(n){ return n>=1e6?(n/1e6).toFixed(2)+'M':n>=1e4?Math.round(n/1e3)+'k':n>=1e3?(n/1e3).toFixed(1)+'k':String(n); }
function aiRel(t){ var s=Math.max(0,Math.round((Date.now()-t)/1000)); if(s<60) return 'just now'; if(s<3600) return Math.round(s/60)+' min ago'; if(s<86400) return Math.round(s/3600)+' h ago'; return Math.round(s/86400)+' d ago'; }
function aiDayStr(d){ return d.getFullYear()+'-'+('0'+(d.getMonth()+1)).slice(-2)+'-'+('0'+d.getDate()).slice(-2); }
function aiArm(k){ aiArmed=k; renderAI(); setTimeout(function(){ if(aiArmed===k){ aiArmed=null; renderAI(); } },3500); }
function aiSheet(){
  var el=document.getElementById('aisheet');
  if(!el){
    el=document.createElement('div'); el.id='aisheet'; el.setAttribute('role','dialog'); el.setAttribute('aria-label','AI settings');
    document.body.appendChild(el);
    el.addEventListener('click',aiClick);
    el.addEventListener('change',function(e){ e.stopPropagation(); if(e.target.classList.contains('modelsel')) aiSend('aimodel',{p:e.target.getAttribute('data-p'),v:e.target.value}); });
  }
  return el;
}
window.__aiOpen=function(){ aiIsOpen=true; renderAI(); aiSend('aistate',{}); };
window.__aiState=function(s){ AIS=s; aiLoading={}; renderAI(); if(typeof window.__aiChanged==='function') window.__aiChanged(s); };
window.__aiToast=function(t){ if(!t) return; if(typeof toast==='function') toast(t); else alert(t); };
function aiUsageBlock(p,P){
  var days=[], now=new Date(), i;
  for(i=13;i>=0;i--){ var d=new Date(now); d.setDate(d.getDate()-i); days.push(aiDayStr(d)); }
  var tot=function(k){ var x=P.days[k]; return x?x.in+x.out:0; };
  var max=Math.max.apply(null,[1].concat(days.map(tot))), month=AIS.today.slice(0,7);
  var monthTot=Object.keys(P.days).filter(function(k){ return k.indexOf(month)===0; }).reduce(function(n,k){ return n+P.days[k].in+P.days[k].out; },0);
  var rows=function(obj,label){ return Object.keys(obj).sort(function(a,b){ return (obj[b].in+obj[b].out)-(obj[a].in+obj[a].out); }).map(function(k){ var x=obj[k];
    return '<tr><td>'+aiEsc(label(k))+'</td><td>'+x.calls+'</td><td>'+aiFmtN(x.in)+'</td><td>'+aiFmtN(x.out)+'</td></tr>'; }).join(''); };
  return '<div class="ucard"><div class="aic-h"><b>'+AI_PN[p]+'</b><span class="muted small">'+P.calls+' request'+(P.calls===1?'':'s')+'</span></div>'+
    '<div class="ustat"><div><b>'+aiFmtN(P.in+P.out)+'</b><small>total tokens</small></div><div><b>'+aiFmtN(P.in)+'</b><small>input</small></div><div><b>'+aiFmtN(P.out)+'</b><small>output</small></div></div>'+
    '<p class="note">Today '+aiFmtN(tot(AIS.today))+' tokens — this month '+aiFmtN(monthTot)+' tokens</p>'+
    '<div class="ubars" aria-label="Tokens per day, last 14 days">'+days.map(function(k){ var v=tot(k); return '<span style="height:'+Math.max(v?6:2,v/max*100)+'%" class="'+(v?'':'zero')+'" title="'+k+': '+v+' tokens"></span>'; }).join('')+'</div>'+
    '<div class="ubars-l"><span>2 weeks ago</span><span>Today</span></div>'+
    '<table class="utab"><tr><th>Feature</th><th>Requests</th><th>In</th><th>Out</th></tr>'+rows(P.features,function(k){ return AI_FEAT[k]||k; })+'</table>'+
    '<table class="utab"><tr><th>Model</th><th>Requests</th><th>In</th><th>Out</th></tr>'+rows(P.models,function(k){ return k; })+'</table></div>';
}
function renderAI(){
  var el=aiSheet(), keep=el.scrollTop;
  el.classList.toggle('open',aiIsOpen);
  if(!aiIsOpen) return;
  if(!AIS){ el.innerHTML='<div class="sh-head"><h2>AI</h2><button class="link" data-aiact="aiclose">Done</button></div><div class="sh-body"><p class="muted pad">Loading…</p></div>'; return; }
  var A=AIS;
  var card=function(p){
    var key=A.keys[p], ml=(A.models[p]||{}).list||[], cur=A.model[p];
    var opts=ml.some(function(m){ return m.id===cur; })?ml:[{id:cur,name:cur}].concat(ml);   // keep the chosen model visible
    return '<div class="aicard '+(A.provider===p?'active':'')+'">'+
      '<div class="aic-h"><b>'+AI_PN[p]+'</b>'+(A.provider===p?'<span class="badge-ai">In use</span>':key?'<button class="sm" data-aiact="aiprov" data-v="'+p+'">Use '+AI_PN[p]+'</button>':'')+'</div>'+
      '<div class="aic-row"><span class="lbl">API key</span>'+(key?'<code>'+aiEsc(key)+'</code>':'<span class="muted">Not set</span>')+'</div>'+
      '<div class="aic-btns"><button class="sm '+(key?'':'primary')+'" data-aiact="aikey" data-v="'+p+'">'+(key?'Change key':'Add key')+'</button>'+
        (key?'<button class="sm" data-aiact="aitest" data-v="'+p+'">Test connection</button><button class="sm danger '+(aiArmed==='rm'+p?'armed':'')+'" data-aiact="airm" data-v="'+p+'">'+(aiArmed==='rm'+p?'Confirm':'Remove')+'</button>':'')+'</div>'+
      '<label class="aic-row lbl" for="ms-'+p+'">Model</label>'+
      '<select id="ms-'+p+'" class="modelsel" data-p="'+p+'">'+opts.map(function(m){ return '<option value="'+aiEsc(m.id)+'" '+(m.id===cur?'selected':'')+'>'+aiEsc(m.name)+(m.name!==m.id?' — '+aiEsc(m.id):'')+'</option>'; }).join('')+'</select>'+
      '<div class="aic-btns"><button class="sm" data-aiact="aimodels" data-v="'+p+'" '+(key&&!aiLoading[p]?'':'disabled')+'>'+(aiLoading[p]?'Loading…':ml.length?'Refresh model list':'Load my models')+'</button>'+
        '<span class="note">'+(ml.length?ml.length+' models, updated '+aiRel(A.models[p].at):key?'Loads the models your key can use':'Add a key to load models')+'</span></div>'+
    '</div>';
  };
  var order=A.provider==='openai'?['openai','anthropic']:['anthropic','openai'];
  var used=Object.keys(A.usage.p).filter(function(p){ return A.usage.p[p].calls; });
  var jobs=AI_JOBS.length?AI_JOBS.map(function(j){
      return '<div class="srow"><div class="grow"><b>'+aiEsc(j.title)+'</b><small class="muted">'+aiEsc(j.text)+'</small></div>'+
        '<button class="switch '+(A.ai?'on':'')+'" data-aiact="aitoggle" aria-label="'+aiEsc(j.title)+'"></button></div>'; }).join('')
    :'<p class="muted pad">Nothing runs in the background: AI only runs when you tap ✨ Suggest.</p>';
  el.innerHTML='<div class="sh-head"><h2>AI</h2><button class="link" data-aiact="aiclose">Done</button></div><div class="sh-body">'+
    '<p class="hint">Keys stay in this iPhone’s Keychain. Only the provider marked “In use” is called.</p>'+
    order.map(card).join('')+
    '<h3 class="sec">What AI does</h3>'+jobs+
    '<h3 class="sec">Token usage</h3>'+
    (used.length?used.map(function(p){ return aiUsageBlock(p,A.usage.p[p]); }).join(''):'<p class="muted pad">No AI requests yet.</p>')+
    (used.length?'<div class="aic-btns"><span class="note">Counting since '+new Date(A.usage.since).toLocaleDateString(undefined,{month:'long',day:'numeric',year:'numeric'})+'</span>'+
      '<button class="sm danger '+(aiArmed==='reset'?'armed':'')+'" data-aiact="usagereset">'+(aiArmed==='reset'?'Confirm reset':'Reset counters')+'</button></div>':'')+
  '</div>';
  el.scrollTop=keep;   // re-renders must not jump the user back to the top
}
function aiClick(e){
  e.stopPropagation();   // the sheet's taps never reach the app's own click handler
  if(e.target.closest('select, option, input, textarea')) return;
  var t=e.target.closest('[data-aiact]'); if(!t||t.disabled) return;
  var act=t.getAttribute('data-aiact'), v=t.getAttribute('data-v');
  if(act==='aiclose'){ aiIsOpen=false; aiArmed=null; renderAI(); return; }
  if(act==='aikey'||act==='aitest'||act==='aiprov'||act==='aitoggle'){ if(act==='aitest') window.__aiToast('Testing '+AI_PN[v]+'…'); aiSend(act,{v:v}); return; }
  if(act==='aimodels'){ aiLoading[v]=1; renderAI(); aiSend('aimodels',{v:v}); return; }
  if(act==='airm'){ if(aiArmed==='rm'+v){ aiArmed=null; aiSend('airm',{v:v}); } else aiArm('rm'+v); return; }
  if(act==='usagereset'){ if(aiArmed==='reset'){ aiArmed=null; aiSend('usagereset',{}); } else aiArm('reset'); return; }
}
// Keys added or removed in AI settings show or hide the ✨ controls straight away.
window.__aiChanged=function(s){
  document.body.classList.toggle('nokey',!s.hasKey);
  var el=document.getElementById('s-aistatus'), P=s.usage.p[s.provider];
  if(el) el.textContent=s.hasKey?AI_PN[s.provider]+' — '+s.model[s.provider]+(P&&P.calls?' — '+aiFmtN(P.in+P.out)+' tokens used':''):'Add a Claude or OpenAI key for ✨ comment ideas';
};
// ── your activities: kudos and comments, without leaving the digest ──
var MINE=null, MINEVIEW='main';
var HEART='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>';
window.__patchMine=function(html){ var old=document.getElementById('mine'); if(!old) return; var t=document.createElement('template'); t.innerHTML=html.trim(); old.replaceWith(t.content.firstElementChild); };
function initialsOf(n){ return String(n||'?').split(' ').filter(Boolean).map(function(w){ return w.charAt(0); }).join('').slice(0,2).toUpperCase(); }
function avH(p,size){ return '<span class="mavw" style="width:'+size+'px;height:'+size+'px">'+escH(initialsOf(p.name))+(p.avatar?'<img src="'+escH(p.avatar)+'" alt="" onerror="this.remove()">':'')+'</span>'; }
function mineSheet(){
  var ov=document.getElementById('msheet');
  if(!ov){
    ov=document.createElement('div'); ov.id='msheet'; ov.hidden=true;
    ov.innerHTML='<div class="msp" role="dialog" aria-label="Your activity"><div class="msgrab"></div><div class="msh"></div><div class="msb"></div><div class="msf"><button class="ghost" data-act="mine-strava">Open in Strava</button></div></div>';
    document.body.appendChild(ov);
    ov.addEventListener('click',function(e){ if(e.target===ov) closeMine(); });
  }
  return ov;
}
function openMine(btn){
  var ov=mineSheet(), id=btn.dataset.mine;
  MINE={ id:id, name:btn.dataset.name, emoji:btn.dataset.emoji, line:btn.dataset.line, kudos:+btn.dataset.kudos||0, commentCount:+btn.dataset.comments||0, kudoers:[], comments:[], loading:true, likeable:true };
  MINEVIEW='main'; renderMine(); ov.hidden=false; document.body.style.overflow='hidden';
  send('mine-open',{id:id},function(ok,msg){
    if(!MINE||MINE.id!==id) return;
    var d={}; try{ d=JSON.parse(msg); }catch(e){}
    if(ok&&d.ok){ d.loading=false; MINE=d; } else { MINE.loading=false; MINE.failed=true; }
    renderMine();
  });
}
function closeMine(){ var ov=document.getElementById('msheet'); if(ov) ov.hidden=true; MINE=null; document.body.style.overflow=''; }
function renderMine(){
  var ov=document.getElementById('msheet'); if(!ov||!MINE) return;
  var m=MINE, h=ov.querySelector('.msh'), b=ov.querySelector('.msb');
  if(MINEVIEW==='kudos'){
    h.innerHTML='<button class="mbtn" data-act="mine-back" aria-label="Back">‹</button><div class="mtt"><b>'+m.kudoers.length+' kudos</b><small>'+escH(m.name)+'</small></div>';
    b.innerHTML='<div>'+m.kudoers.map(function(p){
      var com=m.comments.some(function(c){ return (c.athleteId&&c.athleteId===p.id)||c.name===p.name; });
      return '<div class="mrow">'+avH(p,40)+'<span class="mname">'+escH(p.name)+'</span>'+(com?'<span class="mtag">💬 Commented</span>':'')+'</div>';
    }).join('')+'</div>';
    return;
  }
  h.innerHTML='<span class="mic" aria-hidden="true">'+escH(m.emoji||'')+'</span><div class="mtt"><b>'+escH(m.name)+'</b><small>'+escH(m.line||'')+'</small></div><button class="mbtn" data-act="mine-close" aria-label="Close">✕</button>';
  var html='<div class="msec"><div class="msect">👍 <b>'+m.kudos+' kudos</b></div>';
  if(m.loading) html+='<div class="mbox muted">Loading who gave kudos…</div>';
  else if(m.kudoers.length){
    var names=m.kudoers.slice(0,2).map(function(p){ return '<b>'+escH(p.name)+'</b>'; }).join(', '), rest=m.kudos-Math.min(2,m.kudoers.length);
    html+='<button class="mbox" data-act="mine-all"><span class="mstack">'+m.kudoers.slice(0,5).map(function(p){ return avH(p,30); }).join('')+'</span><span class="mkt">'+names+(rest>0?' and '+rest+' other'+(rest>1?'s':''):'')+'</span><span class="mall">See all</span></button>';
  } else html+='<div class="mbox muted">'+(m.kudos?'Strava didn’t share who gave kudos here. Open the activity in Strava to see them.':'No kudos yet.')+'</div>';
  html+='</div><div class="msec"><div class="msect">💬 <b>'+m.commentCount+' comment'+(m.commentCount===1?'':'s')+'</b></div>';
  if(m.loading) html+='<div class="mbox muted">Loading comments…</div>';
  else if(m.comments.length) html+=m.comments.map(function(c,i){
    return '<div class="mcom">'+avH(c,36)+'<div class="mctx"><b>'+escH(c.name)+'</b><small>'+escH(c.ago||'')+'</small><p>'+escH(c.text)+'</p></div>'+
      '<button class="mheart'+(c.liked?' on':'')+'" data-clike="'+i+'"'+(m.likeable?'':' disabled')+' aria-pressed="'+(c.liked?'true':'false')+'" aria-label="'+(c.liked?'Unlike':'Like')+' comment by '+escH(c.name)+'">'+HEART+'<span>'+(c.likes||0)+'</span></button></div>';
  }).join('');
  else html+='<div class="mbox muted">'+(m.commentCount?'Strava didn’t share the comments here. Open the activity in Strava to read them.':'No comments yet.')+'</div>';
  html+='</div>';
  if(m.failed) html+='<p class="mnote">Couldn’t load the details from Strava. Pull to refresh, then try again.</p>';
  b.innerHTML=html;
}
function likeMine(btn){
  var c=MINE&&MINE.comments[+btn.dataset.clike]; if(!c||btn.disabled||c.busy) return;
  var on=!c.liked; c.liked=on; c.likes=Math.max(0,(c.likes||0)+(on?1:-1)); c.busy=true; renderMine();
  send('comment-like',{aid:MINE.id,cid:c.id||'',text:c.text,on:on?'1':'0'},function(ok,msg){
    c.busy=false;
    if(!ok){
      c.liked=!on; c.likes=Math.max(0,(c.likes||0)+(on?-1:1));
      if(msg==='UNSUPPORTED'){ if(MINE) MINE.likeable=false; toast('Strava doesn’t offer liking comments here, so the hearts are read-only.'); }
      else toast('Like not sent: '+(msg||'unknown error'));
    }
    renderMine();
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
  var fx=e.target.closest('[data-expand],[data-expandp]');
  if(fx&&!e.target.closest('button,[data-photo],[data-athlete],input,textarea,select')){
    if(fx.dataset.expand!==undefined){ var art=fx.closest('.act'); var on=art.classList.toggle('open'); var hd=art.querySelector('.ah'); if(hd) hd.setAttribute('aria-expanded',on); }
    else { var sec=fx.closest('section.person'), box=sec.querySelector('.tacts'); box.hidden=!box.hidden; sec.classList.toggle('open',!box.hidden); var pn=sec.querySelector('.pn'); if(pn) pn.setAttribute('aria-expanded',!box.hidden); }
    return;
  }
  var t=e.target.closest('button,[data-open],[data-photo],[data-athlete],[data-detail]'); if(!t) return;
  if(t.dataset.detail) return openDetail(t.dataset.detail);
  if(t.dataset.mine) return openMine(t);
  if(t.dataset.clike!==undefined) return likeMine(t);
  if(t.dataset.act==='mine-close') return closeMine();
  if(t.dataset.act==='mine-all'){ MINEVIEW='kudos'; renderMine(); var sb=document.querySelector('#msheet .msb'); if(sb) sb.scrollTop=0; return; }
  if(t.dataset.act==='mine-back'){ MINEVIEW='main'; renderMine(); return; }
  if(t.dataset.act==='mine-strava'){ if(MINE) send('activity',{id:MINE.id}); return; }
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
  if(t.dataset.act==='cs-close') return closeComposer();
  if(t.dataset.mode) return setMode(t.dataset.mode, t);
  if(t.dataset.sug!==undefined){
    var ta=t.closest('.cbox').querySelector('textarea'); ta.value=t.textContent; ta.focus(); return;
  }
  if(t.dataset.comment){
    var box=t.closest('.cbox'),ta=box.querySelector('textarea'),text=ta.value.trim(),id=t.dataset.comment;
    if(!text) return;
    t.disabled=true; t.textContent='…';
    if(document.activeElement) document.activeElement.blur();
    var det=document.getElementById('det');
    var cso=t.closest('#csheet');
    var who=t.closest('section.person')||(cso&&cso.dataset.pid?document.querySelector('section.person[data-pid="'+CSS.escape(cso.dataset.pid)+'"]'):null)||(t.closest('#det')&&det.dataset.pid?document.querySelector('section.person[data-pid="'+CSS.escape(det.dataset.pid)+'"]'):null);
    var flight=showSending(who, text);
    send('comment',{id:id,text:text},function(ok,msg){
      t.disabled=false; t.textContent='Post';
      if(ok){ ta.value=''; if(cso) closeComposer(true); else box.hidden=true; document.querySelectorAll('.act[data-id="'+CSS.escape(id)+'"] .cc').forEach(function(cc){ cc.textContent=(+cc.textContent||0)+1; }); }
      flight.finish(ok,msg);
    });
    return;
  }
  var act=t.dataset.act;
  if(act==='toggle-comment') openComposer(t.closest('.act'));
  if(act==='kudo-all') kudoAll(t);
  if(act==='upd-now') updNow(t);
  if(act==='upd-later') updLater();
  if(act==='upd-close'){ var uo=document.getElementById('upd'); if(uo) uo.remove(); }
  if(act==='settings') openSettings();
  if(act==='cfgclose') closeSettings();
  if(act==='ai-open') window.__aiOpen();
  if(['look','toggle','cfgreset','cfgstep','cfgall','updcheck','openurl','rules-reset','style-clear','style-learn'].indexOf(act)>=0) cfgAction(t,act);
  if(act==='send-close') closeSending();
  if(act==='lb-close') closePhotos();
  if(act==='refresh'){ document.body.classList.add('loading'); toast('Refreshing'); send('refresh',{}); }
});
</script></body></html>`;
}

// ───────────── entry point (last, so every const above is initialised) ─────────────

await loadSettings();   // before every branch: app, widget and Shortcuts runs all use the saved choices
const wantsRefreshOnly = !!(qp.refresh || args.shortcutParameter === 'refresh');
if (config.runsInWidget || config.runsInAccessoryWidget) {
  await runWidget();             // never builds or presents a WebView, Alert or QuickLook
} else if (wantsRefreshOnly) {
  try { await refreshOnly(); } catch (e) { console.error(e); }
} else {
  widgetIcon();                  // caches the logo tile for the widget, in the background
  aiMigrate(['strava-digest-openai-key'], LEGACY_AI_MODEL);   // 1.8.x kept one OpenAI key and model elsewhere
  try { await main(); }
  catch (e) {
    const a = new Alert(); a.title = 'Strava digest'; a.message = String(e.message || e);
    a.addAction('OK'); await a.present();
  }
}
Script.complete();
