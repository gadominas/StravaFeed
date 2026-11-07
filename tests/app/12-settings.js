// 12. Settings and configuration: the steppers stop at their minimum and maximum, save what they show and Reset brings
//     back the default; Days in the header changes the header; your instructions for comments, the story, posts and
//     photos are saved, reach their AI requests, and Reset to default restores the app's text; untouched old photo
//     instructions move to the new default; a broken settings file opens with the defaults.
'use strict';
const { fakeAI } = require('../lib/fake-ai');
const MINE = '9100901';

module.exports = { n: 12, title: 'Settings and configuration', run: async (browser, H) => {
  const { opened, check, until, pg, has, tap, text, noErrors, sleep, savedSettings, appConst, photo } = H;
  const openSettings = async (emu) => { await tap(emu, '[data-act="settings"]'); return until(() => pg(emu).locator('#cfgsheet [data-act="cfgstep"]').count().then((n) => n > 0), 6000); };
  const step = (emu, k, v) => pg(emu).evaluate(([k, v]) => { const b = document.querySelector(`#cfgsheet [data-act="cfgstep"][data-k="${k}"][data-v="${v}"]`); if (!b || b.disabled) return false; b.click(); return true; }, [k, String(v)]);
  const shown = (emu, k) => pg(emu).evaluate((k) => (document.querySelector(`#cfgsheet input.cfgin[data-k="${k}"]`) || {}).value, k);
  const off = (emu, k, v) => pg(emu).evaluate(([k, v]) => !!(document.querySelector(`#cfgsheet [data-act="cfgstep"][data-k="${k}"][data-v="${v}"]`) || {}).disabled, [k, String(v)]);
  const ideasAsked = async (emu, ai) => {
    await tap(emu, '.act[data-id="9100101"] [data-act="toggle-comment"]');
    await until(() => has(emu, '#csheet .sgo'), 5000); await tap(emu, '#csheet .sgo');
    await until(() => ai.of('comments').length > 0, 15000);
    return (ai.of('comments')[0] || {}).system || '';
  };

  {
    console.log('  · steppers: ✨ Comment ideas per tap (1 to 5) and Days in the header (1 to 7)');
    const emu = await opened(browser, { ai: fakeAI() }, 'steppers');
    check(await openSettings(emu), 'Settings shows the steppers');
    for (let i = 0; i < 8; i++) { await step(emu, 'suggestions', 1); await sleep(150); }
    check(await until(async () => (await shown(emu, 'suggestions')) === '5' && await off(emu, 'suggestions', 1), 4000), '+ stops at 5');
    check(await until(() => (savedSettings(emu) || {}).cfg && savedSettings(emu).cfg.suggestions === 5, 4000), '5 is saved');
    for (let i = 0; i < 8; i++) { await step(emu, 'suggestions', -1); await sleep(150); }
    check(await until(async () => (await shown(emu, 'suggestions')) === '1' && await off(emu, 'suggestions', -1), 4000), '− stops at 1');
    check(await until(() => savedSettings(emu).cfg.suggestions === 1, 4000), '1 is saved');
    await pg(emu).evaluate(() => document.querySelector('#cfgsheet [data-act="cfgreset"][data-k="suggestions"]').click());
    check(await until(async () => (await shown(emu, 'suggestions')) === '3' && !('suggestions' in (savedSettings(emu).cfg || {})), 4000), 'Reset brings back 3 and saves nothing extra');
    for (let i = 0; i < 2; i++) { await step(emu, 'daysInPicker', 1); await sleep(150); }
    check(await until(() => savedSettings(emu).cfg.daysInPicker === 4, 4000), 'Days in the header: 4 is saved');
    await pg(emu).evaluate(() => { const b = document.querySelector('[data-act="cfgclose"]'); if (b) b.click(); });
    check(await until(() => pg(emu).locator('button.day[data-day]').count().then((n) => n === 4), 15000), 'the header shows 4 days');
    for (let i = 0; i < 9; i++) { await openSettings(emu).catch(() => {}); if (!(await step(emu, 'daysInPicker', 1))) break; }
    check(await shown(emu, 'daysInPicker') === '7' && await off(emu, 'daysInPicker', 1), 'Days in the header stops at 7');
    noErrors(emu); await emu.close();
  }
  {
    console.log('  · your comment instructions: saved, sent, reset');
    const ai = fakeAI();
    const emu = await opened(browser, { ai }, 'comment rules');
    await openSettings(emu);
    const box = pg(emu).locator('#cfgsheet textarea.rules[data-k="commentRules"]');
    await box.scrollIntoViewIfNeeded(); await box.fill('TEST-RULE: always mention the weather.'); await box.dispatchEvent('change');
    check(await until(() => (savedSettings(emu) || {}).commentRules === 'TEST-RULE: always mention the weather.', 4000), 'they are saved');
    await pg(emu).evaluate(() => { const b = document.querySelector('[data-act="cfgclose"]'); if (b) b.click(); });
    await sleep(600);
    check(/TEST-RULE: always mention the weather\./.test(await ideasAsked(emu, ai)), 'comment ideas follow them');
    await pg(emu).evaluate(() => { const c = document.querySelector('#csheet [data-act="cs-close"]'); if (c) c.click(); });
    await until(() => pg(emu).evaluate(() => { const c = document.getElementById('csheet'); return !c || c.hidden; }), 4000);
    await openSettings(emu);
    await pg(emu).evaluate(() => document.querySelector('#cfgsheet [data-act="rules-reset"]').click());
    const def = appConst('DEFAULT_COMMENT_RULES');
    check(await until(() => (savedSettings(emu) || {}).commentRules === def, 4000), 'Reset to default restores the app\'s instructions');
    noErrors(emu); await emu.close();
  }
  {
    console.log('  · story, post and photo instructions reach their requests');
    const ai = fakeAI();
    const emu = await opened(browser, { ai, settings: { storyRules: 'STORY-RULE: rhyme it.', postRules: 'POST-RULE: no emojis.', overlayRules: 'PHOTO-RULE: top left.' }, photos: { library: [photo()] } }, 'rules');
    await tap(emu, '[data-act="story"]');
    check(await until(() => ai.of('story').length > 0, 15000) && /STORY-RULE: rhyme it\./.test(ai.of('story')[0].system), 'the day\'s story follows the story instructions');
    await pg(emu).evaluate(() => { const b = document.querySelector('#storysheet [data-act="story-close"]'); if (b) b.click(); });
    await tap(emu, `#mine [data-mine="${MINE}"]`);
    await until(() => has(emu, '#msheet [data-act="post-open"]'), 8000); await tap(emu, '#msheet [data-act="post-open"]');
    check(await until(() => ai.of('post').length > 0, 15000) && /POST-RULE: no emojis\./.test(ai.of('post')[0].system), 'title and description ideas follow the post instructions');
    await tap(emu, '#msheet [data-act="mine-back"]'); await tap(emu, '#msheet [data-act="photo-open"]');
    await tap(emu, '#msheet [data-act="photo-pick"][data-src="library"]'); await until(() => has(emu, '#msheet .pago'), 8000); await tap(emu, '#msheet .pago');
    check(await until(() => ai.of('overlay').length > 0, 15000) && /PHOTO-RULE: top left\./.test(ai.of('overlay')[0].system), 'the photo design follows the photo instructions');
    noErrors(emu); await emu.close();
  }
  {
    console.log('  · old photo instructions, never changed, move to the new default');
    const ai = fakeAI();
    const emu = await opened(browser, { ai, settings: { overlayRules: appConst('OLD_OVERLAY_RULES') }, photos: { library: [photo()] } }, 'migration');
    await tap(emu, `#mine [data-mine="${MINE}"]`); await until(() => has(emu, '#msheet [data-act="photo-open"]'), 8000);
    await tap(emu, '#msheet [data-act="photo-open"]'); await tap(emu, '#msheet [data-act="photo-pick"][data-src="library"]');
    await until(() => has(emu, '#msheet .pago'), 8000); await tap(emu, '#msheet .pago');
    await until(() => ai.of('overlay').length > 0, 15000);
    const sys = (ai.of('overlay')[0] || {}).system || '';
    check(sys.includes(appConst('DEFAULT_OVERLAY_RULES').split('\n')[0]) && !sys.includes(appConst('OLD_OVERLAY_RULES').split('\n')[0]), 'the photo design gets the new default, not the old text');
    noErrors(emu); await emu.close();
  }
  {
    console.log('  · a broken settings file');
    const ai = fakeAI();
    const emu = await opened(browser, { ai, settingsRaw: '{"cfg": {"suggestions": 4, ' }, 'broken file');
    check(/exactly 3 /.test(await ideasAsked(emu, ai)), 'the app opens and uses the defaults (3 ideas)');
    noErrors(emu); await emu.close();
  }
} };
