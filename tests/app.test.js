#!/usr/bin/env node
// App regression test: runs the real script in the Scriptable emulator (app-blueprints/repo-site) against a pretend
// strava.com whose session can be ended and started again, and checks every step a person takes.
//
//   node tests/app.test.js            (app-blueprints checked out next to this repository, its repo-site deps installed)
//   APP_BLUEPRINTS=/path/to/app-blueprints node tests/app.test.js
//
// Flows:
//   1. Opening while logged out: the login page shows, "Log in to Strava" opens Strava's login, logging in opens the digest.
//   2. Logging out in Settings (two taps) and logging back in: the same login page works again.
//   3. Logging out when Strava keeps the session: the "Almost logged out" page, its Open Strava button, then the login page.
//   4. Posting a comment, in the Comfortable and Tiny layouts: it reaches Strava, "Delivered" shows, then everything closes.
//   5. Your own activities: never in the feed (not even with the old "Show my own activities" setting), only in the strip on top.
//   6. The order of people, strictly, in each group: early risers (earliest first), then people with photos, then everyone
//      else (both newest first); also after the details load, which can turn someone into an early riser.
//   7. Comment ideas: exactly the number set in Settings › ✨ Comment ideas per tap (1 to 5, 3 by default). The AI is asked
//      for that many; extra ones are dropped; when it sends fewer or repeats itself, the app asks once for the missing ones.
'use strict';
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const BP = process.env.APP_BLUEPRINTS || path.join(ROOT, '..', 'app-blueprints');
const SITE = path.join(BP, 'repo-site');
const { chromium } = require(require.resolve('playwright', { paths: [SITE] }));
const { Emulator, sleep } = require(path.join(SITE, 'tools', 'scriptable-emulator'));
const sc = require(path.join(ROOT, 'docs', 'site', 'scenario.js'));
process.env.TZ = sc.timezone || 'Europe/Vilnius';

const COMMENT_TPL = { method: 'POST', enc: 'json', ct: 'application/json', url: 'https://www.strava.com/feed/activity/{{ID}}/comment', body: '{"text":"{{TEXT}}"}' };
const STRAVA_LOGIN_PAGE = `<!doctype html><html><head><title>Log In | Strava</title><meta name="csrf-token" content="t0k3n"></head>
<body><h1>Log in to Strava</h1><form id="login" action="/session/new-login" method="get"><input name="email"><button id="signin" type="submit">Log In</button></form></body></html>`;

// strava.com as far as logging in and out goes; everything else comes from the screenshot scenario's fixtures
function fixtures(auth) {
  auth.posted = auth.posted || [];
  const base = sc.fixtures({ id: 'app-test', density: auth.density });
  if (auth.settings) for (const k of Object.keys(base.files || {})) if (/settings\.json$/.test(k) && !/ai-settings/.test(k)) Object.assign(base.files[k], auth.settings);
  const out = { status: 401, body: 'You need to log in', contentType: 'text/html' };
  const routes = [
    // ✨ comment ideas: Claude answers with as many ideas as the test says (auth.ideas), and every request is kept
    ...(auth.ideas ? [{ match: 'api.anthropic.com/v1/messages', respond: (req) => {
      const b = (req.json && req.json()) || {}, sys = typeof b.system === 'string' ? b.system : JSON.stringify(b.system || '');
      if (!/You write comments on a friend/.test(sys)) return null;   // photo scans and the rest: the scenario's own answers
      auth.ideaCalls.push(sys);
      const list = auth.ideas(auth.ideaCalls.length, sys);
      return { json: { id: 'msg_test', type: 'message', role: 'assistant', model: b.model, content: [{ type: 'text', text: JSON.stringify(list) }], stop_reason: 'end_turn', usage: { input_tokens: 100, output_tokens: 40 } } };
    } }] : []),
    // posting a comment (the app's learned request, see the keychain below)
    { match: (url, req) => /strava\.com\/feed\/activity\/\d+\/comment$/.test(url) && (req.method || 'GET') !== 'GET', respond: (req) => { auth.posted.push(req.json ? req.json() : req.body); return { json: { ok: true } }; } },
    { match: /strava\.com\/login/, respond: { body: STRAVA_LOGIN_PAGE, contentType: 'text/html' } },
    { match: /strava\.com\/session\/new-login/, respond: () => { auth.loggedIn = true; auth.logins++; return { body: '<html><body>Dashboard</body></html>', contentType: 'text/html' }; } },
    { match: /strava\.com\/(session|logout)(\?|$)/, respond: () => { if (!auth.sticky) auth.loggedIn = false; auth.logoutCalls++; return { body: 'bye', contentType: 'text/html' }; } },
    // with the session gone, every page that needs a login refuses
    { match: (url) => /strava\.com\/(dashboard|settings|athlete|athletes|feed|activities)/.test(url) && !auth.loggedIn, respond: out },
  ];
  const keychain = Object.assign({}, auth.keychain || base.keychain, { 'strava-digest-comment-request': JSON.stringify(COMMENT_TPL) });
  return Object.assign({}, base, { routes: routes.concat(base.routes), keychain });
}

let failures = 0, passes = 0;
function check(ok, what) { if (ok) { passes++; console.log('  ✓ ' + what); } else { failures++; console.log('  ✗ ' + what); } }
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

// From the app's login page: the button opens Strava's login, and logging in there brings the digest
async function logInFromLoginPage(emu, auth) {
  check(await until(() => has(emu, '[data-act="login"]'), 20000), 'the login page shows its "Log in to Strava" button');
  const before = auth.logins;
  await tap(emu, '[data-act="login"]');
  check(await until(() => /strava\.com\/login/.test(pg(emu).url()), 8000), '"Log in to Strava" opens Strava\'s login page');
  check(await until(() => has(emu, '#signin'), 8000), 'Strava\'s login form is on screen');
  await tap(emu, '#signin');
  check(await until(() => auth.logins > before, 5000), 'logging in on Strava\'s page works');
  check(await until(() => has(emu, 'section.person'), 30000), 'the digest opens by itself after logging in');
}

async function logOutInSettings(emu) {
  await tap(emu, '[data-act="settings"]');
  await until(() => has(emu, '#cfgsheet [data-act="logout"]'), 5000);
  await pg(emu).evaluate(() => document.querySelector('#cfgsheet [data-act="logout"]').scrollIntoView({ block: 'center' }));
  await tap(emu, '#cfgsheet [data-act="logout"]');
  check(await until(() => pg(emu).locator('#cfgsheet [data-act="logout"].armed').count().then((n) => n > 0), 2000), 'the first tap arms Log out');
  await tap(emu, '#cfgsheet [data-act="logout"]');
}

// Every button's data-act must be handled by the page or the app: a button nothing answers looks fine and does nothing.
function staticCheck() {
  console.log('▸ 0. Every button does something');
  const src = require('fs').readFileSync(path.join(ROOT, sc.app.script), 'utf8');
  const acts = new Set([...src.matchAll(/data-act=\\?["']([a-z0-9-]+)/g)].map((m) => m[1]));
  const handled = new Set([...src.matchAll(/act\s*===\s*'([a-z0-9-]+)'/g)].map((m) => m[1]));
  for (const m of src.matchAll(/\[((?:'[a-z0-9-]+',?)+)\]\.indexOf\(act\)/g)) for (const x of m[1].matchAll(/'([a-z0-9-]+)'/g)) handled.add(x[1]);
  const OWN_LISTENER = ['idea-cancel'];   // wired with addEventListener where the button is made
  const dead = [...acts].filter((a) => !handled.has(a) && !OWN_LISTENER.includes(a));
  check(!dead.length, `all ${acts.size} button actions are handled` + (dead.length ? ' (not handled: ' + dead.join(', ') + ')' : ''));
  check(/head === 'login'/.test(src) && /head === 'retry'/.test(src) && /head === 'logout'/.test(src), 'the app answers login, retry and logout');
  // Two page functions with one name: the later one silently replaces the other everywhere (1.30.0's comic burst() broke "Delivered")
  const twice = (rx) => { const c = {}; for (const m of src.matchAll(rx)) c[m[1]] = (c[m[1]] || 0) + 1; return Object.keys(c).filter((k) => c[k] > 1); };
  const fns = twice(/^function\s+([\w$]+)\s*\(/gm), vars = twice(/^var\s+([\w$]+)/gm);
  check(!fns.length, 'no two top-level functions share a name' + (fns.length ? ' (' + fns.join(', ') + ')' : ''));
  check(!vars.length, 'no two top-level vars share a name' + (vars.length ? ' (' + vars.join(', ') + ')' : ''));
  check(/if \(a\.athleteId === me\) continue;/.test(src), 'the feed always leaves out your own activities');
}

// Post a comment from the comment sheet: it reaches Strava, the "Delivered" screen shows and then goes away by itself
async function postComment(emu, auth, open) {
  const text = 'Test comment ' + Math.random().toString(36).slice(2, 7);
  await tap(emu, open);
  check(await until(() => has(emu, '#csheet textarea'), 5000), 'the comment sheet opens');
  await pg(emu).locator('#csheet textarea').fill(text);
  await pg(emu).locator('#csheet textarea').dispatchEvent('input');
  check(await until(() => pg(emu).locator('#csheet .cpost:not([disabled])').count().then((n) => n > 0), 3000), 'Post lights up once there is text');
  const before = auth.posted.length;
  await tap(emu, '#csheet .cpost');
  check(await until(() => auth.posted.length > before, 10000), 'the comment reaches Strava');
  check(JSON.stringify(auth.posted[auth.posted.length - 1] || '').includes(text), 'with the text that was typed');
  check(await until(() => pg(emu).locator('#sendov .svt').textContent().then((t) => /Delivered/.test(t)), 8000), '"Delivered" shows');
  check(await until(() => pg(emu).locator('#sendov').isHidden(), 6000), 'the Delivered screen goes away by itself');
  check(await until(() => pg(emu).evaluate(() => { const c = document.getElementById('csheet'); return !c || c.hidden || !c.classList.contains('open'); }), 3000), 'the comment sheet is closed');
  check(await pg(emu).evaluate(() => getComputedStyle(document.body).overflow !== 'hidden' && getComputedStyle(document.documentElement).overflow !== 'hidden'), 'the digest scrolls again');
}

// Open the comment sheet on one activity and tap ✨ Suggest comments: the ideas shown
async function ideasShown(emu, open) {
  await tap(emu, open);
  check(await until(() => has(emu, '#csheet textarea'), 5000), 'the comment sheet opens');
  await until(() => has(emu, '#csheet .sgo'), 3000);
  await tap(emu, '#csheet .sgo');
  await until(() => pg(emu).locator('#csheet .sugs .sug').count().then((n) => n > 0), 20000);
  await sleep(300);
  return pg(emu).locator('#csheet .sugs .sug').allTextContents();
}

async function main() {
  staticCheck();
  const browser = await chromium.launch();
  try {
    console.log('▸ 1. Opening while logged out');
    {
      const auth = { loggedIn: false, logins: 0, logoutCalls: 0, keychain: {} };
      const emu = await start(browser, auth);
      await logInFromLoginPage(emu, auth);
      check(!emu.errors.length, 'no page errors' + (emu.errors.length ? ': ' + emu.errors.slice(0, 2).join(' | ') : ''));
      await emu.close();
    }
    console.log('▸ 2. Logging out in Settings, then logging back in');
    {
      const auth = { loggedIn: true, logins: 0, logoutCalls: 0 };
      const emu = await start(browser, auth);
      check(await until(() => has(emu, 'section.person'), 30000), 'the digest opens while logged in');
      await logOutInSettings(emu);
      check(await until(() => auth.logoutCalls > 0 && !auth.loggedIn, 15000), 'Strava is asked to end the session');
      check(await until(() => !emu.keychain.has('strava-digest-athlete-id'), 5000), 'the remembered athlete ID is forgotten');
      await logInFromLoginPage(emu, auth);
      // and once more, to be sure the second round works as well as the first
      await logOutInSettings(emu);
      check(await until(() => !auth.loggedIn, 15000), 'a second log out works');
      await logInFromLoginPage(emu, auth);
      check(!emu.errors.length, 'no page errors' + (emu.errors.length ? ': ' + emu.errors.slice(0, 2).join(' | ') : ''));
      await emu.close();
    }
    console.log('▸ 3. Logging out when Strava keeps the session');
    {
      const auth = { loggedIn: true, logins: 0, logoutCalls: 0, sticky: true };
      const emu = await start(browser, auth);
      check(await until(() => has(emu, 'section.person'), 30000), 'the digest opens while logged in');
      await logOutInSettings(emu);
      check(await until(() => pg(emu).getByText('Almost logged out').count().then((n) => n > 0), 20000), 'the "Almost logged out" page explains what to do');
      check(await until(() => has(emu, '[data-act="login"]'), 3000), 'its Open Strava button is there');
      await tap(emu, '[data-act="login"]');
      check(await until(() => /strava\.com\/login/.test(pg(emu).url()), 8000), 'Open Strava opens Strava\'s page');
      auth.sticky = false; auth.loggedIn = false;   // the person taps Log Out on Strava's page
      check(await until(() => has(emu, '[data-act="login"]') && pg(emu).getByText('Log in to Strava').count().then((n) => n > 0), 20000), 'the app notices and shows its login page');
      await logInFromLoginPage(emu, auth);
      await emu.close();
    }
    console.log('▸ 4. Posting a comment');
    for (const density of ['comfortable', 'tiny']) {
      const auth = { loggedIn: true, logins: 0, logoutCalls: 0, density };
      const emu = await start(browser, auth);
      check(await until(() => has(emu, 'section.person'), 30000), `the digest opens (${density})`);
      await postComment(emu, auth, density === 'tiny' ? ':nth-match(.tcm, 1)' : '.act[data-id="9100101"] [data-act="toggle-comment"]');
      await postComment(emu, auth, density === 'tiny' ? ':nth-match(.tcm, 2)' : '.act[data-id="9100102"] [data-act="toggle-comment"]');   // and a second one
      check(!emu.errors.length, 'no page errors' + (emu.errors.length ? ': ' + emu.errors.slice(0, 2).join(' | ') : ''));
      await emu.close();
    }
    console.log('▸ 5. Your own activities');
    for (const density of ['comfortable', 'tiny']) {
      // the old "Show my own activities" switch still saved as on: it must not bring them back
      const auth = { loggedIn: true, logins: 0, logoutCalls: 0, density, settings: { includeMe: true } };
      const emu = await start(browser, auth);
      check(await until(() => has(emu, 'section.person'), 30000), `the digest opens (${density})`);
      const mine = await pg(emu).evaluate(() => ({
        inFeed: [...document.querySelectorAll('section.person')].filter((s) => /Sam Rivers/.test(s.textContent)).length,
        strip: document.querySelectorAll('#mine .mt').length,
        stripRow: (() => { const t = [...document.querySelectorAll('#mine .mt')].map((x) => x.getBoundingClientRect()); return t.length > 1 && Math.abs(t[0].top - t[1].top) < 2 && t[1].left > t[0].left; })(),
        allCount: (document.querySelector('.allk') || {}).textContent || '',
        waiting: document.querySelectorAll('section.person:not([data-counted]) .kudo:not([disabled]), section.person:not([data-counted]) .person-k').length,
      }));
      check(mine.inFeed === 0, 'your own activities are not in the feed');
      check(mine.strip >= 2, 'they are in Your activities on top');
      check(mine.stripRow, 'side by side, left to right');
      check(!/Sam/.test(mine.allCount), '👍 All doesn\'t count you');
      check(!emu.errors.length, 'no page errors' + (emu.errors.length ? ': ' + emu.errors.slice(0, 2).join(' | ') : ''));
      await emu.close();
    }
    console.log('▸ 6. The order of people');
    for (const density of ['comfortable', 'tiny']) {
      const auth = { loggedIn: true, logins: 0, logoutCalls: 0, density };
      const emu = await start(browser, auth);
      check(await until(() => has(emu, 'section.person'), 30000), `the digest opens (${density})`);
      await sleep(4000);   // the details load and may reorder the lines
      const groups = await pg(emu).evaluate(() => [...document.querySelectorAll('h2.sec')].map((h) => {
        const out = []; let n = h.nextElementSibling;
        while (n && n.matches('section.person')) {
          out.push({ name: (n.querySelector('.pn b') || {}).textContent, rank: +n.dataset.rank, t: +n.dataset.t,
            early: !!n.querySelector('.avtag'), photos: !!n.querySelector('[data-photo]') || /📷/.test((n.querySelector('.ind') || {}).textContent || '') });
          n = n.nextElementSibling;
        }
        return { title: h.firstChild.textContent, people: out };
      }));
      let ok = groups.length > 0, why = '';
      for (const g of groups) g.people.forEach((p, i) => {
        const want = p.early ? 0 : p.photos ? 1 : 2;
        if (p.rank !== want) { ok = false; why = why || `${p.name} ranked ${p.rank}, should be ${want}`; }
        const q = g.people[i - 1];
        if (!q) return;
        if (q.rank > p.rank) { ok = false; why = why || `${q.name} (${q.rank}) before ${p.name} (${p.rank})`; }
        if (q.rank === p.rank && (p.rank === 0 ? q.t > p.t : q.t < p.t)) { ok = false; why = why || `${q.name} and ${p.name} out of time order`; }
      });
      check(ok, 'early risers first (earliest first), then photos, then the rest (newest first)' + (why ? ': ' + why : ''));
      const top = groups[0] && groups[0].people[0];
      check(!!top && top.early, 'the first line of the day is an early riser' + (top ? ` (${top.name})` : ''));
      check(!emu.errors.length, 'no page errors' + (emu.errors.length ? ': ' + emu.errors.slice(0, 2).join(' | ') : ''));
      await emu.close();
    }
    console.log('▸ 7. Comment ideas: exactly the number set in Settings');
    const idea = (k) => ['Strong finish on that last climb!', 'Early start, big reward 🌅', 'Those splits look smooth', 'Lovely route today', 'Legs of steel', 'Fast and steady', 'What a view up there'][k % 7];
    const cases = [
      { label: '4 set, 4 sent', set: 4, ideas: (call) => [0, 1, 2, 3].map(idea), want: 4, calls: 1 },
      { label: '4 set, only 3 sent: the 4th is asked for', set: 4, ideas: (call) => call === 1 ? [0, 1, 2].map(idea) : [idea(3)], want: 4, calls: 2 },
      { label: '5 set, 2 sent with a repeat: the missing 3 are asked for', set: 5, ideas: (call) => call === 1 ? [idea(0), idea(0).toUpperCase(), idea(1)] : [4, 5, 6].map(idea), want: 5, calls: 2 },
      { label: '2 set, 5 sent: only 2 shown', set: 2, ideas: () => [0, 1, 2, 3, 4].map(idea), want: 2, calls: 1 },
      { label: '1 set', set: 1, ideas: () => [0, 1, 2].map(idea), want: 1, calls: 1 },
      { label: 'nothing set: the default of 3', set: null, ideas: () => [0, 1, 2, 3, 4].map(idea), want: 3, calls: 1 },
      { label: '"4" saved as text still means 4', set: '4', ideas: () => [0, 1, 2, 3].map(idea), want: 4, calls: 1 },
    ];
    for (const c of cases) {
      const auth = { loggedIn: true, logins: 0, logoutCalls: 0, ideaCalls: [], ideas: c.ideas, settings: c.set == null ? {} : { cfg: { suggestions: c.set } } };
      const emu = await start(browser, auth);
      check(await until(() => has(emu, 'section.person'), 30000), `the digest opens (${c.label})`);
      const shown = await ideasShown(emu, '.act[data-id="9100101"] [data-act="toggle-comment"]');
      check(shown.length === c.want, `${c.want} idea${c.want === 1 ? '' : 's'} shown (got ${shown.length})`);
      const want = typeof c.set === 'string' ? +c.set : c.set == null ? 3 : c.set;
      check(new RegExp(`exactly ${want} (different )?(option|comment)`).test(auth.ideaCalls[0] || ''), `the AI is asked for exactly ${want}`);
      check(auth.ideaCalls.length === c.calls, c.calls === 1 ? 'one request is enough' : `the missing ones are asked for once (${auth.ideaCalls.length} requests)`);
      check(new Set(shown.map((x) => x.toLowerCase())).size === shown.length, 'no idea is shown twice');
      check(!emu.errors.length, 'no page errors' + (emu.errors.length ? ': ' + emu.errors.slice(0, 2).join(' | ') : ''));
      await emu.close();
    }
  } finally { await browser.close(); }
  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
