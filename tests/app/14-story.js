// 14. 📖 The day's story: written from the day's people; a language pick and a "Rewrite it" tweak write it again with that
//     language or tweak; the template comic (💥 Pop) draws its pages and opens the share sheet by itself, 📤 Share comic pulsing until shared; without a key a note.
'use strict';
const { fakeAI } = require('../lib/fake-ai');

module.exports = { n: 14, title: 'The day\'s story and the template comic', run: async (browser, H) => {
  const { opened, check, until, pg, has, tap, text, noErrors, sleep } = H;
  const story = { title: 'Relay on the coast', paragraphs: [{ text: '[PANEL 1] [Visual] Jonas rides the coast.', photos: [] }, { text: 'Tomas runs the river.', photos: [] }, { text: 'Everyone gets home.', photos: [] }] };
  {
    const ai = fakeAI({ story });
    const emu = await opened(browser, { ai }, 'story');
    await tap(emu, '[data-act="story"]');
    check(await until(() => text(emu, '#storysheet .stb').then((t) => /Relay on the coast/.test(t)), 15000), 'the story is written and shown');
    const s1 = ai.of('story')[0] || {};
    check(/athletes/.test(s1.user || '') && /Jonas|Tomas/.test(s1.user || ''), 'from the day\'s people');
    await tap(emu, '#storysheet .lng[data-slang="Lithuanian"]');
    check(await until(() => ai.of('story').length === 2, 10000) && /story in Lithuanian/.test(ai.of('story')[1].system), 'Lithuanian writes it again in Lithuanian');
    await until(() => has(emu, '#storysheet [data-stw]'), 10000);
    const tw = await pg(emu).evaluate(() => (document.querySelector('#storysheet [data-stw]') || {}).dataset.stw);
    await tap(emu, `#storysheet [data-stw="${tw}"]`);
    check(await until(() => ai.of('story').length === 3, 10000) && /For this version only/.test(ai.of('story')[2].system), `a Rewrite it tweak writes it again with that tweak (${tw})`);
    await until(() => pg(emu).locator('#storysheet [data-act="story-image"]:not([disabled])').count().then((n) => n > 0), 15000);
    await tap(emu, '#storysheet [data-act="story-image"]');
    await until(() => has(emu, '#cpick [data-cstyle="pop"]'), 5000);
    await tap(emu, '#cpick [data-cstyle="pop"]');
    check(await until(() => emu.shared.length > 0, 20000), '💥 Pop draws the pages and opens the share sheet by itself');
    check(ai.of('image').length === 0, 'the template needs no picture requests');
    check(await has(emu, '#storysheet [data-act="story-comic-share"].pulse'), 'not shared yet: 📤 Share comic pulses');
    await tap(emu, '#storysheet [data-act="story-comic-share"]');
    check(await until(() => emu.shared.length === 2, 20000), 'Share comic opens the share sheet again');
    const pics = (emu.shared[0] || []).filter((x) => x.type === 'image');
    check(pics.length >= 1 && pics.every((x) => x.size.width === 1080 && x.size.height === 1350), `with the pages at 1080 × 1350 (${pics.length})`);
    noErrors(emu); await emu.close();
  }
  {
    const ai = fakeAI();
    const emu = await opened(browser, { ai, noAIKey: true }, 'no key');
    await tap(emu, '[data-act="story"]');
    check(await until(() => has(emu, '#storysheet .keyhelp'), 8000), 'without a key the story sheet says it needs one');
    check(ai.calls.length === 0, 'and asks nothing');
    noErrors(emu); await emu.close();
  }
} };
