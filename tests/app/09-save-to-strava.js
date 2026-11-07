// 9. ✍️ Posting assistant: title and description ideas for your own activity, and Save to Strava.
//    The ideas request carries your activity and its current text; New ideas carries your request. Saving goes through
//    Strava's edit form and keeps every other field (gear, visibility, commute); without the form it uses the inline edit;
//    when Strava refuses both, nothing is claimed as saved and the text is copied with a way to open Strava. Only your
//    activity is touched. Without an AI key there are no requests, only a note.
'use strict';
const { fakeAI } = require('../lib/fake-ai');
const MINE = '9100901';   // Morning Run, today (docs/site/scenario.js)

module.exports = { n: 9, title: 'Posting assistant: ideas and Save to Strava', run: async (browser, H) => {
  const { opened, check, until, pg, has, tap, text, noErrors } = H;
  const openPost = async (emu) => {
    await tap(emu, `#mine [data-mine="${MINE}"]`);
    check(await until(() => has(emu, '#msheet [data-act="post-open"]'), 8000), 'your activity opens with ✍️ Posting assistant');
    await tap(emu, '#msheet [data-act="post-open"]');
  };
  const ready = (emu) => until(() => has(emu, '#msheet #patitle'), 15000);

  for (const mode of ['form', 'inline', 'form-refused', 'refuse']) {
    console.log('  · ' + { form: 'Strava takes the edit form', inline: 'no form on the edit page: the inline edit', 'form-refused': 'the form is refused: the inline edit', refuse: 'Strava refuses everything' }[mode]);
    const ai = fakeAI(), strava = { edit: { mode } };
    const emu = await opened(browser, { ai, strava }, mode);
    await openPost(emu);
    check(await ready(emu), 'title and description ideas show');
    const asked = ai.of('post')[0] || {};
    check(ai.of('post').length === 1, 'one ideas request');
    check(/Morning Run/.test(asked.user || ''), 'it carries your activity and its current title');
    check(await pg(emu).locator('#msheet [data-ptitle]').count() === 5 && await pg(emu).locator('#msheet [data-pdesc]').count() === 3, '5 titles and 3 descriptions to pick from');
    await tap(emu, '#msheet [data-ptitle="2"]');
    check(await pg(emu).locator('#msheet #patitle').inputValue() === 'Trail therapy', 'tapping a title puts it in the title box');
    await pg(emu).locator('#msheet #padesc').fill('Edited by hand: hills, then cake.');
    await pg(emu).locator('#msheet #padesc').dispatchEvent('input');
    if (mode === 'form') {
      await pg(emu).locator('#msheet #patweak').fill('mention the cake');
      await tap(emu, '#msheet [data-act="post-again"]');
      check(await until(() => ai.of('post').length === 2, 10000), 'New ideas asks again');
      check(/mention the cake/.test(ai.of('post')[1].system), 'with your request for this round');
      await ready(emu);
      await tap(emu, '#msheet [data-ptitle="2"]');
      await pg(emu).locator('#msheet #padesc').fill('Edited by hand: hills, then cake.');
      await pg(emu).locator('#msheet #padesc').dispatchEvent('input');
    }
    await tap(emu, '#msheet [data-act="post-save"]');
    const e = strava.edit;
    if (mode !== 'refuse') {
      check(await until(() => e.saved[MINE], 15000), 'the change reaches Strava');
      check(e.saved[MINE].name === 'Trail therapy' && e.saved[MINE].description === 'Edited by hand: hills, then cake.', 'with the picked title and the edited description');
      check(Object.keys(e.saved).join() === MINE && e.posts.every((p) => p.id === MINE), 'only your activity is touched');
      if (mode === 'form') {
        const p = e.posts.find((x) => x.how === 'form') || { params: {} };
        check(p.params['activity[gear_id]'] === 'g2' && p.params['activity[visibility]'] === 'followers_only' && !('activity[commute]' in p.params), 'gear, visibility and commute are sent back as they were');
        check(!('commit' in p.params) && p.params.authenticity_token === 'form-token', 'with the form\'s own token, without the submit button');
        check(e.posts.length === 1, 'one request is enough');
      } else if (mode === 'inline') check(!e.posts.some((p) => p.how === 'form') && e.posts.some((p) => p.how === 'inline'), 'without a form on the edit page, the inline edit is used');
      else check(e.posts[0] && e.posts[0].how === 'form' && e.posts.some((p) => p.how === 'inline'), 'the form is tried first, then the inline edit');
      check(await until(() => text(emu, '#toast').then((t) => /Saved to Strava/.test(t)), 8000), '“Saved to Strava ✓” shows');
      check(await until(() => text(emu, '#msheet .mnote').then((t) => /Now on Strava: Trail therapy/.test(t)), 4000), '“Now on Strava” shows the new title');
    } else {
      check(await until(() => has(emu, '#msheet .pawarn'), 15000), 'Strava refusing says so, with Open');
      check(!Object.keys(e.saved).length, 'nothing is saved');
      check(/Trail therapy/.test(emu.pasteboard || '') && /hills, then cake/.test(emu.pasteboard || ''), 'the title and description are copied to paste in Strava');
      check(!/Saved to Strava/.test(await text(emu, '#toast')), 'nothing claims it was saved');
    }
    noErrors(emu); await emu.close();
  }
  {
    console.log('  · no AI key');
    const ai = fakeAI();
    const emu = await opened(browser, { ai, noAIKey: true }, 'no key');
    await openPost(emu);
    check(await until(() => text(emu, '#msheet .msb').then((t) => /need an AI key/.test(t)), 8000), 'a note says ideas need an AI key');
    check(ai.calls.length === 0, 'no AI request is made');
    noErrors(emu); await emu.close();
  }
} };
