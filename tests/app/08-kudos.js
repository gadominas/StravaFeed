// 8. Kudos: one kudos reaches Strava and the counts move; a refused one changes nothing; 👍 All asks twice, then gives
//    every waiting person exactly one; a person Strava refuses stays waiting; your own activities never get a kudos button.
'use strict';
const { fakeAI } = require('../lib/fake-ai');

module.exports = { n: 8, title: 'Kudos and 👍 All', run: async (browser, H) => {
  const { opened, check, until, pg, has, tap, count, text, noErrors } = H;
  const waiting = (emu) => pg(emu).evaluate(() => [...document.querySelectorAll('section.person .person-k:not(.done)')].map((b) => b.dataset.kudo));
  const num = async (emu, sel) => +((await text(emu, sel)) || 0);

  {
    console.log('  · one kudos, and one Strava refuses');
    const strava = { kudoFail: new Set() };
    const emu = await opened(browser, { strava, ai: fakeAI() }, 'comfortable');
    const list = await waiting(emu);
    check(list.length >= 3, `people are waiting for kudos (${list.length})`);
    const todo0 = await num(emu, '.sec.todo span'), given0 = await num(emu, '.sec.given span');
    const first = list[0];
    await tap(emu, `.person-k[data-kudo="${first}"]`);
    check(await until(() => strava.kudos.includes(first), 8000), 'the kudos reaches Strava');
    check(await until(() => pg(emu).locator(`.person-k[data-kudo="${first}"].done`).count().then((n) => n > 0), 5000), 'the button turns into ✓ Kudos given');
    check(await until(async () => (await num(emu, '.sec.todo span')) === todo0 - 1, 3000), `Waiting goes down by one (${todo0} → ${todo0 - 1})`);
    check(await until(async () => (await num(emu, '.sec.given span')) === given0 + 1, 3000), `Kudos given goes up by one (${given0} → ${given0 + 1})`);
    check(strava.kudos.filter((x) => x === first).length === 1, 'exactly one request for it');

    const second = list[1]; strava.kudoFail.add(second);
    await tap(emu, `.person-k[data-kudo="${second}"]`);
    check(await until(() => strava.kudos.includes(second), 8000), 'the second kudos is tried');
    check(await until(() => pg(emu).locator('#toast.on').count().then((n) => n > 0), 4000) && /Kudos not sent/.test(await text(emu, '#toast')), 'Strava refusing shows “Kudos not sent”');
    check(await until(() => pg(emu).locator(`.person-k[data-kudo="${second}"]:not(.done):not([disabled])`).count().then((n) => n > 0), 4000), 'its button is back, not marked as given');
    check(await num(emu, '.sec.todo span') === todo0 - 1, 'Waiting doesn\'t move for the refused one');
    check(await count(emu, '#mine [data-kudo]') === 0, 'your own activities have no kudos button');
    noErrors(emu); await emu.close();
  }
  {
    console.log('  · 👍 All, with one person Strava refuses');
    const strava = { kudoFail: new Set() };
    const emu = await opened(browser, { strava, ai: fakeAI() }, 'All');
    const list = await waiting(emu);
    strava.kudoFail.add(list[list.length - 1]);
    await tap(emu, '.allk');
    check(await until(() => pg(emu).locator('.allk.armed').count().then((n) => n > 0), 2000), 'the first tap only asks: “Send N?”');
    check(/Send \d+\?/.test(await text(emu, '.allk')) && strava.kudos.length === 0, 'nothing is sent yet');
    await tap(emu, '.allk');
    check(await until(() => strava.kudos.length >= list.length, 20000), `every waiting person is tried (${strava.kudos.length} of ${list.length})`);
    const each = list.every((id) => strava.kudos.filter((x) => x === id).length === 1);
    check(each && strava.kudos.length === list.length, 'exactly one kudos each, nobody twice');
    await until(() => pg(emu).locator('#kov').isHidden().catch(() => true), 8000);
    if (!(await pg(emu).locator('#kov').isHidden().catch(() => true))) await pg(emu).locator('#kov').click({ timeout: 3000 }).catch(() => {});
    check(await until(async () => (await waiting(emu)).join() === String(list[list.length - 1]), 8000), 'only the refused person is still waiting');
    check(await until(() => text(emu, '.allk').then((t) => /All 1/.test(t)), 5000), '👍 All now says 1');
    noErrors(emu); await emu.close();
  }
} };
