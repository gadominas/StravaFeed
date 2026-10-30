// Screenshot scenario for Strava Daily Digest: invented sample data and the steps behind every card in the README.
// Regenerate: node app-blueprints/repo-site/tools/capture.js .   (see app-blueprints/repo-site/REBUILD.md)
//
// Every athlete, activity, comment and number below is invented. Avatars are drawn initials and the
// "photos" and route maps are drawn here as SVG, so nothing comes from Strava or from anyone's account.
// The app reads strava.com through a hidden WebView; every page and request it makes is answered by the
// routes below, shaped like what stravaLib() in the script parses (feed entries, activity pages, kudos).

'use strict';
const fs = require('fs');
const path = require('path');

// The script works out "today" with the phone's clock; run Node on the scenario's time zone too.
process.env.TZ = 'Europe/Vilnius';

const ROOT = path.join(__dirname, '..', '..');
const NOW = Date.UTC(2026, 9, 29, 17, 40);           // Thursday 29 October 2026, 19:40 in Vilnius (UTC+2)
const H = 3600e3, MIN = 60e3, DAY = 24 * H;
const DOCS = '/var/mobile/Library/Mobile Documents/iCloud~dk~simonbs~Scriptable/Documents';   // emu.paths.documents
const LOCAL = '/var/mobile/Containers/Data/Application/SCRIPTABLE/Documents';                // emu.paths.local
const ME = '1000001';
const MEDIA = 'https://media.digest.example';

// ───────── a seeded random, so every rebuild draws the same pictures ─────────
function rnd(seed) {
  let a = 0;
  for (const c of String(seed)) a = (a * 31 + c.charCodeAt(0)) | 0;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// ───────── drawn avatars: initials on a soft gradient ─────────
const AV_COLORS = [['#F472B6', '#FB923C'], ['#60A5FA', '#34D399'], ['#A78BFA', '#F472B6'], ['#FBBF24', '#F97316'], ['#2DD4BF', '#3B82F6'], ['#F87171', '#FBBF24'], ['#818CF8', '#22D3EE'], ['#34D399', '#A3E635'], ['#FB7185', '#A78BFA'], ['#38BDF8', '#818CF8']];
function avatarSVG(name, i) {
  const [c1, c2] = AV_COLORS[i % AV_COLORS.length];
  const ini = name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  return `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs><rect width="200" height="200" fill="url(#g)"/><text x="100" y="124" text-anchor="middle" font-family="Inter,Helvetica,Arial,sans-serif" font-size="72" font-weight="700" fill="#fff" fill-opacity=".95">${ini}</text></svg>`;
}

// ───────── drawn "photos": layered landscapes ─────────
function ridge(r, w, base, amp, step) {
  let d = `M0 ${base}`;
  for (let x = 0; x <= w + step; x += step) d += ` L${x} ${(base - r() * amp).toFixed(1)}`;
  return d + ` L${w} 900 L0 900 Z`;
}
function peaks(r, w, base, n, hMin, hMax) {
  let d = `M0 ${base}`, x = 0;
  const seg = w / n;
  for (let i = 0; i < n; i++) { const px = x + seg * (0.3 + r() * 0.4), py = base - hMin - r() * (hMax - hMin); d += ` L${px.toFixed(0)} ${py.toFixed(0)} L${(x + seg).toFixed(0)} ${(base - r() * 40).toFixed(0)}`; x += seg; }
  return d + ` L${w} 900 L0 900 Z`;
}
function trees(r, y0, y1, n, color, scale = 1) {
  let s = '';
  for (let i = 0; i < n; i++) {
    const x = r() * 1240 - 20, y = y0 + r() * (y1 - y0), h = (50 + r() * 60) * scale * (0.6 + (y - y0) / Math.max(1, y1 - y0) * 0.6), w = h * 0.42;
    s += `<path d="M${x.toFixed(0)} ${(y - h).toFixed(0)} L${(x + w / 2).toFixed(0)} ${y.toFixed(0)} L${(x - w / 2).toFixed(0)} ${y.toFixed(0)} Z" fill="${color}"/>`;
  }
  return s;
}
const SCENES = {
  // sunrise over a river (Marta)
  river(r) {
    return `<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3B2F6B"/><stop offset=".45" stop-color="#E86F6F"/><stop offset=".7" stop-color="#FDBA74"/></linearGradient>
      <linearGradient id="w" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#F59E7A"/><stop offset="1" stop-color="#3B2F6B"/></linearGradient>
      <radialGradient id="sun" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#FFF7D6"/><stop offset=".35" stop-color="#FDE68A" stop-opacity=".9"/><stop offset="1" stop-color="#FDBA74" stop-opacity="0"/></radialGradient></defs>
      <rect width="1200" height="900" fill="url(#s)"/><circle cx="760" cy="520" r="230" fill="url(#sun)"/><circle cx="760" cy="520" r="62" fill="#FFF7D6"/>
      <path d="${ridge(r, 1200, 560, 70, 80)}" fill="#8B5A8C" opacity=".75"/><path d="${ridge(r, 1200, 600, 50, 60)}" fill="#5B3F70"/>
      <rect y="600" width="1200" height="300" fill="url(#w)"/>
      ${Array.from({ length: 9 }, (_, i) => `<rect x="${700 - i * 6 + r() * 20}" y="${620 + i * 26}" width="${120 - i * 8}" height="6" rx="3" fill="#FFF3C4" opacity="${(0.8 - i * 0.07).toFixed(2)}"/>`).join('')}
      <path d="M0 900 L0 700 C200 690 320 760 420 900 Z" fill="#2E2147"/>${trees(r, 690, 760, 7, '#2E2147', 0.8).replace(/x="/g, 'x="')}`;
  },
  // misty bridge at dawn (Marta, 2nd)
  bridge(r) {
    return `<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7C9CC9"/><stop offset=".6" stop-color="#F3C6B8"/><stop offset="1" stop-color="#F8E1C8"/></linearGradient></defs>
      <rect width="1200" height="900" fill="url(#s)"/><circle cx="300" cy="380" r="54" fill="#FFF4DD" opacity=".9"/>
      <path d="${ridge(r, 1200, 520, 60, 90)}" fill="#A7A9C9" opacity=".7"/>
      <rect y="560" width="1200" height="340" fill="#C9B6C9"/><rect y="560" width="1200" height="340" fill="#8FA3C8" opacity=".45"/>
      <path d="M-20 600 Q600 380 1220 600" fill="none" stroke="#4B4468" stroke-width="22"/>
      ${Array.from({ length: 13 }, (_, i) => { const x = i * 100; const y = 600 - Math.sin(Math.PI * (x + 20) / 1240) * 205; return `<rect x="${x - 4}" y="${y.toFixed(0)}" width="8" height="${(600 - y + 4).toFixed(0)}" fill="#4B4468"/>`; }).join('')}
      <rect y="596" width="1200" height="18" fill="#4B4468"/><rect x="230" y="560" width="40" height="340" fill="#4B4468"/><rect x="930" y="560" width="40" height="340" fill="#4B4468"/>
      ${Array.from({ length: 6 }, (_, i) => `<rect x="${r() * 1100}" y="${660 + i * 38}" width="${80 + r() * 200}" height="4" rx="2" fill="#fff" opacity=".35"/>`).join('')}`;
  },
  // snow peaks at first light (Ines)
  alpine(r) {
    return `<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1E2A5A"/><stop offset=".55" stop-color="#7A6FB0"/><stop offset="1" stop-color="#F6B98E"/></linearGradient>
      <linearGradient id="m" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#F8E7E1"/><stop offset=".25" stop-color="#C9B3CF"/><stop offset="1" stop-color="#5B5F8F"/></linearGradient></defs>
      <rect width="1200" height="900" fill="url(#s)"/>${Array.from({ length: 30 }, () => `<circle cx="${(r() * 1200).toFixed(0)}" cy="${(r() * 260).toFixed(0)}" r="${(1 + r() * 2).toFixed(1)}" fill="#fff" opacity="${(0.3 + r() * 0.5).toFixed(2)}"/>`).join('')}
      <path d="${peaks(r, 1200, 640, 4, 260, 400)}" fill="url(#m)"/><path d="${peaks(r, 1200, 720, 5, 120, 220)}" fill="#3F3F6E"/>
      <path d="${ridge(r, 1200, 800, 40, 70)}" fill="#26284A"/>
      <path d="M560 900 C600 840 520 800 600 760 S700 720 660 690" fill="none" stroke="#E7C7A8" stroke-width="7" stroke-linecap="round" stroke-dasharray="2 16" opacity=".8"/>
      ${trees(r, 800, 900, 14, '#1A1B36', 1.1)}`;
  },
  // ridge trail (Ines, 2nd)
  ridge(r) {
    return `<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5DA9E9"/><stop offset="1" stop-color="#CFE8F7"/></linearGradient></defs>
      <rect width="1200" height="900" fill="url(#s)"/>${Array.from({ length: 4 }, () => { const x = r() * 1100, y = 80 + r() * 180; return `<ellipse cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" rx="${(90 + r() * 80).toFixed(0)}" ry="26" fill="#fff" opacity=".8"/>`; }).join('')}
      <path d="${peaks(r, 1200, 560, 3, 200, 330)}" fill="#8EA6C7"/><path d="${peaks(r, 1200, 640, 4, 120, 220)}" fill="#5F7C9E"/>
      <path d="M0 900 L0 640 C300 560 520 520 760 600 S1100 700 1200 660 L1200 900 Z" fill="#6D8B4E"/>
      <path d="M0 900 L0 760 C260 700 560 760 820 820 S1100 860 1200 840 L1200 900 Z" fill="#4E6B37"/>
      <path d="M120 900 C260 800 420 690 600 600 S900 560 1000 520" fill="none" stroke="#E9D9B6" stroke-width="12" stroke-linecap="round"/>
      ${trees(r, 760, 900, 10, '#2F4A23', 1.2)}`;
  },
  // valley lake (Ines, 3rd)
  lake(r) {
    return `<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FDB28A"/><stop offset="1" stop-color="#FDE1C2"/></linearGradient>
      <linearGradient id="w" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6E8FB3"/><stop offset="1" stop-color="#2E4766"/></linearGradient></defs>
      <rect width="1200" height="900" fill="url(#s)"/><circle cx="880" cy="300" r="48" fill="#FFF6E5"/>
      <path d="${peaks(r, 1200, 520, 3, 180, 300)}" fill="#7B6A8F"/><path d="${peaks(r, 1200, 560, 5, 60, 140)}" fill="#4F4A6E"/>
      <rect y="560" width="1200" height="340" fill="url(#w)"/>
      ${Array.from({ length: 8 }, (_, i) => `<rect x="${830 + r() * 40 - i * 4}" y="${580 + i * 30}" width="${100 - i * 9}" height="5" rx="2.5" fill="#FFE6C9" opacity="${(0.75 - i * 0.08).toFixed(2)}"/>`).join('')}
      ${trees(r, 600, 900, 9, '#1F2B3E', 1.4).replace(/M(\d+)/g, (m, x) => 'M' + (+x < 600 ? x : +x - 600))}`;
  },
  // coastal road at golden hour (Jonas)
  coast(r) {
    return `<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#F59E0B"/><stop offset=".6" stop-color="#FDD9A0"/><stop offset="1" stop-color="#FDE7C3"/></linearGradient>
      <linearGradient id="w" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3B82A6"/><stop offset="1" stop-color="#1E4E6E"/></linearGradient></defs>
      <rect width="1200" height="900" fill="url(#s)"/><circle cx="380" cy="430" r="70" fill="#FFF3D1"/>
      <rect y="470" width="1200" height="430" fill="url(#w)"/>
      ${Array.from({ length: 10 }, (_, i) => `<rect x="${330 + r() * 30 - i * 5}" y="${480 + i * 22}" width="${110 - i * 9}" height="5" rx="2.5" fill="#FFE7B0" opacity="${(0.8 - i * 0.07).toFixed(2)}"/>`).join('')}
      <path d="M1200 900 L1200 380 C1080 390 980 440 900 520 C840 580 760 640 700 900 Z" fill="#7C5B3B"/>
      <path d="M1200 900 L1200 470 C1090 480 1010 540 960 600 C900 680 860 760 840 900 Z" fill="#5B7F3A"/>
      <path d="M1200 560 C1060 600 990 690 950 900" fill="none" stroke="#3A3A40" stroke-width="46"/>
      <path d="M1200 560 C1060 600 990 690 950 900" fill="none" stroke="#F5F0E1" stroke-width="3" stroke-dasharray="26 22"/>`;
  },
  // seaside cliffs (Jonas, 2nd)
  cliffs(r) {
    return `<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#93C5FD"/><stop offset="1" stop-color="#E0F2FE"/></linearGradient></defs>
      <rect width="1200" height="900" fill="url(#s)"/>${Array.from({ length: 3 }, () => `<ellipse cx="${(r() * 1200).toFixed(0)}" cy="${(90 + r() * 150).toFixed(0)}" rx="${(120 + r() * 90).toFixed(0)}" ry="30" fill="#fff" opacity=".85"/>`).join('')}
      <rect y="430" width="1200" height="470" fill="#2C7DA0"/><rect y="430" width="1200" height="14" fill="#A9D6E5" opacity=".7"/>
      <path d="M0 900 L0 300 C120 320 200 360 260 430 L330 520 C380 600 420 700 470 900 Z" fill="#C2A27A"/>
      <path d="M0 330 C120 340 200 380 250 430 L0 440 Z" fill="#6A994E"/>
      ${Array.from({ length: 12 }, () => `<path d="M${(500 + r() * 700).toFixed(0)} ${(470 + r() * 400).toFixed(0)} q20 -10 40 0" fill="none" stroke="#E0F7FF" stroke-width="4" opacity=".7"/>`).join('')}`;
  },
  // park path at sunrise (Priya)
  park(r) {
    return `<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FCA5A5"/><stop offset=".5" stop-color="#FDE68A"/><stop offset="1" stop-color="#FEF3C7"/></linearGradient></defs>
      <rect width="1200" height="900" fill="url(#s)"/><circle cx="600" cy="470" r="80" fill="#FFFBEB" opacity=".95"/>
      <path d="${ridge(r, 1200, 520, 40, 60)}" fill="#86A873" opacity=".8"/>
      <rect y="520" width="1200" height="380" fill="#7DA35E"/>
      <path d="M520 520 L680 520 L1000 900 L200 900 Z" fill="#D6C3A3"/><path d="M596 520 L604 520 L620 900 L580 900 Z" fill="#fff" opacity=".6"/>
      ${trees(r, 520, 900, 7, '#3F6B3A', 2.2).split('</path>').join('').replace(/<path d="M(\d+)/g, (m, x) => '<path d="M' + (+x > 450 && +x < 750 ? (+x < 600 ? +x - 330 : +x + 330) : x))}`;
  },
  // autumn forest hills (Elena)
  forest(r) {
    const cols = ['#C2410C', '#EA580C', '#F59E0B', '#B45309', '#65A30D', '#9A3412'];
    let blobs = '';
    for (let i = 0; i < 70; i++) { const x = r() * 1200, y = 430 + r() * 470, s = 30 + r() * 50 * (1 + (y - 430) / 470); blobs += `<circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${s.toFixed(0)}" fill="${cols[Math.floor(r() * cols.length)]}" opacity=".95"/>`; }
    return `<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#BFDBFE"/><stop offset="1" stop-color="#FEF9C3"/></linearGradient></defs>
      <rect width="1200" height="900" fill="url(#s)"/><path d="${ridge(r, 1200, 440, 90, 100)}" fill="#A5B4C8"/><path d="${ridge(r, 1200, 500, 60, 80)}" fill="#7F8FA6"/>${blobs}
      <path d="M380 900 C460 780 640 720 700 560" fill="none" stroke="#F1E3C6" stroke-width="16" stroke-linecap="round"/>`;
  },
  // summit cairn (Elena, 2nd)
  summit(r) {
    return `<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#60A5FA"/><stop offset="1" stop-color="#DBEAFE"/></linearGradient></defs>
      <rect width="1200" height="900" fill="url(#s)"/>
      <path d="${ridge(r, 1200, 520, 60, 70)}" fill="#94A3B8"/><path d="${ridge(r, 1200, 580, 50, 60)}" fill="#64748B"/>
      <path d="M0 900 L0 700 C300 620 600 600 900 640 S1200 720 1200 720 L1200 900 Z" fill="#A16207"/>
      <path d="M0 900 L0 780 C300 740 700 760 1200 820 L1200 900 Z" fill="#854D0E"/>
      ${[0, 1, 2, 3, 4].map((i) => `<ellipse cx="${600 + (i % 2) * 6}" cy="${640 - i * 34}" rx="${70 - i * 12}" ry="20" fill="${['#78716C', '#A8A29E', '#57534E', '#A8A29E', '#78716C'][i]}"/>`).join('')}`;
  },
};
function photoSVG(scene, seed) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900" viewBox="0 0 1200 900">${SCENES[scene](rnd(seed))}</svg>`;
}

// ───────── drawn route maps ─────────
function mapSVG(seed, loop) {
  const r = rnd(seed);
  let roads = '';
  for (let i = 0; i < 9; i++) { const y = 40 + r() * 520; roads += `<path d="M-10 ${y.toFixed(0)} C300 ${(y + r() * 80 - 40).toFixed(0)} 700 ${(y + r() * 80 - 40).toFixed(0)} 1210 ${(y + r() * 60 - 30).toFixed(0)}" fill="none" stroke="#fff" stroke-width="${(4 + r() * 6).toFixed(0)}"/>`; }
  for (let i = 0; i < 9; i++) { const x = 60 + r() * 1080; roads += `<path d="M${x.toFixed(0)} -10 C${(x + r() * 80 - 40).toFixed(0)} 200 ${(x + r() * 80 - 40).toFixed(0)} 400 ${(x + r() * 60 - 30).toFixed(0)} 610" fill="none" stroke="#fff" stroke-width="${(3 + r() * 5).toFixed(0)}"/>`; }
  const parks = Array.from({ length: 4 }, () => `<ellipse cx="${(r() * 1200).toFixed(0)}" cy="${(r() * 600).toFixed(0)}" rx="${(80 + r() * 120).toFixed(0)}" ry="${(50 + r() * 80).toFixed(0)}" fill="#CDE8C4"/>`).join('');
  const pts = [];
  const n = 9;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    if (loop) { const a = t * Math.PI * 2; pts.push([600 + Math.cos(a) * (330 + r() * 90), 300 + Math.sin(a) * (170 + r() * 50)]); }
    else pts.push([140 + t * 920 + (r() * 60 - 30), 470 - t * 330 + (r() * 110 - 55)]);
  }
  let d = `M${pts[0][0].toFixed(0)} ${pts[0][1].toFixed(0)}`;
  for (let i = 1; i < pts.length; i++) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]; d += ` Q${x0.toFixed(0)} ${y1.toFixed(0)} ${((x0 + x1) / 2).toFixed(0)} ${((y0 + y1) / 2).toFixed(0)} T${x1.toFixed(0)} ${y1.toFixed(0)}`; }
  const [sx, sy] = pts[0], [ex, ey] = pts[pts.length - 1];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="600" viewBox="0 0 1200 600"><rect width="1200" height="600" fill="#ECE8E1"/>${parks}
    <path d="M-10 520 C300 470 500 600 820 540 S1100 470 1210 500 L1210 610 L-10 610 Z" fill="#BFD9EA"/>${roads}
    <path d="${d}" fill="none" stroke="#fff" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="${d}" fill="none" stroke="#FC4C02" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="${sx.toFixed(0)}" cy="${sy.toFixed(0)}" r="13" fill="#22C55E" stroke="#fff" stroke-width="5"/>
    <circle cx="${ex.toFixed(0)}" cy="${ey.toFixed(0)}" r="13" fill="#EF4444" stroke="#fff" stroke-width="5"/></svg>`;
}

// ───────── the people and their day (all invented) ─────────
// Times are local (Vilnius, UTC+2). d: 0 = today, -1 = yesterday.
const PEOPLE = {
  2000101: 'Jonas Petrauskas', 2000102: 'Tomas Berg', 2000103: 'Ada Novak', 2000104: 'Priya Shah', 2000105: 'Marta Kowal',
  2000106: 'Ines Laurent', 2000107: 'Rui Costa', 2000108: 'Elena Duarte', [ME]: 'Sam Rivers',
  2000109: 'Leo Brandt', 2000110: 'Nora Vik', 2000111: 'Kai Moreno', 2000112: 'Hana Ito', 2000113: 'Felix Stone', 2000114: 'Maya Lund',
};
const PIDS = Object.keys(PEOPLE);
const avatarURL = (id) => `${MEDIA}/pictures/athletes/${id}.svg`;
const stats = (...pairs) => pairs.flatMap(([label, value], i) => [{ key: 'stat_' + i, value }, { key: 'stat_' + i + '_subtitle', value: label }]);

const ACTS = [
  { id: 9100101, who: 2000101, d: 0, at: [17, 25], name: 'Golden hour coast loop', type: 'Ride', loc: 'Harbour Point',
    stats: stats(['Distance', '42.6 km'], ['Elev Gain', '386 m'], ['Time', '1h 28m']), hr: [138, 171], kudos: 11, comments: 2,
    prs: 1, ach: [{ type: 'PR', name: 'Lighthouse Climb', rank: 1 }, { type: 'Top 10', name: 'Cliff Road Sprint', rank: 4 }],
    photos: [['coast', 'j1'], ['cliffs', 'j2']], map: true, desc: 'Tailwind all the way out, headwind all the way back. Worth it for that light.' },
  { id: 9100102, who: 2000102, d: 0, at: [7, 45], name: 'Commute in', type: 'Ride', loc: 'Old Town',
    stats: stats(['Distance', '8.2 km'], ['Elev Gain', '41 m'], ['Time', '24m 10s']), kudos: 3, comments: 0, map: true },
  { id: 9100103, who: 2000102, d: 0, at: [12, 30], name: 'Lunch tempo', type: 'Run', loc: 'Riverside',
    stats: stats(['Distance', '6.1 km'], ['Pace', '4:24 /km'], ['Time', '26m 50s']), hr: [161, 178], kudos: 7, comments: 1,
    prs: 1, ach: [{ type: 'PR', name: 'Riverside Mile', rank: 1 }], map: true },
  { id: 9100104, who: 2000102, d: 0, at: [16, 40], name: 'Easy swim', type: 'Swim', loc: 'City Pool',
    stats: stats(['Distance', '1,800 m'], ['Pace', '2:07 /100m'], ['Time', '38m 12s']), kudos: 4, comments: 0 },
  { id: 9100105, who: 2000103, d: 0, at: [15, 10], name: 'Leg day', type: 'WeightTraining', loc: '',
    stats: stats(['Time', '52m 04s']), hr: [118, 152], kudos: 6, comments: 1 },
  { id: 9100106, who: 2000104, d: 0, at: [6, 20], name: 'Park laps before work', type: 'Run', loc: 'Linden Park',
    stats: stats(['Distance', '8.0 km'], ['Pace', '5:05 /km'], ['Time', '40m 40s']), hr: [149, 166], kudos: 9, comments: 1,
    photos: [['park', 'p1']], map: true },
  { id: 9100107, who: 2000105, d: 0, at: [5, 12], name: 'Sunrise river run', type: 'Run', loc: 'Riverside',
    stats: stats(['Distance', '12.4 km'], ['Pace', '4:38 /km'], ['Time', '57m 31s'], ['Elev Gain', '64 m']), hr: [156, 181], kudos: 18, comments: 4,
    prs: 2, ach: [{ type: 'PR', name: 'Bridge to Bridge', rank: 1 }, { type: 'PR', name: 'Embankment 5K', rank: 1 }, { type: '3rd', name: 'Mill Lane', rank: 3 }],
    photos: [['river', 'm1'], ['bridge', 'm2']], map: true, desc: 'Alarm at 4:40. No regrets. The river was on fire.' },
  { id: 9100108, who: 2000106, d: 0, at: [4, 48], name: 'Headlamp to summit', type: 'TrailRun', loc: 'Pine Ridge',
    stats: stats(['Distance', '21.3 km'], ['Elev Gain', '1,140 m'], ['Time', '2h 46m']), hr: [147, 176], kudos: 24, comments: 5,
    ach: [{ type: 'Top 10', name: 'Ridge Ascent', rank: 6 }, { type: '2nd', name: 'Saddle Descent', rank: 2 }, { type: 'Local Legend', name: 'Pine Ridge Loop' }],
    photos: [['alpine', 'i1'], ['ridge', 'i2'], ['lake', 'i3']], map: true, desc: 'Started in the dark, topped out as the sun came up. Legs are toast.' },
  { id: 9100109, who: 2000107, d: 0, at: [13, 5], name: 'Afternoon run', type: 'Run', loc: 'Old Town',
    stats: stats(['Distance', '10.0 km'], ['Pace', '5:12 /km'], ['Time', '52m 03s']), hr: [144, 160], kudos: 8, comments: 0, kudoed: true, map: true },
  { id: 9100110, who: 2000108, d: 0, at: [9, 30], name: 'Autumn colours hike', type: 'Hike', loc: 'Maple Hills',
    stats: stats(['Distance', '14.2 km'], ['Elev Gain', '620 m'], ['Time', '3h 41m']), kudos: 15, comments: 3, kudoed: true,
    photos: [['forest', 'e1'], ['summit', 'e2']], map: true },
  // yesterday, so the Yesterday tab and the feed position look real
  { id: 9100111, who: 2000105, d: -1, at: [18, 5], name: 'Shakeout', type: 'Run', loc: 'Riverside',
    stats: stats(['Distance', '5.1 km'], ['Pace', '5:52 /km'], ['Time', '29m 56s']), kudos: 6, comments: 0, kudoed: true },
  { id: 9100112, who: 2000101, d: -1, at: [7, 10], name: 'Hill reps', type: 'Ride', loc: 'Harbour Point',
    stats: stats(['Distance', '31.5 km'], ['Elev Gain', '520 m'], ['Time', '1h 12m']), kudos: 9, comments: 1, kudoed: true },
  // you: the strip on top
  { id: 9100901, who: ME, d: 0, at: [6, 42], name: 'Morning Run', type: 'Run', loc: 'Old Town',
    stats: stats(['Distance', '8.1 km'], ['Pace', '4:57 /km'], ['Time', '40m 05s']), kudos: 14, comments: 3 },
  { id: 9100902, who: ME, d: -1, at: [18, 30], name: 'Evening Ride', type: 'Ride', loc: 'Harbour Point',
    stats: stats(['Distance', '31.2 km'], ['Elev Gain', '210 m'], ['Time', '1h 04m']), kudos: 9, comments: 1 },
];
const pad = (n) => String(n).padStart(2, '0');
const startOf = (a) => Date.UTC(2026, 9, 29 + a.d, a.at[0] - 2, a.at[1]);
const localOf = (a) => `2026-10-${pad(29 + a.d)}T${pad(a.at[0])}:${pad(a.at[1])}:00`;
const clock12 = (h, m) => `${h % 12 || 12}:${pad(m)} ${h < 12 ? 'AM' : 'PM'}`;

// One feed entry, shaped like Strava's web feed (/dashboard/feed?feed_type=following): what SD.normalize reads.
function entry(a) {
  const start = startOf(a);
  const act = {
    id: a.id, activityName: a.name, type: a.type, startDate: new Date(start).toISOString(), startDateLocal: localOf(a),
    timeAndLocation: { displayDateAtTime: (a.d === 0 ? 'Today' : 'Yesterday') + ' at ' + clock12(a.at[0], a.at[1]), location: a.loc },
    athlete: { athleteId: String(a.who), athleteName: PEOPLE[a.who], avatarUrl: avatarURL(a.who) },
    kudosAndComments: { kudosCount: a.kudos, commentCount: a.comments, hasKudoed: !!a.kudoed, canKudo: String(a.who) !== ME },
    stats: a.stats,
    description: a.desc || '',
    mapAndPhotos: {
      activityMap: a.map ? { url: `${MEDIA}/maps/${a.id}.png` } : null,
      photoList: (a.photos || []).map(([scene, seed]) => ({ large: `${MEDIA}/photos/${scene}-${seed}.jpg` })),
    },
  };
  if (a.ach) { act.achievements = a.ach; act.achievementsCount = a.ach.length; }
  if (a.prs) act.prCount = a.prs;
  return { activity: act, cursorData: { updated_at: Math.floor(start / 1000) + 600, rank: Math.floor(start / 1000) + 600 } };
}
function feedPage() {
  const list = ACTS.slice().sort((x, y) => startOf(y) - startOf(x));
  return { entries: list.map(entry), pagination: { hasMore: false } };
}
// The activity page: SD.details reads __NEXT_DATA__ for heart rate and the local start time.
function activityPage(id) {
  const a = ACTS.find((x) => String(x.id) === String(id));
  const data = { props: { pageProps: { activity: a ? { id: a.id, startDateLocal: localOf(a), averageHeartrate: a.hr ? a.hr[0] : null, maxHeartrate: a.hr ? a.hr[1] : null } : {} } } };
  return `<!doctype html><html><head><meta name="csrf-token" content="demo-csrf"><title>Activity | Strava</title></head><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script></body></html>`;
}

// Who gave kudos and the comments on your own activities (SD.social).
const person = (id) => { const [first, ...rest] = PEOPLE[id].split(' '); return { id: Number(id), firstname: first, lastname: rest.join(' '), profile_medium: avatarURL(id) }; };
const KUDOERS = [2000105, 2000106, 2000102, 2000108, 2000110, 2000104, 2000109, 2000111, 2000112, 2000113, 2000107, 2000114];
const MY_COMMENTS = {
  9100901: [
    { id: 71, who: 2000105, text: 'Sub 5 pace before breakfast, the river path suits you!', ago: 9.5 * H, likes: 1, liked: true },
    { id: 72, who: 2000110, text: 'Saw you on the bridge, you were flying. Same time next week?', ago: 8 * H, likes: 0 },
    { id: 73, who: 2000106, text: 'Solid. Now come to the hills with me on Saturday 😄', ago: 3 * H, likes: 0 },
  ],
  9100902: [{ id: 74, who: 2000101, text: 'Nice negative split on the way home.', ago: 24 * H, likes: 1, liked: true }],
};

// ───────── AI: fixed replies ─────────
const IDEAS = {
  Marta: [
    'Out the door before the sun had even laced up, Marta, and two PRs to show for it, which is frankly cracking stuff.',
    'As the saying goes, the early bird catches the worm, but you seem to have caught two personal records and a sunrise as well.',
    'Beating the dawn and your own best times before breakfast is the sort of dedication that makes the rest of us hit snooze in shame.',
  ],
};
function aiReply(req) {
  const body = req.json() || {};
  const sys = String(body.system || '');
  let text = 'OK';
  if (/Strava activity/.test(sys)) {
    let facts = {}; try { facts = JSON.parse(body.messages[0].content); } catch (e) {}
    const name = facts.friend_first_name || 'Marta';
    text = JSON.stringify({ comments: IDEAS[name] || IDEAS.Marta.map((c) => c.replace(/Marta/g, name)) });
  }
  return { json: { id: 'msg_demo', type: 'message', role: 'assistant', model: body.model, content: [{ type: 'text', text }], usage: { input_tokens: 1184, output_tokens: 112 } } };
}

// Token usage for AI settings: about two weeks of comment ideas.
function usageFile() {
  const r = rnd('usage');
  const P = { calls: 0, in: 0, out: 0, models: {}, features: {}, days: {} };
  const add = (o, k, c, i, x) => { const b = o[k] = o[k] || { calls: 0, in: 0, out: 0 }; b.calls += c; b.in += i; b.out += x; };
  const day = (t) => { const d = new Date(t + 2 * H); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; };
  for (let i = 16; i >= 0; i--) {
    if (r() < 0.25 && i) continue;
    const calls = 1 + Math.floor(r() * 5), tin = calls * (1050 + Math.floor(r() * 300)), tout = calls * (90 + Math.floor(r() * 40));
    const k = day(NOW - i * DAY);
    add(P.days, k, calls, tin, tout); add(P.models, 'claude-haiku-5-5', calls, tin, tout); add(P.features, 'comments', calls, tin, tout);
    P.calls += calls; P.in += tin; P.out += tout;
  }
  const extra = [['style', 1, 4120, 260, 6], ['test', 2, 38, 4, 12]];
  for (const [f, c, i, x, ago] of extra) { const k = day(NOW - ago * DAY); add(P.days, k, c, i, x); add(P.models, 'claude-haiku-5-5', c, i, x); add(P.features, f, c, i, x); P.calls += c; P.in += i; P.out += x; }
  return { since: NOW - 40 * DAY, p: { anthropic: P } };
}

// ───────── releases: the repository's own, plus a newer one only for the update sheet ─────────
const RELEASES = JSON.parse(fs.readFileSync(path.join(ROOT, 'releases.json'), 'utf8'));
function releasesWithUpdate() {
  const r = RELEASES.releases;
  const pick = (v, i) => r.find((x) => x.version === v).highlights[i];
  return Object.assign({}, RELEASES, { releases: [{
    version: '1.16.0', date: '2026-10-29', title: 'Comments that sound like you',
    highlights: [pick('1.15.0', 1), pick('1.15.0', 2), pick('1.14.0', 0)], changes: [], fixes: [],
  }].concat(r) });
}

// ───────── a DateFormatter that understands the formats the script uses ─────────
function makeDateFormatter(FD) {
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return class DateFormatter {
    constructor() { this.dateFormat = 'yyyy-MM-dd'; this.locale = 'en_US'; }
    useShortDateStyle() {} useMediumDateStyle() {} useLongDateStyle() {} useFullDateStyle() {} useNoDateStyle() {}
    useShortTimeStyle() {} useMediumTimeStyle() {} useLongTimeStyle() {} useNoTimeStyle() {} useFullTimeStyle() {}
    string(d) {
      return String(this.dateFormat).replace(/yyyy|EEEE|EEE|MMMM|MMM|MM|M|dd|d|HH|H|mm|ss/g, (t) => ({
        yyyy: d.getFullYear(), EEEE: DAYS[d.getDay()], EEE: DAYS[d.getDay()].slice(0, 3), MMMM: MONTHS[d.getMonth()], MMM: MONTHS[d.getMonth()].slice(0, 3),
        MM: pad(d.getMonth() + 1), M: d.getMonth() + 1, dd: pad(d.getDate()), d: d.getDate(), HH: pad(d.getHours()), H: d.getHours(), mm: pad(d.getMinutes()), ss: pad(d.getSeconds()),
      }[t]));
    }
    date(s) { const d = new FD(s); return isNaN(d) ? null : d; }
  };
}

// The emulator draws widget stacks without their `spacing` and collapses a text's edge spaces ("Daily " + "Digest").
// Before it renders, put the spacing in as fixed spacers and keep those spaces, as iOS does.
function widgetLayoutFix(emu) {
  const orig = emu.widgetHTML;
  emu.widgetHTML = function (family) {
    const fix = (n) => {
      if (!n || !n.children) return;
      n.children.forEach(fix);
      n.children.forEach((c) => { if (c.kind === 'text') c.text = c.text.replace(/^ +| +$/g, (m) => '\u00a0'.repeat(m.length)); });
      if (n.spacing && n.children.length > 1) n.children = n.children.flatMap((c, i) => (i ? [{ kind: 'spacer', len: n.spacing, children: [] }, c] : [c]));
    };
    fix(this.widget);
    return orig.call(this, family);
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LEARNED_STYLE = [
  'Keep it to one short sentence, two at most.',
  'Use the friend\'s first name early in the sentence.',
  'Dry, warm humour; tease the effort, never the person.',
  'Favourite words: "cracking", "proper", "legend".',
  'Mention early starts and big climbs; skip exact numbers.',
  'No hashtags, no dashes, one emoji at most and usually none.',
].join('\n');

module.exports = {
  app: { name: 'Strava Daily Digest', script: 'Strava Daily Digest.js', accent: '#FB7185' },   // WIDGET.accent
  now: NOW,
  locale: 'en_US', timezone: 'Europe/Vilnius',
  settle: 2900,

  fixtures: (shot) => {
    const settings = {
      includeMe: false, enrich: true, widgetNames: true, checkUpdates: true,
      theme: 'auto', density: shot.density || 'comfortable', font: 'sans', textSize: 1,
      aiLang: 'English', aiMode: 'mystyle',
      styleProfile: LEARNED_STYLE, styleMeta: { at: NOW - 3 * DAY, count: 18, read: 214, scanned: 61 },
      cfg: {},
    };
    const files = {
      [`${DOCS}/StravaFeed/settings.json`]: settings,
      [`${LOCAL}/strava-digest-ai-settings.json`]: { aiProvider: 'anthropic', ai: true, models: { anthropic: { at: NOW - 3 * H, list: [
        { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5' }, { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5' }, { id: 'claude-opus-5-5', name: 'Claude Opus 5.5' }] } } },
      [`${LOCAL}/strava-digest-usage.json`]: usageFile(),
      // What the digest saved for the widget the last time it loaded today (saveSnapshot).
      [`${LOCAL}/stravafeed-widget.json`]: {
        date: '2026-10-29', waiting: 6, people: 8, prs: 4, early: 3, at: NOW - 35 * MIN,
        list: [
          { name: 'Jonas', icon: '🚴', early: '', n: 1 }, { name: 'Tomas', icon: '🏃', early: '', n: 3 }, { name: 'Ada', icon: '🏋️', early: '', n: 1 },
          { name: 'Priya', icon: '🏃', early: '🌅', n: 1 }, { name: 'Marta', icon: '🏃', early: '🌙', n: 1 }, { name: 'Ines', icon: '⛰️', early: '🦉', n: 1 },
        ],
      },
    };
    const feedDelay = shot.feedDelay || 0;
    return {
      files,
      keychain: {
        'strava-digest-athlete-id': ME,                               // remembered athlete: straight to the feed, no login page
        STRAVA_DIGEST_ANTHROPIC_KEY: 'sk-ant-demo-0000000000001234',  // fake
      },
      routes: [
        // the update check and the widget's logo tile
        { match: /raw\.githubusercontent\.com\/gadominas\/StravaFeed\/main\/releases\.json/, respond: { json: shot.update ? releasesWithUpdate() : RELEASES } },
        { match: /docs\/icon-1024\.png/, respond: { file: path.join(ROOT, 'docs', 'icon-1024.png') } },
        // AI
        { match: 'api.anthropic.com/v1/messages', respond: aiReply },
        // drawn pictures
        { match: /media\.digest\.example\/pictures\/athletes\/(\d+)\.svg/, respond: (req) => { const id = /athletes\/(\d+)/.exec(req.url)[1]; return { body: avatarSVG(PEOPLE[id] || '?', PIDS.indexOf(id)), contentType: 'image/svg+xml' }; } },
        { match: /media\.digest\.example\/photos\/(\w+)-(\w+)\.jpg/, respond: (req) => { const m = /photos\/(\w+)-(\w+)\.jpg/.exec(req.url); return { body: photoSVG(m[1], m[2]), contentType: 'image/svg+xml' }; } },
        { match: /media\.digest\.example\/maps\/(\d+)\.png/, respond: (req) => { const id = /maps\/(\d+)/.exec(req.url)[1]; const a = ACTS.find((x) => String(x.id) === id) || {}; return { body: mapSVG(id, /Ride|Swim/.test(a.type) ? false : true), contentType: 'image/svg+xml' }; } },
        // strava.com, as the hidden WebView sees it
        { match: /strava\.com\/robots\.txt/, respond: { body: 'User-agent: *\nDisallow:\n', contentType: 'text/plain' } },
        { match: /strava\.com\/dashboard\/feed\?/, respond: async () => { if (feedDelay) await sleep(feedDelay); return { json: feedPage() }; } },
        { match: /strava\.com\/feed\/activity\/\d+\/kudo$/, respond: async () => { await sleep(120); return { json: {} }; } },
        { match: /strava\.com\/feed\/activity\/(\d+)\/kudos/, respond: (req) => { const id = /activity\/(\d+)/.exec(req.url)[1]; const a = ACTS.find((x) => String(x.id) === id) || { kudos: 0 }; return { json: { athletes: KUDOERS.slice(0, Math.min(a.kudos, KUDOERS.length)).map(person) } }; } },
        { match: /strava\.com\/feed\/activity\/(\d+)\/comments/, respond: (req) => { const id = /activity\/(\d+)/.exec(req.url)[1];
          return { json: { comments: (MY_COMMENTS[id] || []).map((c) => ({ id: c.id, text: c.text, athlete: person(c.who), createdAt: new Date(NOW - c.ago).toISOString(), reactionCount: c.likes, hasReacted: !!c.liked })) } }; } },
        { match: /strava\.com\/activities\/(\d+)(\?|$)/, respond: (req) => activityPage(/activities\/(\d+)/.exec(req.url)[1]) },
        { match: /strava\.com\/(settings\/profile|dashboard|athlete\/training)/, respond: `<!doctype html><html><head><meta name="csrf-token" content="demo-csrf"></head><body><a href="/athletes/${ME}">You</a></body></html>` },
      ],
      globals: (ctx, emu) => { widgetLayoutFix(emu); return { DateFormatter: makeDateFormatter(ctx.Date) }; },
    };
  },

  shots: [
    { id: '01-daily-digest', label: 'One page per day', caption: 'Everyone you follow, once, with the day’s activities, stats and photos.' },
    { id: '02-kudos-to-everyone', label: 'Kudos to everyone', caption: 'Two taps give each person one kudos, with a little celebration.',
      run: async (h) => { await h.tap('.allk', { after: 350 }); await h.tap('.allk', { after: 0 }); await h.wait(3300); }, after: 0 },
    { id: '03-ai-comment-ideas', label: 'AI comment ideas', caption: 'Three ideas from the real stats, written in ✨ My style.',
      run: async (h) => {
        await h.tap('.act[data-id="9100107"] [data-act="toggle-comment"]', { after: 600 });
        await h.tap('#csheet [data-suggest]', { after: 1200 });
        await h.tap('#csheet .sug', { after: 300 });
        await h.eval(() => { if (document.activeElement) document.activeElement.blur(); });
      } },
    { id: '04-one-kudos-per-person', label: 'One kudos per person', caption: 'Three activities, one kudos: the main one is picked for you.',
      run: async (h) => { await h.scrollTo('section.person[data-pid="2000102"]', 118); } },
    { id: '05-early-riser-badges', label: 'Early-riser badges', caption: 'The 4 AM, 5 AM and 6 AM clubs get a badge and a daily count.',
      run: async (h) => { await h.scrollTo('section.person[data-pid="2000106"]', 118); } },
    { id: '06-photo-viewer', label: 'Full-screen photos', caption: 'Swipe through photos, pinch to zoom, then back to the digest.',
      run: async (h) => { await h.tap('.act[data-id="9100108"] img[data-photo]', { after: 800 }); } },
    { id: '07-activity-details', label: 'Activity details', caption: 'Route map, every stat, PRs and photos without opening Strava.',
      run: async (h) => { await h.tap('.act[data-id="9100101"] .ttl', { after: 900 }); } },
    { id: '08-your-activities', label: 'Your activities on top', caption: 'See who gave you kudos and like comments, right in the digest.',
      run: async (h) => { await h.tap('.mt[data-mine="9100901"]', { after: 1000 }); } },
    { id: '09-launch-screen', label: 'Launch screen', caption: 'The route draws itself while the feed loads behind it.', settle: 1100, feedDelay: 4000 },
    { id: '10-settings', label: 'Settings', caption: 'Colours, layout, text size and the digest’s own choices.',
      run: async (h) => { await h.tap('[data-act="settings"]', { after: 900 }); } },
    { id: '11-ai-settings', label: 'AI settings', caption: 'Your own Claude or OpenAI key, any model, and the tokens used.',
      run: async (h) => { await h.tap('[data-act="settings"]', { after: 900 }); await h.tap('#cfgsheet [data-act="ai-open"]', { after: 900 }); await h.scrollEl('#aisheet', 115); } },
    { id: '12-update-offer', label: 'Update offer', caption: 'A new version shows its three best features; Later waits two days.', update: true, settle: 3600 },
    { id: '13-dark-mode', label: 'Dark mode', caption: 'Follows iOS; shown here in the one-line Tiny layout.', dark: true, density: 'tiny' },
    { id: '14-kudos-widget', label: 'Kudos widget', caption: 'Who is still waiting for your kudos today, on the Home Screen.', widget: 'medium' },
  ],
};
