// 17. 📊 Clean stats layout: whatever the photo's shape, the layout, the position and the number of stats (up to 12, with
//     long values, a headline and the route line), nothing is drawn in the photo's outer margin. Draws with the app's own
//     drawing code (postCompose) in a browser page and compares the outer band with the untouched photo, pixel by pixel.
'use strict';
const fs = require('fs');
const path = require('path');

module.exports = { n: 17, title: 'Clean stats stay inside the photo', run: async (browser, H) => {
  const { check, ROOT, sc } = H;
  const src = fs.readFileSync(path.join(ROOT, sc.app.script), 'utf8');
  const a = src.indexOf('var PA_FONTS='), b = src.indexOf('function paInput(', a);
  check(a > 0 && b > a, 'the app\'s drawing code is found');
  const code = src.slice(a, b).replace(/\\\\/g, '\\');   // as the page sees it (the script holds it in a template string)
  const stats = [['Distance', '8.90 km'], ['Pace', '5:48 /km'], ['Moving time', '51 m 38 s'], ['Elapsed', '51m 58s'], ['Sport', 'TrailRun'],
    ['Place', 'Vilnius, Vilnius County'], ['Date', '7 Nov 2026'], ['Start', '13:55'], ['Heart rate', '152 bpm'], ['Elevation', '312 m'],
    ['Achievement', 'PR: Lighthouse Climb, 3rd fastest'], ['Weather', 'Overcast, wind 12 km/h']].map(([label, value]) => ({ label, value }));
  const route = 'M26 200L80 150L140 170L200 90L260 120L330 60L400 100L470 70L540 140L574 274L420 240L300 260L150 250L26 200';
  const page = await browser.newPage();
  try {
    await page.setContent('<html><body></body></html>');
    await page.addScriptTag({ content: code });
    const result = await page.evaluate(async ({ stats, route }) => {
      const photo = (w, h) => new Promise((res) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d');
        const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#8aa6c8'); g.addColorStop(1, '#3d5a3a'); x.fillStyle = g; x.fillRect(0, 0, w, h);
        const im = new Image(); im.onload = () => res(im); im.src = c.toDataURL('image/png'); });
      const pixels = (src, w, h) => new Promise((res) => { const im = new Image(); im.onload = () => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); x.drawImage(im, 0, 0); res(x.getImageData(0, 0, w, h).data); }; im.src = src; });
      const out = [];
      for (const [w, h] of [[900, 1200], [1600, 1000], [1080, 1080], [1080, 1920]]) {
        const im = await photo(w, h), base = await pixels(im.src, w, h);
        for (const layout of ['stack', 'row', 'grid', 'hero']) for (const position of ['top-left', 'top', 'right', 'bottom', 'bottom-right', 'center']) for (const n of [3, 8, 12]) for (const panel of [null, 'rgba(0,0,0,0.4)']) {
          const spec = { layout, position, panel, shadow: false, scale: 1.6, uppercase: true, title: 'Trail to stillness, a long headline', route: true, stats: stats.slice(0, n) };
          const got = await pixels(postCompose(im, spec, route), w, h);
          const band = Math.floor(Math.min(w, h) * 0.04);   // the drawing keeps a 5% margin; the outer 4% must stay untouched
          let bad = 0;
          for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) {
            if (x >= band && x < w - band && y >= band && y < h - band) continue;
            const i = (y * w + x) * 4; if (Math.abs(got[i] - base[i]) + Math.abs(got[i + 1] - base[i + 1]) + Math.abs(got[i + 2] - base[i + 2]) > 24) bad++;
          }
          out.push({ case: `${w}×${h} ${layout} ${position} ${n} stats${panel ? ' panel' : ''}`, bad });
        }
      }
      return out;
    }, { stats, route });
    const failed = result.filter((r) => r.bad > 0);
    check(result.length === 4 * 4 * 6 * 3 * 2, `${result.length} layouts drawn (4 photo shapes × 4 layouts × 6 positions × 3, 8 and 12 stats × with and without a panel)`);
    check(!failed.length, 'nothing is drawn in the outer margin' + (failed.length ? ': ' + failed.slice(0, 4).map((f) => `${f.case} (${f.bad} pixels)`).join('; ') : ''));
  } finally { await page.close(); }
} };
