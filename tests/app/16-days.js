// 16. Days, refresh and retry: Yesterday shows yesterday's people and date; Refresh reads the feed again and keeps the
//     digest; when Strava's feed fails the app says so with Try again, and Try again brings the digest back.
'use strict';
const { fakeAI } = require('../lib/fake-ai');

module.exports = { n: 16, title: 'Days, refresh and retry', run: async (browser, H) => {
  const { opened, start, check, until, pg, has, tap, text, noErrors, sleep } = H;
  const feedCalls = { n: 0, fail: 0 };
  const routes = [{ match: /strava\.com\/dashboard\/feed\?/, respond: () => { feedCalls.n++; if (feedCalls.fail > 0) { feedCalls.fail--; return { status: 500, body: 'Server error', contentType: 'text/plain' }; } return null; } }];
  {
    const emu = await opened(browser, { ai: fakeAI(), routes }, 'days');
    const today = await text(emu, '.top h1');
    check(await has(emu, '.act[data-id="9100101"]') && !(await has(emu, '.act[data-id="9100111"]')), 'today shows today\'s activities');
    await tap(emu, 'button.day[data-day="1"]');
    check(await until(() => has(emu, '.act[data-id="9100111"]'), 15000), 'Yesterday shows yesterday\'s activities');
    check(!(await has(emu, '.act[data-id="9100101"]')) && (await text(emu, '.top h1')) !== today, 'with yesterday\'s date, without today\'s');
    check(await has(emu, 'button.day[data-day="1"][aria-current="date"]'), 'Yesterday is marked as the day shown');
    await tap(emu, 'button.day[data-day="0"]');
    await until(() => has(emu, '.act[data-id="9100101"]'), 15000);
    const before = feedCalls.n;
    await tap(emu, '[data-act="refresh"]');
    check(await until(() => feedCalls.n > before, 15000), 'Refresh reads Strava\'s feed again');
    check(await until(() => has(emu, '.act[data-id="9100101"]'), 15000), 'and the digest is back');
    noErrors(emu); await emu.close();
  }
  {
    feedCalls.fail = 99;
    const emu = await start(browser, { loggedIn: true, ai: fakeAI(), routes });
    check(await until(() => has(emu, '[data-act="refresh"], [data-act="retry"]') .then(async (x) => x && !(await has(emu, 'section.person'))), 40000), 'a failing feed shows Try again instead of the digest');
    feedCalls.fail = 0;
    await tap(emu, '.center [data-act="refresh"], .center [data-act="retry"]').catch(() => tap(emu, '[data-act="refresh"]'));
    check(await until(() => has(emu, 'section.person'), 30000), 'Try again brings the digest back');
    noErrors(emu); await emu.close();
  }
} };
