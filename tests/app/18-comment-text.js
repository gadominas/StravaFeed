// 18. Comment text in any shape Strava sends it: plain text, rich text as an object ({ text: { text } }), or a list of
//     parts with mentions. Your activity's comments show the words, never "[object Object]".
'use strict';
const { fakeAI } = require('../lib/fake-ai');
const MINE = '9100901';

module.exports = { n: 18, title: 'Comment text in any shape', run: async (browser, H) => {
  const { opened, check, until, pg, has, tap, noErrors } = H;
  const who = (id, name) => ({ id, firstname: name.split(' ')[0], lastname: name.split(' ')[1], name, profile_medium: '' });
  const comments = [
    { id: 1, athlete_id: 2000101, athlete: who(2000101, 'Ines Laurent'), text: 'Plain text, as before', created_at: '2026-10-29T08:00:00Z' },
    { id: 2, athlete_id: 2000102, athlete: who(2000102, 'Marta Kowalska'), text: { text: 'Rich text in an object', mentions: [] }, created_at: '2026-10-29T08:05:00Z' },
    { id: 3, athlete_id: 2000103, athlete: who(2000103, 'Priya Shah'), text: [{ type: 'text', text: 'Great run, ' }, { type: 'mention', athlete: { name: 'Gediminas' } }, { type: 'text', text: ' 👏' }], created_at: '2026-10-29T08:10:00Z' },
  ];
  const routes = [{ match: new RegExp(`strava\\.com/feed/activity/${MINE}/comments`), respond: { json: comments } }];
  const emu = await opened(browser, { ai: fakeAI(), routes }, 'comments');
  await tap(emu, `#mine [data-mine="${MINE}"]`);
  check(await until(() => pg(emu).locator('#msheet .mcom').count().then((n) => n === 3), 15000), 'your activity shows its 3 comments');
  const texts = await pg(emu).locator('#msheet .mcom .mctx p').allTextContents();
  check(texts[0] === 'Plain text, as before', 'plain text shows as it is');
  check(texts[1] === 'Rich text in an object', 'rich text in an object shows its words');
  check(texts[2] === 'Great run, Gediminas 👏', 'parts with a mention read as one sentence');
  check(!texts.some((t) => /\[object/.test(t)), 'never “[object Object]”');
  noErrors(emu); await emu.close();
} };
