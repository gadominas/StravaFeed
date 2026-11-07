// 13. ✨ Comment ideas, beyond the count: built on your draft (and marked so); after you pick an idea, ↻ goes back to your
//     draft; a new tone or language asks again with that mood or language; an answer in the wrong language is asked for
//     once more; the activity's photos are looked at once and the writer gets what was seen (and if the model can't read
//     photos, the ideas come anyway); without a key the composer has no ✨ Suggest and makes no request; Cancel ignores the answer.
'use strict';
const { fakeAI } = require('../lib/fake-ai');
const PHOTOS = '9100101';   // Golden hour coast loop: 2 photos
const PLAIN = '9100102';    // Commute in: no photos

module.exports = { n: 13, title: 'Comment ideas: draft, tone, language and photos', run: async (browser, H) => {
  const { opened, check, until, pg, has, tap, text, noErrors, sleep } = H;
  const compose = async (emu, id) => { await tap(emu, `.act[data-id="${id}"] [data-act="toggle-comment"]`); await until(() => has(emu, '#csheet textarea'), 5000); };
  const suggest = (emu) => tap(emu, '#csheet .sgo');
  const ideas = (emu) => pg(emu).locator('#csheet .sugs .sug').allTextContents();
  const shown = (emu) => until(() => pg(emu).locator('#csheet .sugs .sug').count().then((n) => n > 0), 15000);

  {
    console.log('  · built on your draft');
    const ai = fakeAI();
    const emu = await opened(browser, { ai }, 'draft');
    await compose(emu, PLAIN);
    const draft = 'I would like to give Aidas to Marina for this amazing ride';
    await pg(emu).locator('#csheet textarea').fill(draft); await pg(emu).locator('#csheet textarea').dispatchEvent('input');
    await suggest(emu); await shown(emu);
    const c1 = ai.of('comments')[0] || {};
    check(c1.system && c1.system.includes(`started this comment: "${draft}"`), 'the request carries your draft');
    check(/misheard/.test(c1.system || '') && /closest to the draft/.test(c1.system || ''), 'with the rules for dictation and the closest option first');
    check(/Built on your draft/.test(await text(emu, '#csheet .sdraft')), '“Built on your draft” shows above the ideas');
    check(await pg(emu).locator('#csheet .sug.fromdraft.closest').count() === 1 && await pg(emu).locator('#csheet .sug.fromdraft').count() === (await ideas(emu)).length, 'every idea is marked, the first as closest');
    await tap(emu, '#csheet .sug >> nth=1');
    await tap(emu, '#csheet .again');
    await until(() => ai.of('comments').length === 2, 10000);
    check((ai.of('comments')[1] || {}).system.includes(`started this comment: "${draft}"`), '↻ after picking an idea sends your draft again, not the idea');
    noErrors(emu); await emu.close();
  }
  {
    console.log('  · tone and language');
    const ai = fakeAI({ comments: (c, n) => (n === 3 ? ['Great ride today!', 'Nice one, that was fast', 'Wow, what a day'] : n === 4 ? ['Šaunus važiavimas, tikrai!', 'Labai greitai, faina', 'Kaip gražu ten'] : ['Strong ride!', 'Fast and steady', 'What a route']) });
    const emu = await opened(browser, { ai, settings: { aiMode: 'mystyle', aiLang: 'English' } }, 'tone');
    await compose(emu, PLAIN); await suggest(emu); await shown(emu);
    const funny = await pg(emu).evaluate(() => (document.querySelector('#csheet .mode:not(.on)[data-mode]') || {}).dataset.mode);
    await tap(emu, `#csheet .mode[data-mode="${funny}"]`);
    check(await until(() => ai.of('comments').length === 2, 10000), 'a new tone asks again straight away');
    check(/Mood for these options:/.test(ai.of('comments')[1].system), `with that mood (${funny})`);
    await tap(emu, '#csheet .lng[data-lang="Lithuanian"]');
    check(await until(() => ai.of('comments').length === 4, 15000), 'Lithuanian asks again, and once more when the answer is in English');
    check(/every comment in Lithuanian/.test(ai.of('comments')[2].system) && /Your last answer was not in Lithuanian/.test(ai.of('comments')[3].system), 'the second request says the last answer was in the wrong language');
    check(await until(async () => /Šaunus/.test((await ideas(emu)).join(' ')), 5000), 'the Lithuanian ideas show');
    noErrors(emu); await emu.close();
  }
  {
    console.log('  · photos looked at');
    const ai = fakeAI();
    const emu = await opened(browser, { ai }, 'photos');
    await compose(emu, PHOTOS); await suggest(emu); await shown(emu);
    const scan = ai.of('scan'), w = ai.of('comments')[0] || {};
    check(scan.length === 1 && scan[0].images === 2, 'the 2 photos are looked at once');
    check(/photo_observations/.test(w.user || '') && /forest/.test(w.user || '') && w.images === 0, 'the writer gets what was seen, without sending the photos again');
    noErrors(emu); await emu.close();
  }
  {
    console.log('  · a model that can\'t read photos');
    const ai = fakeAI({ scan: { error: 'This model does not support image input.', code: 'invalid_request_error' } });
    const emu = await opened(browser, { ai }, 'no vision');
    await compose(emu, PHOTOS); await suggest(emu);
    check(await shown(emu), 'ideas come anyway');
    check(ai.of('scan').length === 1 && (ai.of('comments')[0] || {}).images === 0, 'one scan, then ideas without photos');
    noErrors(emu); await emu.close();
  }
  {
    console.log('  · no key, and Cancel');
    const ai = fakeAI();
    const emu = await opened(browser, { ai, noAIKey: true }, 'no key');
    await compose(emu, PLAIN); await sleep(600);
    check(!(await has(emu, '#csheet .sgo')) && /Write a comment$/.test(await pg(emu).locator('#csheet textarea').getAttribute('placeholder')), 'without a key the composer is plain: no ✨ Suggest');
    check(ai.calls.length === 0, 'no request is made');
    await emu.close();
    const slow = fakeAI({ comments: () => ({ delay: 3000, text: '["Late idea"]' }) });
    const e2 = await opened(browser, { ai: slow }, 'cancel');
    await compose(e2, PLAIN); await suggest(e2);
    await until(() => has(e2, '#ideaov .icancel'), 5000); await tap(e2, '#ideaov .icancel');
    await sleep(4000);
    check(!(await ideas(e2)).includes('Late idea') && !(await has(e2, '#ideaov')), 'Cancel closes the sky and the late answer is ignored');
    noErrors(e2); await e2.close();
  }
} };
