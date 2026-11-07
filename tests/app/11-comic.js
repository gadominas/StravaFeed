// 11. 💥 Comic › ✨ Drawn by AI: the story's AI plans the pages, GPT Image draws them, two at a time.
//     The comic factory covers the screen while it works and goes when it's done; at most 6 pages are drawn whatever the
//     plan says; a page that can't be drawn is left out and counted ("1 page couldn't be drawn"), the rest are shared;
//     without an OpenAI key the button is off and nothing is asked for.
'use strict';
const { fakeAI } = require('../lib/fake-ai');

const plan = (n) => ({ characters: 'Sam: blue jacket', pages: Array.from({ length: n }, (_, k) => ({ photos: [], people: ['Jonas'], description: `Panel 1: page ${k + 1}. Caption: "Page ${k + 1}" Bubble (Jonas): "Hi ${k + 1}"` })) });

module.exports = { n: 11, title: 'Comics drawn by AI', run: async (browser, H) => {
  const { opened, check, until, pg, has, tap, text, noErrors, sleep } = H;
  const toComic = async (emu) => {
    await tap(emu, '[data-act="story"]');
    check(await until(() => pg(emu).locator('#storysheet [data-act="story-image"]:not([disabled])').count().then((n) => n > 0), 20000), 'the day\'s story is written');
    await tap(emu, '#storysheet [data-act="story-image"]');
    return until(() => has(emu, '#cpick .cpai'), 5000);
  };

  {
    console.log('  · 4 pages planned, page 2 can\'t be drawn');
    const ai = fakeAI({ comicPlan: plan(4), image: (c) => (/PAGE 2:/.test(c.prompt) ? { error: 'Your request was rejected by the safety system.', code: 'moderation_blocked' } : { wait: 400 }) });
    const emu = await opened(browser, { ai, openaiKey: true }, 'comic');
    check(await toComic(emu), '💥 Comic offers ✨ Drawn by AI');
    await tap(emu, '#cpick .cpai');
    check(await until(() => has(emu, '#cfab'), 4000), 'the comic factory covers the screen');
    check(await until(() => has(emu, '#storysheet [data-act="story-comic-share"]'), 30000), '📤 Share comic appears when the pages are drawn');
    check(/1 page couldn.t be drawn/.test(await text(emu, '#toast')), '“1 page couldn’t be drawn” shows with “Your comic is ready”');
    check(/\(3 pages\)/.test(await text(emu, '#storysheet [data-act="story-comic-share"]')), 'Share comic says 3 pages');
    check(await until(() => count0(emu), 5000), 'the factory goes away');
    check(emu.shared.length === 0, 'nothing is shared before you tap');
    await tap(emu, '#storysheet [data-act="story-comic-share"]');
    check(await until(() => emu.shared.length > 0, 8000), 'Share comic opens the share sheet');
    const pics = (emu.shared[0] || []).filter((x) => x.type === 'image');
    check(pics.length === 3, `the 3 drawn pages are shared (${pics.length})`);
    check(ai.of('comicPlan').length === 1 && /A test day/.test(ai.of('comicPlan')[0].user), 'one plan request, with the story');
    const p2 = ai.of('image').filter((c) => /PAGE 2:/.test(c.prompt));
    check(p2.length === 2 && p2[0].pictures.length > 0 && p2[1].pictures.length === 0, 'the refused page is tried once more without the profile pictures, then left out');
    check(ai.of('image').length === 5, `5 picture requests in all (${ai.of('image').length})`);
    check(ai.maxImagesAtOnce <= 2, `never more than 2 pages drawn at once (${ai.maxImagesAtOnce})`);
    noErrors(emu); await emu.close();
  }
  {
    console.log('  · 9 pages planned: 6 are drawn');
    const ai = fakeAI({ comicPlan: plan(9) });
    const emu = await opened(browser, { ai, openaiKey: true }, 'cap');
    await toComic(emu); await tap(emu, '#cpick .cpai');
    await until(() => has(emu, '#storysheet [data-act="story-comic-share"]'), 40000);
    await tap(emu, '#storysheet [data-act="story-comic-share"]');
    await until(() => emu.shared.length > 0, 8000);
    const pages = new Set(ai.of('image').map((c) => (/Draw page (\d+) of (\d+)/.exec(c.prompt) || []).slice(1).join('/')));
    check(pages.size === 6 && [...pages].every((x) => /\/6$/.test(x)), `6 pages, each “of 6” (${[...pages].join(', ')})`);
    check(((emu.shared[0] || []).filter((x) => x.type === 'image')).length === 6, '6 pages shared');
    noErrors(emu); await emu.close();
  }
  {
    console.log('  · no OpenAI key');
    const ai = fakeAI();
    const emu = await opened(browser, { ai }, 'no key');
    await toComic(emu);
    check(await has(emu, '#cpick .cpai[disabled]'), '✨ Drawn by AI is off and says it needs an OpenAI key');
    await pg(emu).locator('#cpick .cpai').click({ force: true, timeout: 2000 }).catch(() => {});
    await sleep(800);
    check(ai.of('image').length === 0 && ai.of('comicPlan').length === 0 && !(await has(emu, '#cfab')), 'nothing is asked for');
    noErrors(emu); await emu.close();
  }

  function count0(emu) { return pg(emu).locator('#cfab').count().then((n) => n === 0); }
} };
