// 10. 📸 Photo with your stats: picking a photo (Photos, cancelling) and uploading it to the image model.
//     Nothing is made until you tap: not when a photo is picked, not when the mode changes. 📊 Clean stats sends your wishes
//     and the stats to the AI and draws the result; 🎨 AI redesign sends your wishes to the art director and your photo
//     to GPT Image (edits, high quality, input fidelity, portrait size); before and after show side by side; Save or share
//     hands over the picture. The paid image requests are capped: an unknown parameter or model is retried once, a refused
//     photo isn't retried without the photo, and every error shows in the sheet.
'use strict';
const { fakeAI } = require('../lib/fake-ai');
const MINE = '9100901';

module.exports = { n: 10, title: 'Photos: picking, uploads and the image model', run: async (browser, H) => {
  const { opened, check, until, pg, has, tap, text, noErrors, sleep, photo } = H;
  const openPhoto = async (emu) => {
    await tap(emu, `#mine [data-mine="${MINE}"]`);
    await until(() => has(emu, '#msheet [data-act="photo-open"]'), 8000);
    await tap(emu, '#msheet [data-act="photo-open"]');
    return until(() => has(emu, '#msheet [data-act="photo-pick"]'), 5000);
  };
  const pick = async (emu, src) => { await tap(emu, `#msheet [data-act="photo-pick"][data-src="${src}"]`); };
  const wish = async (emu, w) => { await pg(emu).locator('#msheet #phtweak').fill(w); await pg(emu).locator('#msheet #phtweak').dispatchEvent('input'); };
  const go = (emu) => tap(emu, '#msheet .pago');
  const shareOne = async (emu) => {
    const before = emu.shared.length;
    await tap(emu, '#msheet .msf [data-act="photo-share"]');
    return until(() => emu.shared.length > before && emu.shared[emu.shared.length - 1].some((x) => x.type === 'image'), 8000);
  };

  {
    console.log('  · 📊 Clean stats (no OpenAI key)');
    const ai = fakeAI();
    const emu = await opened(browser, { ai, photos: { library: [photo()], camera: [] } }, 'clean');
    check(await openPhoto(emu), 'the photo screen offers Photos and Camera');
    check(await has(emu, '#msheet [data-act="photo-mode"][data-mode="ai"][disabled]'), '🎨 AI redesign is off without an OpenAI key');
    await pick(emu, 'camera');
    await sleep(800);
    check(emu.photoPicks.join() === 'camera' && await has(emu, '#msheet [data-act="photo-pick"]'), 'cancelling the camera leaves the picker as it was');
    await pick(emu, 'library');
    check(await until(() => text(emu, '#msheet .paorig').then((t) => /no stats yet/.test(t)), 8000), 'the picked photo shows, “Original · no stats yet”');
    await sleep(1500);
    check(ai.calls.length === 0, 'nothing is designed until you tap');
    await wish(emu, 'Top right corner, one big hero number');
    await go(emu);
    check(await until(() => has(emu, '#msheet .pacmp'), 10000), 'Draw my stats shows the original and the result side by side');
    const o = ai.of('overlay');
    check(o.length === 1, 'one design request');
    check(/Top right corner, one big hero number/.test(o[0] && o[0].system), 'with your wishes');
    check(/Distance/.test(o[0] && o[0].user) && o[0].images === 1, 'with the stats and the photo');
    check(await shareOne(emu), 'Save or share hands over the picture');
    const img = emu.shared[emu.shared.length - 1][0];
    check(img.size.width === 900 && img.size.height === 1200, `at the photo's own size (${img.size.width} × ${img.size.height})`);
    noErrors(emu); await emu.close();
  }
  {
    console.log('  · 🎨 AI redesign: the upload');
    const ai = fakeAI({ image: () => ({ wait: 1500 }) });
    const emu = await opened(browser, { ai, openaiKey: true, photos: { library: [photo()] } }, 'redesign');
    await openPhoto(emu);
    check(await has(emu, '#msheet [data-act="photo-mode"][data-mode="ai"].on'), '🎨 AI redesign is the mode with an OpenAI key');
    await pick(emu, 'library');
    await until(() => has(emu, '#msheet .paorig'), 8000);
    await tap(emu, '#msheet [data-act="photo-mode"][data-mode="clean"]'); await sleep(400);
    await tap(emu, '#msheet [data-act="photo-mode"][data-mode="ai"]'); await sleep(1200);
    check(ai.calls.length === 0, 'picking the photo and switching modes start nothing');
    await wish(emu, 'Old film photo from the 1970s');
    await go(emu);
    check(await until(() => has(emu, '#msheet .pastudio'), 5000), 'the studio shows while it paints');
    check(await until(() => has(emu, '#msheet .pacmp'), 20000), 'the result shows beside the original');
    const plan = ai.of('redesign'), img = ai.of('image');
    check(plan.length === 1 && /Old film photo from the 1970s/.test(plan[0].system) && plan[0].images === 1, 'the art director gets your wishes and the photo');
    check(img.length === 1 && img[0].endpoint === 'edits', 'one picture request, an edit of your photo');
    const up = (img[0] && img[0].pictures) || [];
    check(up.length === 1 && up[0].name === 'image[]' && up[0].contentType === 'image/jpeg' && up[0].bytes > 5000, `the photo is uploaded as JPEG (${up.length ? up[0].bytes + ' bytes' : 'none'})`);
    check(img[0] && img[0].size === '1024x1536' && img[0].quality === 'high' && img[0].fidelity === 'high' && img[0].model === 'gpt-image-2', 'portrait size, high quality, high input fidelity, gpt-image-2');
    check(/Numbers to letter, exactly as written/.test(img[0] && img[0].prompt), 'the prompt lists the numbers to letter exactly');
    check(await shareOne(emu), 'Save or share hands over the redesigned picture');
    noErrors(emu); await emu.close();
  }
  const capped = [
    { label: 'an unknown input_fidelity is retried once without it', image: (c, n) => (n === 1 ? { error: "Unknown parameter: 'input_fidelity'.", code: 'unknown_parameter' } : {}), calls: 2, ok: true,
      more: (img) => check(img[0].fidelity === 'high' && !img[1].fidelity, 'the second request leaves input_fidelity out') },
    { label: 'an unknown model is retried once with gpt-image-1, then the error shows', image: () => ({ error: 'The model gpt-image-2 does not exist.', code: 'model_not_found' }), calls: 2, ok: false,
      more: (img) => check(img[1] && img[1].model === 'gpt-image-1', 'the second request uses gpt-image-1') },
    { label: 'a refused photo is not sent again without it', image: () => ({ error: 'Your request was rejected by the safety system.', code: 'moderation_blocked' }), calls: 1, ok: false },
  ];
  for (const c of capped) {
    console.log('  · ' + c.label);
    const ai = fakeAI({ image: c.image });
    const emu = await opened(browser, { ai, openaiKey: true, photos: { library: [photo()] } }, 'retries');
    await openPhoto(emu); await pick(emu, 'library'); await until(() => has(emu, '#msheet .pago'), 8000);
    await go(emu);
    await until(() => has(emu, c.ok ? '#msheet .pacmp' : '#msheet .paask .pago:not([disabled])'), 20000);
    await sleep(500);
    const img = ai.of('image');
    check(img.length === c.calls, `${c.calls} picture request${c.calls === 1 ? '' : 's'}, no more (${img.length})`);
    if (c.more) c.more(img);
    if (c.ok) check(await has(emu, '#msheet .pacmp'), 'the result shows');
    else {
      check(/rejected|does not exist/.test(await text(emu, '#msheet .msb')), 'the error shows in the sheet');
      check(await has(emu, '#msheet .msf [data-act="photo-share"][disabled]'), 'Save or share stays off');
    }
    noErrors(emu); await emu.close();
  }
} };
