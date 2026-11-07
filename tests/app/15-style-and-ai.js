// 15. ✍️ Learn my style and 🤖 AI settings.
//     Learn my style reads your own comments on Strava, asks the AI once to describe your voice, saves it and uses it in
//     every comment request; Clear forgets it. AI settings: adding an OpenAI key through the key prompt saves it in the
//     Keychain and lists the models (the GPT Image models are kept for drawing); switching to OpenAI sends the next
//     comment ideas to OpenAI; removing the key goes back to Claude; Token usage names every feature.
'use strict';
const { fakeAI } = require('../lib/fake-ai');

module.exports = { n: 15, title: 'Learn my style and AI settings', run: async (browser, H) => {
  const { opened, check, until, pg, has, tap, text, noErrors, sleep, savedSettings } = H;
  const openSettings = async (emu) => { await tap(emu, '[data-act="settings"]'); await until(() => has(emu, '#cfgsheet'), 5000); };
  const ideasVia = async (emu, ai) => {
    await tap(emu, '.act[data-id="9100102"] [data-act="toggle-comment"]'); await until(() => has(emu, '#csheet .sgo'), 5000);
    const n = ai.of('comments').length; await tap(emu, '#csheet .sgo'); await until(() => ai.of('comments').length > n, 15000);
    const c = ai.of('comments')[ai.of('comments').length - 1];
    await pg(emu).evaluate(() => { const b = document.querySelector('#csheet [data-act="cs-close"]'); if (b) b.click(); });
    return c;
  };

  {
    console.log('  · Learn my style');
    const ai = fakeAI({ style: 'STYLE-PROFILE: short, dry, one emoji.' });
    const sent = ['Huge effort! 🔥', 'That light though', 'Respect for the early start', 'Legs of steel, again', 'Coffee earned ☕️'].map((text, i) => ({ text, at: Date.now() - i * 864e5 }));
    const emu = await opened(browser, { ai, settings: { styleProfile: '', styleMeta: null, cfg: { styleComments: 5 } }, data: { 'sent-comments': sent } }, 'style');
    await openSettings(emu);
    await pg(emu).evaluate(() => document.querySelector('#cfgsheet [data-act="style-learn"]').scrollIntoView({ block: 'center' }));
    await tap(emu, '#cfgsheet [data-act="style-learn"]');
    check(await until(() => ai.of('style').length === 1, 30000), 'your comments are gathered and the AI is asked once');
    check(/Huge effort! 🔥/.test((ai.of('style')[0] || {}).user || ''), 'with your own comments');
    check(await until(() => /STYLE-PROFILE/.test((savedSettings(emu) || {}).styleProfile || ''), 8000), 'your style is saved');
    await pg(emu).evaluate(() => { if (window.hideStylePop) hideStylePop(); const b = document.querySelector('[data-act="cfgclose"]'); if (b) b.click(); });
    await sleep(800);
    check(/STYLE-PROFILE: short, dry, one emoji\./.test((await ideasVia(emu, ai)).system), 'comment ideas use it');
    await openSettings(emu);
    await pg(emu).evaluate(() => { const b = document.querySelector('#cfgsheet [data-act="style-clear"]'); if (b) { b.scrollIntoView({ block: 'center' }); b.click(); } });
    check(await until(() => !((savedSettings(emu) || {}).styleProfile), 8000), 'Clear forgets it');
    noErrors(emu); await emu.close();
  }
  {
    console.log('  · AI settings: an OpenAI key, models, provider, removing it, token usage');
    const ai = fakeAI();
    const b = { calls: 1, in: 1000, out: 100 }, feats = { comments: b, story: b, comic: b, post: b, overlay: b, style: b };
    const usage = { since: Date.now() - 864e5 * 5, p: { anthropic: { calls: 6, in: 6000, out: 600, models: { 'claude-haiku-5-5': { calls: 6, in: 6000, out: 600 } }, features: feats, days: {} } } };
    const emu = await opened(browser, { ai, alerts: [{ index: 0, text: ['sk-test-new-openai'] }], files: { 'strava-digest-usage.json': usage } }, 'AI settings');
    const openAI = async () => {
      await openSettings(emu);
      await pg(emu).evaluate(() => { const b = document.querySelector('#cfgsheet [data-act="ai-open"]'); if (b) { b.scrollIntoView({ block: 'center' }); b.click(); } });
      return until(() => pg(emu).locator('#aisheet [data-aiact="aikey"][data-v="openai"]').count().then((n) => n > 0), 8000);
    };
    const press = async (sel) => { await until(() => pg(emu).locator(sel).count().then((n) => n > 0), 8000); await pg(emu).evaluate((sel) => document.querySelector(sel).click(), sel); };
    check(await openAI(), 'AI settings open');
    await press('#aisheet [data-aiact="aikey"][data-v="openai"]');
    check(await until(() => emu.keychain.get('STRAVA_DIGEST_OPENAI_KEY') === 'sk-test-new-openai', 8000), 'the pasted OpenAI key is saved in the Keychain');
    const aiFile = () => { try { return JSON.parse(emu.files.get([...emu.files.keys()].find((k) => /ai-settings\.json$/.test(k))).toString()); } catch (e) { return {}; } };
    check(await until(() => (aiFile().imageModels || []).join() === 'gpt-image-2,gpt-image-1', 8000), 'the models are listed, the GPT Image models kept newest first');
    await press('#aisheet [data-aiact="aiprov"][data-v="openai"]');
    check(await until(() => aiFile().aiProvider === 'openai', 6000), 'OpenAI becomes the provider');
    await press('#aisheet [data-aiact="aiclose"]');
    await pg(emu).evaluate(() => { const b = document.querySelector('[data-act="cfgclose"]'); if (b) b.click(); });
    await sleep(800);
    check((await ideasVia(emu, ai)).provider === 'openai', 'the next comment ideas go to OpenAI');
    check(await openAI(), 'AI settings open again');
    const shownUsage = await text(emu, '#aisheet');
    const names = ['Comment ideas', 'Day’s story', 'Comics', 'Titles & descriptions', 'Photo stats', 'Style learning'];
    check(names.every((x) => shownUsage.includes(x)), 'Token usage names every feature: ' + names.join(', '));
    check(!/\b(comic|post|overlay)\b/.test(shownUsage), 'no raw feature tags show');
    await press('#aisheet [data-aiact="airm"][data-v="openai"]');
    await press('#aisheet [data-aiact="airm"][data-v="openai"].armed');   // removing asks for a second tap: Confirm
    check(await until(() => !emu.keychain.get('STRAVA_DIGEST_OPENAI_KEY') && aiFile().aiProvider === 'anthropic', 8000), 'removing the key forgets it and goes back to Claude');
    noErrors(emu); await emu.close();
  }
} };
