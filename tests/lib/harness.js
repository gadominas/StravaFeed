// Shared by every app test: the emulator, the pretend strava.com and AI services, and the check / until / tap helpers.
'use strict';
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..', '..');
const BP = process.env.APP_BLUEPRINTS || path.join(ROOT, '..', 'app-blueprints');
const SITE = path.join(BP, 'repo-site');
const { chromium } = require(require.resolve('playwright', { paths: [SITE] }));
const { Emulator, sleep } = require(path.join(SITE, 'tools', 'scriptable-emulator'));
const sc = require(path.join(ROOT, 'docs', 'site', 'scenario.js'));
const { stravaRoutes } = require('./fake-strava');
process.env.TZ = sc.timezone || 'Europe/Vilnius';

const COMMENT_TPL = { method: 'POST', enc: 'json', ct: 'application/json', url: 'https://www.strava.com/feed/activity/{{ID}}/comment', body: '{"text":"{{TEXT}}"}' };
const STRAVA_LOGIN_PAGE = `<!doctype html><html><head><title>Log In | Strava</title><meta name="csrf-token" content="t0k3n"></head>
<body><h1>Log in to Strava</h1><form id="login" action="/session/new-login" method="get"><input name="email"><button id="signin" type="submit">Log In</button></form></body></html>`;
const PHOTO = path.join(ROOT, 'tests', 'fixtures', 'lake.jpg');   // 900 × 1200, a lake: what Photos hands over

// auth: { loggedIn, sticky, density, settings (merged into settings.json), aiSettings (merged into the AI settings),
//         keychain, openaiKey, noAIKey, ai (a fakeAI), strava (fake-strava state), photos ({ library, camera }), alerts, routes, data, files }
function fixtures(auth) {
  auth.posted = auth.posted || []; auth.logins = auth.logins || 0; auth.logoutCalls = auth.logoutCalls || 0;
  const base = sc.fixtures({ id: 'app-test', density: auth.density });
  for (const k of Object.keys(base.files || {})) {
    if (auth.settings && /settings\.json$/.test(k) && !/ai-settings/.test(k)) Object.assign(base.files[k], auth.settings);
    if (auth.aiSettings && /ai-settings\.json$/.test(k)) Object.assign(base.files[k], auth.aiSettings);
    if (auth.settingsRaw != null && /StravaFeed\/settings\.json$/.test(k)) base.files[k] = auth.settingsRaw;   // a file as it is on disk, broken or not
  }
  if (auth.data) {   // the app's own data files, e.g. { 'sent-comments': [...] } → StravaFeed/sent-comments.json
    const dir = Object.keys(base.files).find((k) => /StravaFeed\/settings\.json$/.test(k)).replace(/settings\.json$/, '');
    for (const [n, v] of Object.entries(auth.data)) base.files[dir + n + '.json'] = v;
  }
  if (auth.files) for (const [k, v] of Object.entries(auth.files)) {   // by the end of the name, e.g. { 'strava-digest-usage.json': {...} }
    const at = Object.keys(base.files).find((x) => x.endsWith('/' + k)); base.files[at || k] = v;
  }
  const out = { status: 401, body: 'You need to log in', contentType: 'text/html' };
  const routes = [
    ...(auth.routes || []),
    ...(auth.ai ? auth.ai.routes : []),
    ...(auth.strava ? stravaRoutes(auth.strava) : []),
    // posting a comment (the app's learned request, see the keychain below)
    { match: (url, req) => /strava\.com\/feed\/activity\/\d+\/comment$/.test(url) && (req.method || 'GET') !== 'GET', respond: (req) => { auth.posted.push(req.json ? req.json() : req.body); return { json: { ok: true } }; } },
    { match: /strava\.com\/login/, respond: { body: STRAVA_LOGIN_PAGE, contentType: 'text/html' } },
    { match: /strava\.com\/session\/new-login/, respond: () => { auth.loggedIn = true; auth.logins++; return { body: '<html><body>Dashboard</body></html>', contentType: 'text/html' }; } },
    { match: /strava\.com\/(session|logout)(\?|$)/, respond: () => { if (!auth.sticky) auth.loggedIn = false; auth.logoutCalls++; return { body: 'bye', contentType: 'text/html' }; } },
    // with the session gone, every page that needs a login refuses
    { match: (url) => /strava\.com\/(dashboard|settings|athlete|athletes|feed|activities)/.test(url) && !auth.loggedIn, respond: out },
  ];
  const keychain = Object.assign({}, auth.keychain || base.keychain, { 'strava-digest-comment-request': JSON.stringify(COMMENT_TPL) });
  if (auth.openaiKey) keychain.STRAVA_DIGEST_OPENAI_KEY = 'sk-test-openai-0000';
  if (auth.noAIKey) { delete keychain.STRAVA_DIGEST_ANTHROPIC_KEY; delete keychain.STRAVA_DIGEST_OPENAI_KEY; }
  const fx = Object.assign({}, base, { routes: routes.concat(base.routes), keychain });
  if (auth.photos) fx.photos = auth.photos;
  if (auth.alerts) fx.alerts = auth.alerts;   // answers for Alert.present(): numbers or { index, text: [...] }
  return fx;
}

const results = { passes: 0, failures: 0, failed: [] };
function check(ok, what) { if (ok) { results.passes++; console.log('  ✓ ' + what); } else { results.failures++; results.failed.push(what); console.log('  ✗ ' + what); } return !!ok; }
async function until(fn, ms = 15000, step = 200) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await fn()) return true; } catch (e) {} await sleep(step); } return false; }

async function start(browser, auth) {
  const emu = new Emulator({ browser, fixtures: fixtures(auth), scriptPath: path.join(ROOT, sc.app.script), now: sc.now,
    locale: 'en_US', timezone: sc.timezone, log: (s) => { if (process.env.VERBOSE || / ! /.test(s)) console.log(s); } });
  emu.run();
  await emu.waitForPresent();
  return emu;
}
const pg = (emu) => emu.presented._page;
const has = (emu, sel) => pg(emu).locator(sel).filter({ visible: true }).count().then((n) => n > 0);
const tap = (emu, sel) => pg(emu).locator(sel).filter({ visible: true }).first().click({ timeout: 5000 });
const count = (emu, sel) => pg(emu).locator(sel).count();
const text = (emu, sel) => pg(emu).locator(sel).first().textContent({ timeout: 3000 }).catch(() => '');
const noErrors = (emu) => check(!emu.errors.length, 'no page errors' + (emu.errors.length ? ': ' + emu.errors.slice(0, 2).join(' | ') : ''));
// The digest is open: a returning athlete goes straight to the feed
async function opened(browser, auth, label) {
  const emu = await start(browser, Object.assign({ loggedIn: true }, auth));
  check(await until(() => has(emu, 'section.person'), 30000), 'the digest opens' + (label ? ` (${label})` : ''));
  return emu;
}
const photo = () => fs.readFileSync(PHOTO);
// The settings file as the app last wrote it
const SETTINGS = Object.keys(sc.fixtures({ id: 'x' }).files).find((k) => /StravaFeed\/settings\.json$/.test(k));
const savedSettings = (emu) => { try { return JSON.parse(emu.files.get(SETTINGS).toString('utf8')); } catch (e) { return null; } };
// A constant from the app's script, e.g. the default instructions
const appConst = (name) => { const src = fs.readFileSync(path.join(ROOT, sc.app.script), 'utf8'); const m = new RegExp('const ' + name + ' = `([\\s\\S]*?)`;').exec(src); return m ? m[1] : null; };

module.exports = { ROOT, BP, SITE, chromium, Emulator, sleep, sc, fixtures, results, check, until, start, opened, pg, has, tap, count, text, noErrors, photo, savedSettings, appConst, COMMENT_TPL };
