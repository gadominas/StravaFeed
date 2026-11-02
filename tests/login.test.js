#!/usr/bin/env node
// Login and log-out regression test: runs the real script in the Scriptable emulator (app-blueprints/repo-site)
// against a pretend strava.com whose session can be ended and started again, and checks every step a person takes.
//
//   node tests/login.test.js            (app-blueprints checked out next to this repository, its repo-site deps installed)
//   APP_BLUEPRINTS=/path/to/app-blueprints node tests/login.test.js
//
// Flows:
//   1. Opening while logged out: the login page shows, "Log in to Strava" opens Strava's login, logging in opens the digest.
//   2. Logging out in Settings (two taps) and logging back in: the same login page works again.
//   3. Logging out when Strava keeps the session: the "Almost logged out" page, its Open Strava button, then the login page.
'use strict';
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const BP = process.env.APP_BLUEPRINTS || path.join(ROOT, '..', 'app-blueprints');
const SITE = path.join(BP, 'repo-site');
const { chromium } = require(require.resolve('playwright', { paths: [SITE] }));
const { Emulator, sleep } = require(path.join(SITE, 'tools', 'scriptable-emulator'));
const sc = require(path.join(ROOT, 'docs', 'site', 'scenario.js'));
process.env.TZ = sc.timezone || 'Europe/Vilnius';

const STRAVA_LOGIN_PAGE = `<!doctype html><html><head><title>Log In | Strava</title><meta name="csrf-token" content="t0k3n"></head>
<body><h1>Log in to Strava</h1><form id="login" action="/session/new-login" method="get"><input name="email"><button id="signin" type="submit">Log In</button></form></body></html>`;

// strava.com as far as logging in and out goes; everything else comes from the screenshot scenario's fixtures
function fixtures(auth) {
  const base = sc.fixtures({ id: 'login-test' });
  const out = { status: 401, body: 'You need to log in', contentType: 'text/html' };
  const routes = [
    { match: /strava\.com\/login/, respond: { body: STRAVA_LOGIN_PAGE, contentType: 'text/html' } },
    { match: /strava\.com\/session\/new-login/, respond: () => { auth.loggedIn = true; auth.logins++; return { body: '<html><body>Dashboard</body></html>', contentType: 'text/html' }; } },
    { match: /strava\.com\/(session|logout)(\?|$)/, respond: () => { if (!auth.sticky) auth.loggedIn = false; auth.logoutCalls++; return { body: 'bye', contentType: 'text/html' }; } },
    // with the session gone, every page that needs a login refuses
    { match: (url) => /strava\.com\/(dashboard|settings|athlete|athletes|feed|activities)/.test(url) && !auth.loggedIn, respond: out },
  ];
  return Object.assign({}, base, { routes: routes.concat(base.routes), keychain: auth.keychain || base.keychain });
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
  } finally { await browser.close(); }
  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
