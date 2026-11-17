#!/usr/bin/env node
/**
 * The GridCorsa website: static pages laid out like iracing.com's (a sticky bar with the sections, photo heroes,
 * feature blocks, card grids for the cars and circuits, a link-rich footer), written into the same folder as the
 * game, which lives under it at /play/. The cars and circuits come from the game's own data (cars.json, tracks.json
 * and each layout's centreline for its outline), so the site always shows what the game has.
 *
 *   node apps/web/build.mjs        (after the game's build: `pnpm build` runs both)
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const pub = path.join(root, 'apps/client/public');
const out = path.join(root, 'apps/client/dist/apex-ghost');
if (!existsSync(path.join(out, 'play', 'index.html'))) {
  console.error('Build the game first (pnpm --filter @apex/client build): dist/apex-ghost/play is missing.');
  process.exit(1);
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const hp = (kw) => Math.round(kw * 1.341);
const UI = '/play/assets/ui';
const photo = (shot, map) => `${UI}/photo_${shot}${map && map !== 'nurburgring' && map !== 'nordschleife' ? `_${map}` : ''}.webp`;
const carImg = (id) => `${UI}/cars/${id}.webp`;
const ICON = {
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M7 4.5v15l12-7.5z"/></svg>',
  arrow:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" d="M5 12h14M13 6l6 6-6 6"/></svg>',
};

/* ------------------------------------------------------------------------------------------------- data */
const cars = JSON.parse(readFileSync(path.join(pub, 'assets/cars.json'), 'utf8')).cars.filter((c) => c.role !== 'safety');
const trackIndex = JSON.parse(readFileSync(path.join(pub, 'assets/tracks.json'), 'utf8'));
const layouts = (Array.isArray(trackIndex) ? trackIndex : trackIndex.tracks).map((t) => ({ ...t }));

// the real steering locks (same list as the game: physics/steeringLock.ts)
const LOCKS = [
  [/porsche/, 800],
  [/ferrari_296_gt3/, 800],
  [/bmw_m4/, 516],
  [/mercedes_amg_gt3/, 640],
  [/mclaren/, 480],
  [/lamborghini/, 620],
  [/audi/, 720],
  [/vantage/, 640],
  [/lexus/, 640],
  [/mustang/, 516],
  [/corvette/, 560],
];
const lockOf = (id) => LOCKS.find(([re]) => re.test(id))?.[1] ?? 600;
const teamOf = (c) => (c.info?.team ?? c.manufacturer).split(/\s[(·:]/)[0].trim();
const slug = (s) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/** A layout's outline from its centreline, seen from above (as the game's lobby draws it). */
function outline(file) {
  const td = JSON.parse(readFileSync(path.join(pub, file.replace(/\?.*$/, '')), 'utf8'));
  const cl = td.centerline;
  const n = cl.length / 3;
  const step = Math.max(1, Math.floor(n / 700));
  let x0 = Infinity,
    x1 = -Infinity,
    z0 = Infinity,
    z1 = -Infinity;
  for (let i = 0; i < n; i += step) {
    x0 = Math.min(x0, cl[i * 3]);
    x1 = Math.max(x1, cl[i * 3]);
    z0 = Math.min(z0, cl[i * 3 + 2]);
    z1 = Math.max(z1, cl[i * 3 + 2]);
  }
  const size = Math.max(x1 - x0, z1 - z0) || 1;
  const pad = 6;
  const k = (100 - pad * 2) / size;
  const ox = pad + (100 - pad * 2 - (x1 - x0) * k) / 2;
  const oz = pad + (100 - pad * 2 - (z1 - z0) * k) / 2;
  const px = (i) => (ox + (cl[i * 3] - x0) * k).toFixed(1);
  const pz = (i) => (oz + (cl[i * 3 + 2] - z0) * k).toFixed(1);
  let d = `M${px(0)} ${pz(0)}`;
  for (let i = step; i < n; i += step) d += `L${px(i)} ${pz(i)}`;
  return `<svg class="outline" viewBox="0 0 100 100" aria-hidden="true"><path d="${d}Z"/><circle cx="${px(0)}" cy="${pz(0)}" r="2.6"/></svg>`;
}
for (const l of layouts) l.svg = outline(l.file);

/** The circuits (a circuit's layouts together), with what the site says about each. */
const CIRCUITS = [
  {
    id: 'spa',
    maps: ['spa'],
    name: 'Circuit de Spa-Francorchamps',
    short: 'Spa-Francorchamps',
    country: 'Belgium',
    place: 'Stavelot, in the Ardennes',
    intro:
      'Seven kilometres through the forests of the Ardennes, and the one every driver wants to master: down the hill from La Source, flat through Eau Rouge and Raidillon, the long Kemmel straight, Pouhon’s double left, Blanchimont at full speed and the Bus Stop chicane. Home of the Spa 24 Hours, the biggest GT3 race of the year.',
    corners: ['La Source', 'Eau Rouge – Raidillon', 'Les Combes', 'Pouhon', 'Blanchimont', 'Bus Stop'],
    guide: [
      [
        'La Source',
        'The slowest corner of the lap, a tight right-hand hairpin after the start. Brake hard in a straight line, turn in late and get the car straight early: the exit leads down the hill and up Eau Rouge.',
      ],
      [
        'Eau Rouge – Raidillon',
        'Left, right, left up a steep hill, flat in a GT3 in the dry. Stay smooth and keep the car on the ground through the compression; a lift costs you all the way to Les Combes.',
      ],
      ['Kemmel straight', 'Two kilometres uphill to Les Combes: the place to use the slipstream.'],
      [
        'Les Combes',
        'A right-left chicane at the end of the straight, the main overtaking place. Hard braking from top speed, an early apex on the right, then set up for the left.',
      ],
      ['Bruxelles', 'A long downhill right; brake while still straight, be patient with the throttle.'],
      ['Pouhon', 'A fast double-apex left, taken in one long arc. Commit to it early and carry the speed; it rewards a stable car.'],
      ['Campus – Stavelot', 'Fast rights through the valley. Stavelot opens up onto the long run to Blanchimont: the exit counts.'],
      ['Blanchimont', 'A very fast left, flat or nearly flat in a GT3. Keep a tidy line and do not touch the grass on the exit.'],
      ['Bus Stop', 'The chicane before the line: brake hard, cut across the kerbs as far as the limits allow, and get a clean exit for the line.'],
    ],
  },
  {
    id: 'nurburgring',
    maps: ['nurburgring', 'nordschleife'],
    name: 'Nürburgring',
    short: 'Nürburgring',
    country: 'Germany',
    place: 'Nürburg, in the Eifel',
    intro:
      'The modern Grand Prix circuit and, joined to it, the legendary Nordschleife: the 24-hour layout puts both together for more than 25 km of crests, compressions and blind corners through the Eifel forest. Race the GP layout, the short version without the Müllenbachschleife, or the full Gesamtstrecke.',
    corners: ['Yokohama-S', 'Mercedes-Arena', 'Dunlop-Kehre', 'Schumacher-S', 'NGK-Schikane', 'Nordschleife'],
    guide: [
      ['Turn 1', 'A long right-hand hairpin after the start-finish straight, a classic place to brake late and pass on the inside.'],
      ['Mercedes-Arena', 'The tight, twisting section after the first corner: patience and traction rather than speed.'],
      ['Dunlop-Kehre', 'The hairpin at the bottom of the hill: hard braking downhill, then a long climb out of it.'],
      ['Schumacher-S', 'Fast left and right uphill; a smooth line here sets up the back straight.'],
      ['The final chicane', 'Brake hard before the last corners; a clean exit onto the straight is worth more than a late braking point.'],
      [
        'Nordschleife (24h layout)',
        'More than 20 km of crests, jumps and blind corners through the forest. Learn it a section at a time; respect the compressions and keep the car straight over the crests.',
      ],
    ],
  },
  {
    id: 'zandvoort',
    maps: ['zandvoort'],
    name: 'Circuit Zandvoort',
    short: 'Zandvoort',
    country: 'Netherlands',
    place: 'Zandvoort, in the dunes by the North Sea',
    intro:
      'An old-school circuit rolling through the sand dunes on the North Sea coast, narrow and fast, with two steeply banked corners: the Hugenholtzbocht and the final Arie Luyendijkbocht that launches you onto the main straight towards Tarzan.',
    corners: ['Tarzanbocht', 'Hugenholtzbocht', 'Scheivlak', 'Hans Ernstbocht', 'Arie Luyendijkbocht'],
    guide: [
      [
        'Tarzanbocht',
        'A slightly banked right-hand hairpin at the end of the main straight, the best place to overtake. Several lines work: try the outside when the inside is taken.',
      ],
      ['Gerlachbocht', 'A quick left that leads into the banking; position the car on the right for it.'],
      [
        'Hugenholtzbocht',
        'The steeply banked left-hand hairpin. Use the banking: you can carry far more speed than a flat corner allows, and turn in lower than it looks.',
      ],
      ['Hunserug – Rob Slotemakerbocht', 'Over the crest and down through the dunes; the car goes light, so be gentle with the steering.'],
      ['Scheivlak', 'A fast downhill right, one of the bravest corners of the lap. Commit to it with a smooth arc.'],
      ['Hans Ernstbocht', 'A slow chicane late in the lap: brake hard and focus on the exit towards the final corners.'],
      ['Arie Luyendijkbocht', 'The banked final corner onto the main straight. Flat with the right line: your speed here lasts to Tarzan.'],
    ],
  },
];
for (const c of CIRCUITS) {
  c.layouts = layouts.filter((l) => c.maps.includes(l.map));
  c.main = c.layouts.find((l) => l.default) ?? c.layouts[0];
  c.photoMap = c.maps[0];
}

/* ------------------------------------------------------------------------------------------------- layout */
const NAV = [
  {
    label: 'About',
    href: '/about',
    sub: [
      ['/about', 'What is GridCorsa?', 'GT3 sim racing in a browser'],
      ['/about#history', 'History', 'From the first lap to today'],
      ['/builds', 'Release notes', 'Every update, newest first'],
      ['/press', 'Press kit', 'Fact sheet, screenshots, logo'],
    ],
  },
  {
    label: 'Cars & Tracks',
    href: '/cars',
    sub: [
      ['/cars', 'Cars', `${cars.length} GT3 race cars`],
      ['/tracks', 'Circuits', `${CIRCUITS.length} circuits, ${layouts.length} layouts`],
      ['/car-technology', 'Car technology', 'How the cars are modelled'],
      ['/track-technology', 'Track technology', 'How the circuits are built'],
      ['/car-setup', 'Car setup guide', 'Tyres, wing, brakes, suspension'],
    ],
  },
  {
    label: 'Features',
    href: '/features',
    sub: [
      ['/features', 'All features', 'Everything in the game'],
      ['/disciplines', 'Racing disciplines', 'Sprint, endurance, championship'],
      ['/online', 'Online racing', 'Rooms, quick match, friends'],
      ['/weather', 'Weather system', 'Rain, temperatures, time of day'],
      ['/ai-racing', 'AI racing', 'Bot levels and racecraft'],
      ['/spectating', 'Spectating & TV', 'Watch, TV cameras, ghost'],
      ['/licences', 'Licences & ratings', 'Safety Rating, levels, achievements'],
    ],
  },
  {
    label: 'News',
    href: '/news',
    sub: [
      ['/news', 'GridCorsa news', 'Announcements'],
      ['/builds', 'Release notes', 'What changed in every update'],
    ],
  },
  {
    label: 'Multimedia',
    href: '/media',
    sub: [
      ['/media', 'Screenshots', 'From the game'],
      ['/keyboard-shortcuts', 'Keyboard shortcuts', 'Every key and button'],
      ['/getting-started', 'Getting started', 'Your first race'],
      ['/driving-school', 'Driving school', 'How to drive fast'],
      ['/glossary', 'Glossary', 'The words of the paddock'],
    ],
  },
  {
    label: 'Account',
    href: '/account',
    sub: [
      ['/account', 'What comes with an account', 'Free, and what it gives you'],
      ['/getting-started#requirements', 'System requirements', 'What your computer needs'],
      ['/wheels-controllers', 'Wheels & controllers', 'Set up your hardware'],
      ['/getting-started', 'New racer guide', 'Your first race in minutes'],
      ['/sporting-code', 'Sporting code', 'Rules, flags and penalties'],
      ['/legal', 'Legal & privacy', 'Terms and your data'],
    ],
  },
  {
    label: 'Support',
    href: '/faq',
    sub: [
      ['/faq', 'FAQ', 'Common questions'],
      ['/troubleshooting', 'Troubleshooting', 'Performance, controls, connection'],
      ['/download', 'Download', 'Browser and Android'],
      ['/status', 'Service status', 'Is everything online?'],
    ],
  },
  {
    label: 'Live',
    href: '/live',
    sub: [
      ['/live', 'Live sessions', 'Public races right now'],
      ['/leaderboards', 'Leaderboards', 'Lap records on every layout'],
      ['/telemetry', 'Telemetry', 'Compare the best laps, metre by metre'],
      ['/drivers', 'Driver lookup', 'Any driver’s career and best laps'],
    ],
  },
];

/** Scroll motion hooks (site.js): reveals on headings, cards, steps and rows; the feature and circuit photos as
 * parallax layers that wipe in; circuit outlines that draw themselves. */
function motion(html) {
  return html
    .replace(
      /<div class="feat-img" style="--img:url\('([^']+)'\)"><\/div>/g,
      '<div class="feat-img rv-img"><i data-parallax="0.1" style="--img:url(\'$1\')"></i></div>',
    )
    .replace(
      /<a class="trk" href="([^"]+)" style="--img:url\('([^']+)'\)">/g,
      '<a class="trk rv draw" href="$1"><i data-parallax="0.06" style="--img:url(\'$2\')"></i>',
    )
    .replace(/class="sec-head"/g, 'class="sec-head rv"')
    .replace(/class="card"/g, 'class="card rv"')
    .replace(/class="step"/g, 'class="step rv"')
    .replace(/class="stats"/g, 'class="stats rv"')
    .replace(/class="callout"/g, 'class="callout rv"')
    .replace(/<details class="faq">/g, '<details class="faq rv">')
    .replace(/<div><span class="eyebrow">/g, '<div class="rv"><span class="eyebrow">')
    .replace(/<div class="bars">/g, '<div class="bars rv">');
}

function page({ file, title, desc, body, active = '' }) {
  body = motion(body);
  const nav = NAV.map(
    (n) =>
      `<li class="${n.label === active ? 'on' : ''}"><a href="${n.href}">${esc(n.label)}</a>${
        n.sub ? `<ul class="sub">${n.sub.map(([h, l, s]) => `<li><a href="${h}">${esc(l)}<small>${esc(s)}</small></a></li>`).join('')}</ul>` : ''
      }</li>`,
  ).join('');
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}" />
<meta name="theme-color" content="#070b16" />
<meta property="og:title" content="${esc(title)}" />
<meta property="og:description" content="${esc(desc)}" />
<meta property="og:image" content="${photo('hero', 'spa')}" />
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='6' fill='%23070b16'/%3E%3Cpath d='M8 23 L15 9 h9 l-7 14z' fill='%23e3183d'/%3E%3C/svg%3E" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@100..125,300..800&family=Inter:wght@400;500;600&display=swap" rel="stylesheet" />
<script>document.documentElement.classList.add('js')</script>
<link rel="stylesheet" href="/site/site.css" />
</head>
<body class="over-hero">
<div class="progress" aria-hidden="true"></div>
<a class="skip" href="#main">Skip to content</a>
<header class="site-head">
  <div class="util"><div class="wrap"><span>Free GT3 sim racing in your browser · no download</span><nav><a href="/live">Live sessions</a><a href="/leaderboards">Leaderboards</a><a href="/faq">Support</a><a href="/play/">Sign up</a><a href="/play/">Log in</a></nav></div></div>
  <div class="wrap bar">
    <a class="brand" href="/" aria-label="GridCorsa home">GRID<b>CORSA</b></a>
    <button class="burger" aria-label="Menu" aria-expanded="false"><svg viewBox="0 0 24 24"><path stroke="currentColor" stroke-width="2" d="M3 6h18M3 12h18M3 18h18"/></svg></button>
    <ul class="nav">${nav}</ul>
    <a class="btn btn-play" href="/play/">${ICON.play} Play now</a>
  </div>
</header>
<main id="main">
${body}
</main>
<footer class="site-foot">
  <div class="wrap">
    <div class="foot-grid">
      <div>
        <a class="brand" href="/">GRID<b>CORSA</b></a>
        <p style="margin-top:14px">GT3 sim racing in your browser: real cars, real circuits, real racing. Free to play, alone or online with friends.</p>
        <a class="btn btn-play" href="/play/">${ICON.play} Play now</a>
      </div>
      <div><h4>About</h4><ul><li><a href="/about">What is GridCorsa?</a></li><li><a href="/about#history">History</a></li><li><a href="/news">News</a></li><li><a href="/builds">Release notes</a></li><li><a href="/media">Screenshots</a></li></ul></div>
      <div><h4>Cars & Tracks</h4><ul><li><a href="/cars">Cars</a></li><li><a href="/tracks">Circuits</a></li><li><a href="/car-technology">Car technology</a></li><li><a href="/track-technology">Track technology</a></li><li><a href="/car-setup">Car setup guide</a></li></ul></div>
      <div><h4>Resources</h4><ul><li><a href="/getting-started">New racer guide</a></li><li><a href="/keyboard-shortcuts">Keyboard shortcuts</a></li><li><a href="/wheels-controllers">Wheels & controllers</a></li><li><a href="/sporting-code">Sporting code</a></li><li><a href="/troubleshooting">Troubleshooting</a></li></ul></div>
      <div><h4>Quick links</h4><ul><li><a href="/play/">Play in the browser</a></li><li><a href="/live">Live sessions</a></li><li><a href="/leaderboards">Leaderboards</a></li><li><a href="/account">Create an account</a></li><li><a href="/download">Android app</a></li></ul></div>
    </div>
    <div class="legal">
      <p>© 2026 GridCorsa. Car makes, models and liveries, team names and circuit names belong to their owners; they are used only to identify the real cars and places the game recreates. GridCorsa is an independent game and is not affiliated with or endorsed by them.</p>
      <p><a href="/legal">Legal & privacy</a> · <a href="/faq">Help & support</a></p>
    </div>
  </div>
</footer>
<script src="/site/site.js" defer></script>
</body>
</html>
`;
  const dest = path.join(out, file);
  mkdirSync(path.dirname(dest), { recursive: true });
  writeFileSync(dest, html);
}

const hero = ({ img, eyebrow, title, lead, ctas = '', badges = [], short = false }) => `
<section class="hero${short ? ' short' : ''}">
  <div class="hero-img" data-parallax="-0.25" style="--img:url('${img}')"></div>
  <div class="hero-in">
    ${eyebrow ? `<span class="eyebrow">${esc(eyebrow)}</span>` : ''}
    <h1>${String(title)
      .split(' | ')
      .map((l, i) => `<span class="line" style="--i:${i}"><span>${l}</span></span>`)
      .join('')}</h1>
    ${lead ? `<p class="lead">${lead}</p>` : ''}
    ${ctas ? `<div class="cta-row">${ctas}</div>` : ''}
    ${badges.length ? `<div class="badges">${badges.map((b) => `<span>${esc(b)}</span>`).join('')}</div>` : ''}
  </div>
  ${short ? '' : '<div class="scroll-cue" aria-hidden="true"><i></i>Scroll</div>'}
</section>`;
const playBtn = (label = 'Play free now') => `<a class="btn btn-play" href="/play/">${ICON.play} ${esc(label)}</a>`;
const btn = (href, label, cls = 'btn-ghost') => `<a class="btn ${cls}" href="${href}">${esc(label)} ${ICON.arrow}</a>`;
const carCard = (c) => `
<a class="card" href="/cars/${c.id}" data-make="${esc(c.manufacturer)}" data-text="${esc(`${c.name} ${c.manufacturer} ${c.info?.team ?? ''}`.toLowerCase())}">
  <div class="card-img car"><img src="${carImg(c.id)}" alt="${esc(c.name)}" loading="lazy" /></div>
  <div class="card-body">
    <h3>${esc(c.name)}</h3>
    <p>${esc(teamOf(c))}</p>
    <div class="meta"><span class="tag gt3">${esc(c.category)}</span><span class="tag">${hp(c.specs.powerKw)} hp</span><span class="tag">${c.specs.massKg} kg</span>${c.year ? `<span class="tag">${c.year}</span>` : ''}</div>
  </div>
</a>`;
const circuitCard = (c) => `
<a class="trk" href="/tracks/${c.id}" style="--img:url('${photo('aerial', c.photoMap)}')">
  ${c.main.svg}
  <span class="tag red">${esc(c.country)}</span>
  <h3>${esc(c.short)}</h3>
  <p>${c.layouts.length} layout${c.layouts.length > 1 ? 's' : ''} · ${(c.main.length / 1000).toFixed(2)} km${c.main.turns ? ` · ${c.main.turns} turns` : ''}</p>
</a>`;

/* ------------------------------------------------------------------------------------------------- news */
const NEWS = [
  {
    date: '2026-11-17',
    title: 'Introducing GridCorsa',
    img: photo('hero', 'spa'),
    text: 'The game has a new name and a new home: GridCorsa, with this website for everything about it. The game itself is one click away under Play now, as always free and in your browser.',
    points: [
      'New name and branding in the game',
      'A website with every car, circuit and feature',
      'Old invite links still take your friends straight into your room',
    ],
  },
  {
    date: '2026-11-15',
    title: 'A new driver’s HUD',
    img: photo('pole', 'zandvoort'),
    text: 'Everything you need while driving now sits together in the bottom right corner, the way the endurance sims lay it out.',
    points: [
      'The dial: gear, speed, the rev ring with throttle and brake arcs inside it',
      'Tyres coloured by temperature with their tread left, brake temperatures, wing damage',
      'Engine water and oil temperatures, fuel and tread bars',
    ],
  },
  {
    date: '2026-11-15',
    title: 'Menus rebuilt, F1-style racing line',
    img: photo('grid', 'spa'),
    text: 'New menus throughout, a garage to choose your car before every session, and a racing line made of the flat chevrons you know from the F1 games.',
    points: [
      'Garage: every car with its numbers against the field',
      'Driver profile with helmet avatars, achievements and your results',
      'Full-screen settings and records, quick match, lobby chat and invite links',
      'A loading screen worthy of race day',
    ],
  },
  {
    date: '2026-11-15',
    title: 'An all-GT3 grid and smarter AI',
    img: photo('straight', 'spa'),
    text: 'The grid is now 20 GT3 cars that race in the real world, they handle like them, and the AI races you cleanly.',
    points: [
      'Racing ABS holds the rear stable on the brakes: no more sliding into corners',
      'AI leaves a car’s width beside you, brakes for the car ahead in time and finishes its passes',
      'Bot level for every race: Rookie, Amateur, Club, Pro, Elite or Alien',
      'Two drivers may now race the same car',
    ],
  },
  {
    date: '2026-11-14',
    title: 'Spa rebuilt from Pouhon to Fagnes',
    img: photo('aerial', 'spa'),
    text: 'The stretch from corner 8 to past corner 10 at Spa-Francorchamps has been rebuilt from the ground up: flat where it should be, with kerbs you can use.',
    points: ['New road surface and kerbs over almost a kilometre', 'No more bouncing through the double left', 'The old smoothing patch removed'],
  },
];

/* ------------------------------------------------------------------------------------------------- pages */

const makes = [...new Set(cars.map((c) => c.manufacturer))].sort();
// HOME
const STORY = [
  [
    'Online racing',
    'Race your friends, anywhere',
    'Open a room and share its code or an invite link, jump into a public lobby with Quick Match, or host a race on your own device for friends on the same Wi-Fi. Practice, qualifying and the race, with up to twelve drivers.',
    '/online',
    photo('grid', 'zandvoort'),
  ],
  [
    'Licences & ratings',
    'Earn your licence',
    'Every clean corner counts. Your Safety Rating rises as you drive cleanly and falls with every incident, and lifts you from Rookie to the Pro licence. Levels, experience and achievements track the rest of your career.',
    '/licences',
    photo('pole', 'spa'),
  ],
  [
    'Weather & time of day',
    'Dawn to night, sun to rain',
    'Six kinds of weather and the full day, with forecasts that can change during a session. A drying line, tyres that need the right temperature, and wets when the rain comes.',
    '/weather',
    photo('straight', 'zandvoort'),
  ],
  [
    'Strategy',
    'Pit stops, fuel and race control',
    'A pit crew that changes your tyres and fills the tank, mandatory stops as in GT World Challenge, yellow flags, the safety car and drive-through penalties. Turn on what you want for each race.',
    '/sporting-code',
    photo('grid', 'spa'),
  ],
  [
    'AI drivers',
    'Bots that race you fairly',
    'Choose their level from Rookie to Alien. They leave you room side by side, brake for you in time and make clean passes, so racing them feels like racing people.',
    '/ai-racing',
    photo('hero', 'zandvoort'),
  ],
];
page({
  file: 'index.html',
  title: 'GridCorsa · GT3 sim racing in your browser',
  desc: 'Race 20 real GT3 cars at Spa, the Nürburgring and Zandvoort, free in your browser. Online with friends or against the AI, with real physics, weather, pit stops and race control.',
  body: `
<a class="promo" href="/telemetry"><span class="tag red">New</span> Telemetry: compare your best lap with the fastest drivers <b>→</b></a>
${hero({
  img: photo('hero', 'spa'),
  eyebrow: 'GT3 sim racing · free in your browser',
  title: 'The grid | is waiting',
  lead: 'Twenty real GT3 cars, three legendary circuits, real physics. Race your friends online or the AI on your own, with nothing to download: open it and drive.',
  ctas: `${playBtn()}${btn('/features', 'Explore the game')}`,
  badges: ['Free to play', 'No download', `${cars.length} GT3 cars`, `${layouts.length} layouts`, 'Up to 12 drivers'],
})}
<section class="sec">
  <div class="wrap">
    <div class="sec-head"><div><span class="eyebrow">The simulation</span><h2>Real cars. Real circuits. Real racing.</h2><p>Built like a sim, played in a browser: tyres, aerodynamics and damage modelled from the real cars, and the rules of a real GT race weekend.</p></div></div>
    <div class="stats">
      <div><b data-count="${cars.length}">${cars.length}</b><span>GT3 race cars</span></div>
      <div><b data-count="${layouts.length}">${layouts.length}</b><span>Layouts on ${CIRCUITS.length} circuits</span></div>
      <div><b data-count="120">120</b><span>Physics steps a second</span></div>
      <div><b data-count="12">12</b><span>Drivers per race</span></div>
    </div>
  </div>
</section>
<section class="hscroll" data-hscroll>
  <div class="hscroll-sticky">
    <div class="wrap">
      <div class="sec-head"><div><span class="eyebrow">The cars</span><h2>Drive ${cars.length} of today’s GT3 racers</h2></div><div class="actions">${btn('/cars', 'All cars', 'btn-light')}</div></div>
    </div>
    <div class="hscroll-track">${cars.map(carCard).join('')}</div>
    <div class="hscroll-bar"><i></i></div>
  </div>
</section>
<section class="sec">
  <div class="wrap story" data-story>
    <div class="story-media">${STORY.map(([k, , , , img], i) => `<figure class="${i ? '' : 'on'}" style="--img:url('${img}')"><figcaption>${String(i + 1).padStart(2, '0')} · ${esc(k)}</figcaption></figure>`).join('')}</div>
    <div class="story-steps">${STORY.map(
      ([k, h, x, href], i) =>
        `<div class="story-step${i ? '' : ' on'}" data-i="${i}"><span class="n">${String(i + 1).padStart(2, '0')} / ${String(STORY.length).padStart(2, '0')} · ${esc(k)}</span><h3>${esc(h)}</h3><p>${esc(x)}</p><p><a class="link-more" href="${href}">Learn more</a></p></div>`,
    ).join('')}</div>
  </div>
</section>
<section class="sec paper">
  <div class="wrap">
    <div class="sec-head"><div><span class="eyebrow">Latest news</span><h2>What’s new</h2></div><a class="link-more" href="/news">All news</a></div>
    <div class="grid g3">${NEWS.slice(0, 3)
      .map(
        (n) =>
          `<a class="card" href="/news#${slug(n.title)}"><div class="card-img" style="background-image:url('${n.img}')"></div><div class="card-body"><span class="date">${n.date}</span><h3>${esc(n.title)}</h3><p>${esc(n.text)}</p></div></a>`,
      )
      .join('')}</div>
  </div>
</section>
<section class="sec">
  <div class="wrap">
    <div class="sec-head"><div><span class="eyebrow">The circuits</span><h2>Race the legends</h2><p>Spa-Francorchamps, the Nürburgring with its Nordschleife, and Zandvoort in the dunes.</p></div><div class="actions">${btn('/tracks', 'All circuits', 'btn-light')}</div></div>
    <div class="grid g3">${CIRCUITS.map(circuitCard).join('')}</div>
  </div>
</section>
<section class="sec alt">
  <div class="wrap">
    <div class="sec-head"><div><span class="eyebrow">Live</span><h2>The paddock, live</h2><p>Who is racing now, who is fastest, and how they do it.</p></div></div>
    <div class="grid g3">
      <a class="card" href="/live"><div class="card-img" style="background-image:url('${photo('grid', 'spa')}')"></div><div class="card-body"><h3>Live sessions</h3><p>Public races right now: join one or watch.</p></div></a>
      <a class="card" href="/leaderboards"><div class="card-img" style="background-image:url('${photo('pole', 'zandvoort')}')"></div><div class="card-body"><h3>Leaderboards</h3><p>The fastest lap of every driver on every layout, dry and wet.</p></div></a>
      <a class="card" href="/telemetry"><div class="card-img" style="background-image:url('${photo('straight', 'spa')}')"></div><div class="card-body"><h3>Telemetry</h3><p>Speed, throttle, brake and steering of the best laps, on the map.</p></div></a>
    </div>
  </div>
</section>
<section class="sec paper">
  <div class="wrap">
    <div class="sec-head"><div><span class="eyebrow">New to sim racing?</span><h2>Start in three steps</h2><p>No subscription, no content to buy, no adverts. Racing the AI needs no account at all.</p></div><div class="actions">${btn('/account', 'What comes with an account', 'btn-ghost')}</div></div>
    <div class="grid g3">
      <div class="step"><div class="n">01</div><h3>Your computer</h3><p>A recent browser with WebGL 2 is all it takes. A graphics card makes it shine.</p><a class="link-more" href="/getting-started#requirements">System requirements</a></div>
      <div class="step"><div class="n">02</div><h3>Keyboard, controller or wheel</h3><p>Drive with the keyboard, an Xbox or PlayStation controller, or a steering wheel with its real lock.</p><a class="link-more" href="/wheels-controllers">Wheels & controllers</a></div>
      <div class="step"><div class="n">03</div><h3>Pick a car and race</h3><p>Choose your nickname and your car in the garage, then race solo or join your friends.</p><a class="link-more" href="/play/">Play now</a></div>
    </div>
  </div>
</section>
<section class="makes-band">
  <div class="wrap"><span class="eyebrow">On the grid</span></div>
  <div class="makes">${[...makes, ...makes].map((m) => `<a href="/cars#${slug(m)}">${esc(m)}</a>`).join('')}</div>
</section>
<section class="band">
  <div class="wrap"><div class="rv"><h2>Free. In your browser. Right now.</h2><p>No download, no account needed to race the AI.</p></div><div class="cta-row rv">${playBtn('Start racing')}</div></div>
</section>`,
});

// CARS
page({
  file: 'cars.html',
  active: 'Cars & Tracks',
  title: 'Cars · GridCorsa',
  desc: `All ${cars.length} GT3 race cars in GridCorsa, with their power, weight and engines.`,
  body: `
${hero({ img: photo('grid', 'spa'), eyebrow: 'The cars', title: `${cars.length} GT3 race cars`, lead: 'The cars of GT World Challenge, IMSA and the WEC’s LMGT3 class, each with its real engine, gearbox, weight and steering lock.', short: true })}
<section class="sec">
  <div class="wrap">
    <div class="filters"><input type="search" placeholder="Search cars" data-search aria-label="Search cars" /><button class="on" data-filter="">All</button>${makes.map((m) => `<button data-filter="${esc(m)}">${esc(m)}</button>`).join('')}</div>
    <div class="grid g4" data-cars>${cars.map(carCard).join('')}</div>
  </div>
</section>`,
});

// CAR PAGES
const range = (f) => [Math.min(...cars.map(f)), Math.max(...cars.map(f))];
const R = { power: range((c) => hp(c.specs.powerKw)), mass: range((c) => c.specs.massKg), top: range((c) => c.specs.topSpeedKmh) };
const barRow = (label, value, v, [lo, hi], lowerBetter = false) => {
  let f = hi > lo ? (v - lo) / (hi - lo) : 1;
  if (lowerBetter) f = 1 - f;
  return `<div><span>${esc(label)}<b>${esc(value)}</b></span><i><i style="width:${(15 + f * 85).toFixed(0)}%"></i></i></div>`;
};
cars.forEach((c, i) => {
  const s = c.specs;
  const prev = cars[(i - 1 + cars.length) % cars.length];
  const next = cars[(i + 1) % cars.length];
  const ptw = s.massKg / hp(s.powerKw);
  page({
    file: `cars/${c.id}.html`,
    active: 'Cars & Tracks',
    title: `${c.name} · Cars · GridCorsa`,
    desc: `${c.name}: ${hp(s.powerKw)} hp, ${s.massKg} kg${c.info ? `, ${c.info.engine}` : ''}. Drive it free in GridCorsa.`,
    body: `
<section class="car-hero">
  <div class="wrap">
    <div>
      <span class="eyebrow">${esc(c.manufacturer)}${c.year ? ` · ${c.year}` : ''}</span>
      <h1>${esc(teamOf(c))}</h1>
      <div class="outlined">${esc(c.name)}</div>
      <p style="color:var(--muted)">${esc(c.info?.team ?? '')}</p>
      <div class="cta-row">${playBtn('Drive it now')}${btn('/cars', 'All cars')}</div>
    </div>
    <img src="${carImg(c.id)}" alt="${esc(c.name)}" />
  </div>
</section>
<section class="sec">
  <div class="wrap">
    <div class="grid g2" style="gap:48px">
      <div>
        <h2>Specifications</h2>
        <table class="spec"><tbody>
          ${c.info ? `<tr><th>Engine</th><td>${esc(c.info.engine)}</td></tr><tr><th>Gearbox</th><td>${esc(c.info.gearbox)}</td></tr>` : ''}
          <tr><th>Power</th><td>${hp(s.powerKw)} hp (${s.powerKw} kW)</td></tr>
          <tr><th>Weight with driver</th><td>${s.massKg} kg</td></tr>
          <tr><th>Power-to-weight</th><td>${ptw.toFixed(2)} kg/hp</td></tr>
          <tr><th>Top speed</th><td>${s.topSpeedKmh} km/h</td></tr>
          <tr><th>Drivetrain</th><td>${s.drivetrain === 'RWD' ? 'Rear-wheel drive' : s.drivetrain}</td></tr>
          <tr><th>Forward gears</th><td>${s.gears.length}</td></tr>
          <tr><th>Rev limit</th><td>${s.limiterRpm.toLocaleString('en')} rpm</td></tr>
          <tr><th>Weight on the front axle</th><td>${Math.round(s.weightFront * 100)} %</td></tr>
          <tr><th>Steering lock</th><td>${lockOf(c.id)}°</td></tr>
          <tr><th>Class</th><td>${esc(c.category)}</td></tr>
          ${c.info ? `<tr><th>Team / livery</th><td>${esc(c.info.team)}</td></tr>` : ''}
        </tbody></table>
      </div>
      <div>
        <h2>Against the field</h2>
        <p style="color:var(--muted)">How it compares with the other ${cars.length - 1} GT3 cars in the game.</p>
        <div class="bars">
          ${barRow('Top speed', `${s.topSpeedKmh} km/h`, s.topSpeedKmh, R.top)}
          ${barRow('Power', `${hp(s.powerKw)} hp`, hp(s.powerKw), R.power)}
          ${barRow('Lightness', `${s.massKg} kg`, s.massKg, R.mass, true)}
        </div>
        <div class="callout"><b>In the game:</b> choose it in the garage before any session, solo or online. Two drivers can race the same car.</div>
      </div>
    </div>
    <div class="pager"><a href="/cars/${prev.id}"><small>← Previous</small>${esc(prev.name)}</a><a href="/cars/${next.id}"><small>Next →</small>${esc(next.name)}</a></div>
  </div>
</section>`,
  });
});

// TRACKS
page({
  file: 'tracks.html',
  active: 'Cars & Tracks',
  title: 'Circuits · GridCorsa',
  desc: 'Spa-Francorchamps, the Nürburgring with the Nordschleife, and Zandvoort: every circuit and layout in GridCorsa.',
  body: `
${hero({ img: photo('aerial', 'spa'), eyebrow: 'The circuits', title: 'Three legends', lead: `${CIRCUITS.length} circuits and ${layouts.length} layouts, from Zandvoort’s banked corners to the 25 km of the Nürburgring’s 24-hour layout.`, short: true })}
<section class="sec">
  <div class="wrap">
    <div class="grid g3">${CIRCUITS.map(circuitCard).join('')}</div>
    <h2 style="margin-top:56px">Every layout</h2>
    <table class="spec"><tbody>
      ${layouts.map((l) => `<tr><th>${esc(l.name)}</th><td>${(l.length / 1000).toFixed(2)} km${l.turns ? ` · ${l.turns} turns` : ''}</td></tr>`).join('')}
    </tbody></table>
  </div>
</section>`,
});
for (const c of CIRCUITS) {
  page({
    file: `tracks/${c.id}.html`,
    active: 'Cars & Tracks',
    title: `${c.name} · Circuits · GridCorsa`,
    desc: `${c.name} (${c.country}) in GridCorsa: ${c.layouts.length} layout(s), ${(c.main.length / 1000).toFixed(2)} km.`,
    body: `
${hero({ img: photo('hero', c.photoMap), eyebrow: `${c.country} · ${c.place}`, title: esc(c.short), lead: esc(c.intro), ctas: `${playBtn('Race here now')}${btn('/tracks', 'All circuits')}`, short: true })}
<section class="sec">
  <div class="wrap">
    <h2>Layouts</h2>
    <div class="grid g3">${c.layouts
      .map(
        (l) =>
          `<div class="card"><div class="card-img" style="display:grid;place-items:center;padding:26px;background:var(--ink-3)">${l.svg.replace('class="outline"', 'class="outline" style="width:62%;height:100%"')}</div><div class="card-body"><h3>${esc(l.name)}</h3><div class="meta"><span class="tag red">${(l.length / 1000).toFixed(2)} km</span>${l.turns ? `<span class="tag">${l.turns} turns</span>` : ''}${l.default ? '<span class="tag gt3">Main layout</span>' : ''}</div></div></div>`,
      )
      .join('')}</div>
    <div class="grid g2" style="margin-top:56px;gap:40px">
      <div><h2>Track guide</h2><table class="spec"><tbody>${(c.guide ?? c.corners.map((k) => [k, ''])).map(([k, g]) => `<tr><th>${esc(k)}</th><td>${esc(g)}</td></tr>`).join('')}</tbody></table></div>
      <div><h2>In the game</h2><p>Choose it in the lobby’s Circuit step, then the conditions: the weather, the time of day and whether it changes during the session. The racing line, the pit lane and the track limits are all set up for it.</p></div>
    </div>
    <h2 style="margin-top:48px">Gallery</h2>
    <div class="gallery">${['hero', 'aerial', 'grid', 'pole', 'straight']
      .map((s) => `<a href="${photo(s, c.photoMap)}" aria-label="${esc(c.short)}" style="background-image:url('${photo(s, c.photoMap)}')"></a>`)
      .join('')}</div>
  </div>
</section>`,
  });
}

// FEATURES
page({
  file: 'features.html',
  active: 'Features',
  title: 'Features · GridCorsa',
  desc: 'Tyre and vehicle physics, weather and time of day, pit stops, fuel, race control, AI with bot levels, the racing line and the HUD.',
  body: `
${hero({ img: photo('straight', 'spa'), eyebrow: 'The game', title: 'Built like a sim', lead: 'Physics, weather, strategy and racing rules taken from the real thing, in a game that runs in your browser.', short: true })}
<section class="sec">
  <div class="wrap layout-side">
    <nav class="toc"><a href="#physics">Physics</a><a href="#weather">Weather & tyres</a><a href="#strategy">Strategy</a><a href="#ai">AI & bot levels</a><a href="#assists">Racing line & assists</a><a href="#hud">HUD & cameras</a><a href="#graphics">Graphics</a></nav>
    <div class="prose">
      <h2 id="physics">Physics</h2>
      <p>Every car is simulated on its own four tyres, 120 times a second.</p>
      <ul>
        <li>A slick tyre model with combined slip: grip on the brakes and in the corner share the same tyre.</li>
        <li>Tyre temperature, pressure and wear that change the grip lap by lap; brake discs that heat up and fade.</li>
        <li>Downforce and drag that grow with speed, a slipstream behind other cars, dirty air that costs grip in their wake.</li>
        <li>Suspension with springs, dampers and anti-roll bars, a limited-slip differential, racing ABS and traction control.</li>
        <li>Damage: aerodynamics, suspension, engine and alignment, shown on the car and in the damage report.</li>
      </ul>
      <h2 id="weather">Weather & tyres</h2>
      <p>Clear, cloudy, overcast, light rain, heavy rain and fog, from dawn to night, with forecasts that can change during a session. The track gets wetter and dries, the air and track temperatures change the tyres and engines, and rubber builds up on the racing line.</p>
      <ul><li><b>Soft</b> – the most grip, wears fastest, works from 80 °C.</li><li><b>Medium</b> – the all-rounder, at its best around 85 °C.</li><li><b>Hard</b> – lasts longest, needs 92 °C.</li><li><b>Wet</b> – for the rain, at its best around 60 °C.</li></ul>
      <h2 id="strategy">Strategy</h2>
      <ul>
        <li><b>Pit stops</b> – the crew changes tyres and refuels; drive-throughs are served at the limiter.</li>
        <li><b>Fuel</b> – engines burn fuel and the car gets lighter; choose your fuel load before the start.</li>
        <li><b>Mandatory stop</b> – one stop inside the pit window, as in GT World Challenge Sprint.</li>
        <li><b>Race control</b> – yellow flags, full-course yellow, the safety car, blue flags and drive-through penalties.</li>
        <li><b>Track limits</b> – all four wheels off and the lap is invalid; gain an advantage and you are penalised.</li>
      </ul>
      <h2 id="ai">AI & bot levels</h2>
      <p>The AI drivers follow a racing line built for every layout and race with real racecraft: they leave a car’s width when you are alongside, do not move across a faster car, brake for the car ahead in time and complete their passes. Choose how fast they are for each race:</p>
      <div class="lic">${[
        ['Rookie', '82%'],
        ['Amateur', '88%'],
        ['Club', '93%'],
        ['Pro', '97%'],
        ['Elite', '101%'],
        ['Alien', '105%'],
      ]
        .map(([n, p], i) => `<div style="--lc:hsl(${210 - i * 38} 70% 52%)"><b>${p}</b><span>${n}</span></div>`)
        .join('')}</div>
      <h2 id="assists">Racing line & assists</h2>
      <p>The racing line is drawn as flat chevrons, as in the F1 games: green to go, yellow to lift, orange and red to brake, coloured from your speed so it turns red only when you arrive too fast. Show it everywhere, only in braking zones, or not at all. ABS, traction control (two levels), stability control and an automatic or manual gearbox are yours to choose.</p>
      <h2 id="hud">HUD & cameras</h2>
      <p>A driver’s dial with the gear, speed, revs and pedal arcs; tyres coloured by temperature with their tread and brakes; engine water and oil temperatures; fuel; a relative box with the cars around you; a delta bar against your best lap; a spotter; and a live map of the circuit. Drive from the cockpit or a chase camera, or watch the TV cameras.</p>
      <h2 id="graphics">Graphics</h2>
      <p>Four quality presets from Low to Ultra, found automatically for your computer, with dynamic resolution to hold the frame rate. Ultra gives everything regardless of performance: 4K shadows, the densest grass and forest, and the farthest view.</p>
    </div>
  </div>
</section>
<section class="band"><div class="wrap"><div><h2>See it for yourself</h2><p>It takes a minute to get on track.</p></div><div class="cta-row">${playBtn()}</div></div></section>`,
});

// ONLINE
page({
  file: 'online.html',
  active: 'Features',
  title: 'Online racing · GridCorsa',
  desc: 'Rooms with up to 12 drivers, quick match, friends, lobby chat, invite links and LAN hosting. Practice, qualifying and race weekends, or race the AI solo.',
  body: `
${hero({ img: photo('grid', 'zandvoort'), eyebrow: 'Racing', title: 'Race people', lead: 'Rooms for up to twelve drivers, friends who can join you in one click, and race weekends with the rules you choose.', ctas: playBtn('Find a race'), short: true })}
<section class="sec">
  <div class="wrap">
    <div class="grid g3">
      <div class="step"><div class="n">01</div><h3>Quick match</h3><p>Straight into the fullest public lobby with a free place, or a new public room others can find in the list.</p></div>
      <div class="step"><div class="n">02</div><h3>Rooms & invites</h3><p>Create a room and share its five-letter code or an invite link that opens the game with the code filled in.</p></div>
      <div class="step"><div class="n">03</div><h3>Same Wi-Fi</h3><p>Host a race on your own device (a phone works) and your friends connect straight to you, no account needed.</p></div>
    </div>
  </div>
</section>
<section class="sec alt">
  <div class="wrap">
    <div class="feat"><div class="feat-img" style="--img:url('${photo('pole', 'zandvoort')}')"></div><div><span class="eyebrow">Friends</span><h3>Your friends, one click away</h3><ul><li>Add friends by nickname and see who is online, in a lobby or racing.</li><li>Join their lobby or watch their race from your friends list.</li><li>Recent players: add the drivers you just raced.</li><li>Chat with the room in the lobby.</li></ul></div></div>
    <div class="feat flip" id="weekend"><div class="feat-img" style="--img:url('${photo('grid', 'spa')}')"></div><div><span class="eyebrow">Race weekends</span><h3>Practice, qualifying, race</h3><ul><li>Optional free practice (10–30 minutes), qualifying (5–30 minutes) for the grid.</li><li>A race by laps (3–15) or by time (10–60 minutes).</li><li>Rules for each room: car contact, mandatory pit stop, fuel, race control, bot level.</li><li>Results with gaps, best laps and penalties; lap records for everyone or your friends, dry and wet.</li></ul></div></div>
    <div class="feat" id="solo"><div class="feat-img" style="--img:url('${photo('aerial', 'zandvoort')}')"></div><div><span class="eyebrow">Solo</span><h3>Solo races and championships</h3><p>Race the AI on any circuit, offline, without an account. Or take on a championship against them on every circuit, points as in Formula 1, round by round.</p>${playBtn('Race solo')}</div></div>
  </div>
</section>
<section class="sec">
  <div class="wrap prose">
    <h2>Accounts</h2>
    <p>Online racing needs a free account: a nickname and a password, nothing else. Your account keeps your driver profile (country, number, three-letter code, helmet), your friends, your online results and your lap records. Solo races work without one.</p>
    <p>${btn('/licences', 'Licences & ratings')}</p>
  </div>
</section>`,
});

// LICENCES
page({
  file: 'licences.html',
  active: 'Features',
  title: 'Licences & ratings · GridCorsa',
  desc: 'How the Safety Rating, licences, levels and achievements work in GridCorsa.',
  body: `
${hero({ img: photo('pole', 'spa'), eyebrow: 'Your career', title: 'Licences & ratings', lead: 'Drive cleanly and climb from Rookie to Pro. Every session also earns experience towards your next level.', short: true })}
<section class="sec">
  <div class="wrap prose">
    <h2>Licences</h2>
    <div class="lic">${[
      ['R', 'Rookie', '#d63a3a'],
      ['D', 'Class D', '#f08a24'],
      ['C', 'Class C', '#c9a40f'],
      ['B', 'Class B', '#2f9e44'],
      ['A', 'Class A', '#2f7de1'],
      ['P', 'Pro', '#d9d9d9'],
    ]
      .map(([l, n, col]) => `<div style="--lc:${col}"><b>${l}</b><span>${n}</span></div>`)
      .join('')}</div>
    <h2>Safety Rating</h2>
    <p>Your Safety Rating starts at 2.50 in Rookie. It moves with the corners you drive for each incident point, the way iRacing measures it: around a hundred corners for each point keeps it level, cleaner driving raises it, more incidents lower it.</p>
    <ul><li>Off track: 1 point</li><li>Hitting a wall: 2 points</li><li>Contact with another car, or a reset: 4 points</li></ul>
    <div class="callout">A Rookie is promoted at a rating of 3.00, every other class at 4.00; a promotion costs 1.00 of rating. Below 1.00 your licence drops a class.</div>
    <h2>Levels & experience</h2>
    <p>Every session gives experience for the distance you drove, your clean laps, your personal bests and your result. The first level needs 500 XP, and each one after it 250 more.</p>
    <h2>Achievements</h2>
    <ul><li>First start, On the podium, Winner, Pole sitter</li><li>Hat-trick (three wins), Champion material (ten wins)</li><li>Clean driver (50 clean laps), Century (100 km), Endurance (1,000 km)</li><li>Globetrotter (three circuits), Licence B, Pro licence, Level 10, Online racer</li></ul>
    <p>See them all on your driver profile, with your stats, your results and your favourite car.</p>
    <p>${playBtn('Start your career')}</p>
  </div>
</section>`,
});

// GETTING STARTED
const KEYS = [
  ['Throttle', ['W', '↑']],
  ['Brake', ['S', '↓']],
  ['Steer left / right', ['A', 'D']],
  ['Shift up', ['E', 'Shift']],
  ['Shift down', ['Q', 'Ctrl']],
  ['Handbrake', ['Space']],
  ['Camera', ['V']],
  ['TV cameras', ['T']],
  ['Look left / back / right', ['Z', 'X', 'C']],
  ['Timing screen', ['Tab']],
  ['Damage report', ['F']],
  ['Reset to track', ['R']],
  ['Manual / automatic', ['M']],
  ['Pause menu', ['Esc']],
];
page({
  file: 'getting-started.html',
  active: 'Multimedia',
  title: 'Getting started · GridCorsa',
  desc: 'Your first race in GridCorsa: what your computer needs, the controls for keyboard, controller and wheel, and tips for new drivers.',
  body: `
${hero({ img: photo('straight', 'zandvoort'), eyebrow: 'New racer guide', title: 'Your first race', lead: 'From opening the game to your first clean lap.', short: true })}
<section class="sec">
  <div class="wrap layout-side">
    <nav class="toc"><a href="#first">First race</a><a href="#controls">Controls</a><a href="#requirements">Requirements</a><a href="#tips">Driving tips</a></nav>
    <div class="prose">
      <h2 id="first">Your first race</h2>
      <ol>
        <li><b>Open the game</b> with Play now and choose a nickname (an account is only needed for online racing).</li>
        <li><b>Choose your car</b> in the garage: every car with its numbers against the rest of the field.</li>
        <li><b>Play solo</b>: pick the circuit, the conditions, the session and the rules in the lobby, add some AI drivers, then Ready and Start.</li>
        <li><b>In the briefing</b>, choose your tyres and the car setup, or leave the recommended one.</li>
        <li><b>Drive</b>: the first lap is an out lap, so warm your tyres up before you push.</li>
      </ol>
      <h2 id="controls">Controls</h2>
      <h3>Keyboard</h3>
      <div class="keys">${KEYS.map(([a, ks]) => `<div><span>${esc(a)}</span><span>${ks.map((k) => `<kbd>${esc(k)}</kbd>`).join(' ')}</span></div>`).join('')}</div>
      <p>Every key can be changed in Settings → Controls, along with how quickly the throttle, brake and steering respond.</p>
      <h3>Controller</h3>
      <p>Xbox, PlayStation and Switch Pro controllers work as soon as they are connected: triggers for the throttle and brake, the left stick to steer. Dead zone, steering curve and speed, and brake curve are all adjustable, and there is rumble.</p>
      <h3>Steering wheel</h3>
      <p>Wheels are recognised automatically. Set your wheel base’s rotation (900° is what the sims recommend) and each car steers with its real lock: a 516° BMW M4 turns its wheel 516°, with no filters in between.</p>
      <h2 id="requirements">System requirements</h2>
      <table class="spec"><tbody>
        <tr><th>Browser</th><td>A recent Chrome, Edge, Firefox or Safari with WebGL 2</td></tr>
        <tr><th>Minimum</th><td>Integrated graphics, 8 GB of memory: the Low preset</td></tr>
        <tr><th>Recommended</th><td>A dedicated graphics card, 16 GB of memory: High or Ultra</td></tr>
        <tr><th>Connection</th><td>Only to load the cars and circuits and to race online; solo races run offline once loaded</td></tr>
        <tr><th>Phone</th><td>Use the Android app for touch and tilt steering</td></tr>
      </tbody></table>
      <h2 id="tips">Driving tips</h2>
      <ul>
        <li>Brake in a straight line, then turn in; ease off the brake as you add steering.</li>
        <li>Cold tyres slide: blue on the tyre panel means they are not ready yet.</li>
        <li>Slow corners: brake later and turn in later for a straighter exit. Fast corners: brake less and carry the speed.</li>
        <li>All four wheels off the track and the lap does not count.</li>
        <li>Follow another car closely on the straights to use its slipstream.</li>
      </ul>
      <p>${playBtn()}</p>
    </div>
  </div>
</section>`,
});

// NEWS
page({
  file: 'news.html',
  active: 'News',
  title: 'News & updates · GridCorsa',
  desc: 'What is new in GridCorsa: updates, new features and fixes.',
  body: `
${hero({ img: photo('hero', 'zandvoort'), eyebrow: 'News', title: 'News & updates', lead: 'Every update to the game, newest first.', short: true })}
<section class="sec">
  <div class="wrap" style="max-width:900px">
    <div class="timeline">${NEWS.map(
      (n) =>
        `<article id="${slug(n.title)}"><span class="date">${n.date}</span><h3>${esc(n.title)}</h3><p>${esc(n.text)}</p><ul>${n.points.map((p) => `<li>${esc(p)}</li>`).join('')}</ul></article>`,
    ).join('')}</div>
  </div>
</section>`,
});

// MEDIA
const shots = [];
for (const c of CIRCUITS) for (const s of ['hero', 'aerial', 'grid', 'pole', 'straight']) shots.push([photo(s, c.photoMap), c.short]);
page({
  file: 'media.html',
  active: 'Multimedia',
  title: 'Screenshots · GridCorsa',
  desc: 'Screenshots of GridCorsa at Spa-Francorchamps, the Nürburgring and Zandvoort, and renders of every car.',
  body: `
${hero({ img: photo('pole', 'zandvoort'), eyebrow: 'Media', title: 'Screenshots', lead: 'Straight from the game.', short: true })}
<section class="sec">
  <div class="wrap">
    <div class="gallery">${shots.map(([src, name]) => `<a href="${src}" aria-label="${esc(name)}" style="background-image:url('${src}')"></a>`).join('')}</div>
    <h2 style="margin-top:56px">The cars</h2>
    <div class="gallery">${cars.map((c) => `<a href="${carImg(c.id)}" aria-label="${esc(c.name)}" style="background-image:url('${carImg(c.id)}');background-size:contain;background-color:var(--ink-3)"></a>`).join('')}</div>
  </div>
</section>`,
});

// DOWNLOAD
page({
  file: 'download.html',
  active: 'Support',
  title: 'Download · GridCorsa',
  desc: 'Play GridCorsa in your browser with nothing to install, or get the Android app.',
  body: `
${hero({ img: photo('grid', 'spa'), eyebrow: 'Download', title: 'Play anywhere', lead: 'On a computer, GridCorsa runs in your browser. On Android, there is an app.', short: true })}
<section class="sec">
  <div class="wrap grid g2">
    <div class="step"><div class="n">PC</div><h3>In your browser</h3><p>Nothing to install: open it and race. Keyboard, controller and steering wheel. Windows, macOS and Linux.</p>${playBtn()}</div>
    <div class="step"><div class="n">APP</div><h3>Android</h3><p>Touch or tilt steering, the same rooms and friends as on the computer. Allow installing apps from your browser when Android asks.</p><a class="btn btn-light" href="/play/downloads/apex-ghost.apk">Download the APK ${ICON.arrow}</a></div>
  </div>
</section>`,
});

// FAQ
const FAQ = [
  ['Is GridCorsa free?', 'Yes. Every car, circuit and mode is free, solo and online.'],
  [
    'Do I need an account?',
    'Only to race online, so the server can keep your friends, results and records. Solo races and championships work without one, and so do races hosted on your own device for friends on the same Wi-Fi.',
  ],
  ['Which browsers work?', 'Recent versions of Chrome, Edge, Firefox and Safari with WebGL 2. Chrome and Edge usually run it fastest.'],
  [
    'Can I use my steering wheel?',
    'Yes. Wheels are recognised automatically; set your wheel base’s rotation in Settings and each car steers with its real lock.',
  ],
  [
    'How do I race my friends?',
    'Create a room and send them the code or the invite link from the lobby, or add them as friends and they can join your lobby from their friends list. Quick Match finds an open public lobby.',
  ],
  ['Can two of us drive the same car?', 'Yes. Any car can be on the grid more than once.'],
  [
    'The game runs slowly. What can I do?',
    'Lower the graphics preset in Settings → Graphics (the game picks one for your computer the first time), close other tabs, and make sure your browser uses your graphics card (hardware acceleration on).',
  ],
  [
    'My car slides too much.',
    'Check that ABS and traction control are on in Settings → Driving, warm your tyres up on the first lap, and use the right tyres for the weather.',
  ],
  [
    'Where is my progress saved?',
    'Your solo career, garage, settings and history are kept in your browser. Online results, friends and records are kept with your account.',
  ],
  ['Can I play on my phone?', 'Use the Android app from the Download page: touch or tilt steering, and the same rooms as your friends on the computer.'],
];
page({
  file: 'faq.html',
  active: 'Support',
  title: 'FAQ & support · GridCorsa',
  desc: 'Answers to common questions about GridCorsa: accounts, browsers, wheels, racing with friends, performance.',
  body: `
${hero({ img: photo('aerial', 'zandvoort'), eyebrow: 'Support', title: 'FAQ & support', lead: 'Answers to the questions drivers ask most.', short: true })}
<section class="sec">
  <div class="wrap" style="max-width:900px">
    ${FAQ.map(([q, a]) => `<details class="faq"><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('')}
    <h2 id="privacy" style="margin-top:56px">Privacy</h2>
    <p>Playing solo sends nothing to a server. An account stores your nickname, a hash of your password, your driver profile, friends, results and lap records. Online races pass your car’s position to the other drivers in your room. There are no adverts and no tracking.</p>
  </div>
</section>`,
});

// 404
page({
  file: '404.html',
  title: 'Off track · GridCorsa',
  desc: 'This page does not exist.',
  body: `${hero({ img: photo('aerial', 'nurburgring'), eyebrow: '404', title: 'Off track', lead: 'This page does not exist. Rejoin the circuit:', ctas: `${btn('/', 'Home', 'btn-light')}${playBtn()}` })}`,
});

/* ------------------------------------------------------------------------------------------------- more pages */
const SERVER = 'https://apex-ghost-server.ilmas.workers.dev';
const sub = (file, active, title, desc, h, body) => page({ file, active, title: `${title} · GridCorsa`, desc, body: `${hero({ short: true, ...h })}${body}` });
const sideToc = (items) => `<nav class="toc">${items.map(([id, l]) => `<a href="#${id}">${esc(l)}</a>`).join('')}</nav>`;

// ABOUT
const HISTORY = [
  ['2026-10-17', 'The first lap', 'GridCorsa (then Apex Ghost) goes online: GT3 cars racing each other at the Nürburgring, in English and Spanish.'],
  ['2026-10-18', 'Zandvoort', 'The second circuit, and AI drivers that merge from the grid, pass slower cars and catch their slides.'],
  ['2026-10-20', 'Fair track limits, and an app', 'Painted white lines and all four wheels, warnings first; the Android app with touch and tilt steering.'],
  ['2026-10-23', 'The 24-hour layout', 'The Nürburgring with the Nordschleife, real car data, air and track temperatures and a new tyre model.'],
  ['2026-10-24', 'Race rules', 'Car contact, mandatory pit stops, fuel, and race control with yellow flags, the safety car and penalties.'],
  ['2026-10-25', 'The Nordschleife rebuilt', 'The real 24-hour link roads from OpenStreetMap data, no holes, armco where it belongs.'],
  [
    '2026-10-29',
    'A real paddock',
    'A physics realism pass, pit crews that change the tyres wheel by wheel, accounts, friends and lap records, the GT3 weekend.',
  ],
  ['2026-10-30', 'The racing line', 'Chase and cockpit cameras, a rear-view mirror, the F1-style racing line and a new lobby, step by step.'],
  ['2026-11-02', 'Spa-Francorchamps', 'Spa joins, with TV cameras, the career and an iRacing-style damage and tyre display.'],
  ['2026-11-15', 'The all-GT3 grid', `${cars.length} real GT3 cars, planted handling, AI that races cleanly, the garage, profiles and new menus.`],
  ['2026-11-17', 'GridCorsa', 'A new name and this website.'],
];
sub(
  'about.html',
  'About',
  'What is GridCorsa?',
  'GridCorsa is GT3 sim racing that runs in your browser: real cars, real circuits, online with friends or against the AI.',
  {
    img: photo('hero', 'zandvoort'),
    eyebrow: 'About',
    title: 'What is GridCorsa?',
    lead: 'A racing simulation for everyone with a browser: no download, no subscription, no catch.',
  },
  `<section class="sec"><div class="wrap layout-side">${sideToc([
    ['what', 'The game'],
    ['how', 'How it is made'],
    ['history', 'History'],
  ])}<div class="prose">
  <h2 id="what">The game</h2>
  <p>GridCorsa recreates GT3 racing: the cars of the GT World Challenge, IMSA’s GTD classes and the WEC’s LMGT3, on Spa-Francorchamps, the Nürburgring with its Nordschleife, and Zandvoort. You drive them with a keyboard, a controller or a steering wheel, alone against the AI or online against your friends, with the rules of a real race weekend: practice, qualifying and the race, pit stops, fuel, flags and penalties.</p>
  <p>It runs in your browser. Open the page and you are a minute from the track; there is nothing to install and nothing to pay.</p>
  <h2 id="how">How it is made</h2>
  <ul>
    <li><b>Physics</b> – our own vehicle model on the Rapier physics engine, 120 steps a second: tyres, suspension, aerodynamics, differential, brakes and damage.</li>
    <li><b>Graphics</b> – three.js and WebGL 2, with presets from Low (laptops and phones) to Ultra.</li>
    <li><b>Online</b> – race rooms on Cloudflare’s network close to every driver, or hosted on your own device for friends on the same Wi-Fi.</li>
    <li><b>Data</b> – the cars’ real power, weight, gearing and steering locks; circuits built from real plans and map data.</li>
  </ul>
  <h2 id="history">History</h2>
  <div class="timeline">${HISTORY.map(([d, h, x]) => `<article><span class="date">${d}</span><h3>${esc(h)}</h3><p>${esc(x)}</p></article>`).join('')}</div>
  <p>${btn('/builds', 'All release notes', 'btn-light')}</p>
  </div></div></section>`,
);

// RELEASE NOTES (from the project's history)
let builds = [];
try {
  const { execSync } = await import('node:child_process');
  builds = execSync('git log --format=%ad%x1f%s --date=short', { cwd: root, encoding: 'utf8' })
    .trim()
    .split('\n')
    .map((l) => l.split('\x1f'))
    .filter(([, s]) => s && !/godot|migration|readme|decisions|merge |^ignore|^fix shared|android app 1\.1:/i.test(s))
    .map(([d, s]) => [d, s.replace(/^(Web game|GridCorsa):\s*/, '').replace(/APEX GHOST: /, '')]);
} catch {
  builds = [];
}
const byDay = new Map();
for (const [d, s] of builds) byDay.set(d, [...(byDay.get(d) ?? []), s]);
sub(
  'builds.html',
  'News',
  'Release notes',
  'Every update to GridCorsa, day by day.',
  { img: photo('pole', 'nurburgring'), eyebrow: 'News', title: 'Release notes', lead: 'What changed in every update, newest first.' },
  `<section class="sec"><div class="wrap" style="max-width:960px"><div class="timeline">${[...byDay.entries()]
    .map(
      ([d, list]) =>
        `<article><span class="date">${d}</span><h3>Update ${d.replace(/-/g, '.')}</h3><ul>${list.map((s) => `<li>${esc(s)}</li>`).join('')}</ul></article>`,
    )
    .join('')}</div></div></section>`,
);

// CAR TECHNOLOGY
sub(
  'car-technology.html',
  'Cars & Tracks',
  'Car technology',
  'How GridCorsa models its GT3 cars: real data, tyres, aerodynamics, brakes, engines and damage.',
  {
    img: photo('grid', 'nurburgring'),
    eyebrow: 'Cars & Tracks',
    title: 'Car technology',
    lead: 'Every car is simulated from its real numbers, on its own four tyres, 120 times a second.',
  },
  `<section class="sec"><div class="wrap layout-side">${sideToc([
    ['data', 'Real data'],
    ['tyres', 'Tyres'],
    ['aero', 'Aerodynamics'],
    ['chassis', 'Chassis'],
    ['drive', 'Engine & drivetrain'],
    ['damage', 'Damage'],
    ['sound', 'Sound'],
  ])}<div class="prose">
  <h2 id="data">Real data</h2>
  <p>Each car carries its own specification: mass with the driver, engine power and torque curve, rev limit, gear ratios and final drive, shift time, weight distribution, centre of mass height, brake torque and balance, drag and downforce, aero balance, differential locking, springs and anti-roll bars, and the steering wheel’s real lock to lock, from 480° in a McLaren to 800° in a Porsche or Ferrari.</p>
  <h2 id="tyres">Tyres</h2>
  <ul>
    <li>A Magic Formula slick model with combined slip and load sensitivity: the more a tyre is loaded, the less grip each kilogram gets.</li>
    <li>A thermal model: sliding and flexing heat the tread, the air and the road cool it; each compound has its own window.</li>
    <li>Pressures that rise with temperature (the gas law), changing the contact patch and the carcass.</li>
    <li>Wear from sliding energy, faster when overheated; flat spots when a wheel locks at speed.</li>
    <li>Wider rear tyres than front, as on a real GT3: the car is stable at the limit.</li>
  </ul>
  <h2 id="aero">Aerodynamics</h2>
  <p>Downforce and drag grow with the square of speed. The balance moves forward as the nose dives under braking and back as the car squats, and a car sliding sideways loses downforce, the rear wing first. In another car’s wake you have less drag (the slipstream) and less downforce (dirty air).</p>
  <h2 id="chassis">Chassis</h2>
  <ul>
    <li>Springs and digressive dampers per wheel, anti-roll bars, bump stops, ride height and rake.</li>
    <li>Camber that changes as the body rolls; tyre relaxation length that grows with load.</li>
    <li>Racing ABS that keeps the rear axle below its peak slip for stability; traction control in two levels.</li>
    <li>Brake discs that heat up and fade, and cool in the airflow.</li>
  </ul>
  <h2 id="drive">Engine & drivetrain</h2>
  <p>Torque from the real curve through a sequential gearbox with its shift time, a plated limited-slip differential with more locking on power than on the overrun, engine braking, and air density: a naturally aspirated engine loses power at altitude or on a hot day, a turbo less. Engines warm their coolant and oil, and burn fuel, which makes the car lighter.</p>
  <h2 id="damage">Damage</h2>
  <p>Front, rear, sides and engine take damage separately: a broken splitter costs front downforce and the car understeers, a broken wing makes it oversteer, bent suspension pulls it to one side, and engine damage costs power. The pit crew repairs it during a stop.</p>
  <h2 id="sound">Sound</h2>
  <p>Each engine family has its own voice, from the flat-six of the 911 to the V10 of the Huracán and the twin-turbo V8s, with tyre, kerb, gravel and grass sounds from real recordings.</p>
  <p>${btn('/cars', 'All cars', 'btn-light')}</p>
  </div></div></section>`,
);

// TRACK TECHNOLOGY
sub(
  'track-technology.html',
  'Cars & Tracks',
  'Track technology',
  'How the circuits in GridCorsa are built: real layouts, surfaces, kerbs, track limits, pit lanes and racing lines.',
  {
    img: photo('aerial', 'nurburgring'),
    eyebrow: 'Cars & Tracks',
    title: 'Track technology',
    lead: 'Real layouts, every surface with its own grip, and the rules of the circuit built in.',
  },
  `<section class="sec"><div class="wrap layout-side">${sideToc([
    ['layout', 'Layouts'],
    ['surface', 'Surfaces'],
    ['limits', 'Track limits'],
    ['pits', 'Pit lanes'],
    ['line', 'Racing line'],
    ['live', 'A living track'],
  ])}<div class="prose">
  <h2 id="layout">Layouts</h2>
  <p>Every layout is built from real plans and map data: its centre line, its width on both sides, its elevation and banking. The Nordschleife’s 24-hour link roads were rebuilt from OpenStreetMap; sections that were not right, like Spa from Pouhon to Fagnes, have been rebuilt from the ground up.</p>
  <h2 id="surface">Surfaces</h2>
  <p>The ground under each wheel is one of asphalt, kerb, grass, gravel, sand or a wall, each with its own grip, rolling resistance and rumble. Kerbs are shaped to be driven over; gravel slows you, grass is slippery, and in the rain all of them change.</p>
  <h2 id="limits">Track limits</h2>
  <p>The white lines are the limit: all four wheels beyond them and the lap is invalid. Three warnings, then a penalty; cut a corner and gain time and the penalty comes at once. Pushed off by another car, you are not penalised. See the <a href="/sporting-code">sporting code</a>.</p>
  <h2 id="pits">Pit lanes</h2>
  <p>A pit lane with its own speed limit, boxes in front of the garages where your crew waits, and the entry and exit drawn where they are on the real circuit.</p>
  <h2 id="line">Racing line</h2>
  <p>Each layout has a racing line computed for it, using the whole width of the track: the AI drivers follow it, and the racing line assist draws it for you, coloured by how hard you need to brake.</p>
  <h2 id="live">A living track</h2>
  <p>Rubber builds up on the racing line during a session and grip rises; rain washes it away. Air and track temperatures change with the weather and the time of day, and with them your tyres and engine.</p>
  <p>${btn('/tracks', 'All circuits', 'btn-light')}</p>
  </div></div></section>`,
);

// CAR SETUP
sub(
  'car-setup.html',
  'Cars & Tracks',
  'Car setup guide',
  'Tyres, rear wing, brake balance, pressures, ride height, anti-roll bars and dampers in GridCorsa, and what each does.',
  {
    img: photo('pole', 'zandvoort'),
    eyebrow: 'Cars & Tracks',
    title: 'Car setup guide',
    lead: 'Set up your car in the briefing before each session, or keep the recommended setup.',
  },
  `<section class="sec"><div class="wrap prose">
  <table class="spec"><tbody>
    <tr><th>Tyres</th><td>Soft, Medium, Hard or Wet. Softer grips more and wears faster; wets for a wet track.</td></tr>
    <tr><th>Rear wing</th><td>Low (−18 % downforce, −10 % drag) for top speed, Medium, or High (+18 % downforce, +10 % drag) for cornering grip.</td></tr>
    <tr><th>Brake balance</th><td>54–66 % to the front. More to the rear rotates the car on entry but can lock the rears.</td></tr>
    <tr><th>Tyre pressures</th><td>Cold pressures front and rear; or let the crew set them for the hot target.</td></tr>
    <tr><th>Ride height</th><td>±10 mm per axle. Lower gives more downforce from the floor (about 3.5 % per 10 mm) and a lower centre of mass, but less travel over kerbs; more rake moves the aero balance forward.</td></tr>
    <tr><th>Anti-roll bars</th><td>Clicks 1–7 per axle. A stiffer bar takes more of the load transfer on that axle, which then grips less: stiffer front = understeer, stiffer rear = oversteer.</td></tr>
    <tr><th>Dampers</th><td>Bump and rebound, clicks 1–7 (±30 %). Stiffer reacts faster but lets the tyre skip over bumps and kerbs.</td></tr>
    <tr><th>Fuel</th><td>With the fuel rule: your load for the start. Each litre is weight.</td></tr>
  </tbody></table>
  <h2>Where to start</h2>
  <ul><li>Understeer in slow corners: soften the front bar or stiffen the rear one a click.</li><li>Unstable on the brakes: move the brake balance forward.</li><li>Slow on the straights: less wing; sliding in fast corners: more.</li><li>Bottoming out over kerbs: raise the ride height or stiffen the bump.</li></ul>
  </div></section>`,
);

// DISCIPLINES
sub(
  'disciplines.html',
  'Features',
  'Racing disciplines',
  'GT3 sprint races, endurance with fuel and mandatory stops, timed races and championships in GridCorsa.',
  { img: photo('straight', 'spa'), eyebrow: 'Features', title: 'Racing disciplines', lead: 'From a five-lap sprint to an hour with fuel and a driver change.' },
  `<section class="sec"><div class="wrap grid g2">
    <div class="step"><div class="n">SPRINT</div><h3>GT3 sprint</h3><p>Qualifying for the grid, then 3 to 15 laps. Pure pace and racecraft, with car contact on or off.</p></div>
    <div class="step"><div class="n">ENDURANCE</div><h3>Endurance</h3><p>Timed races of up to an hour with fuel that burns and must be refilled, tyres that wear, and a mandatory stop in the pit window, as in GT World Challenge.</p></div>
    <div class="step"><div class="n">WEEKEND</div><h3>Race weekend</h3><p>Free practice, qualifying and the race, in changing weather and time of day.</p></div>
    <div class="step"><div class="n">SEASON</div><h3>Championship</h3><p>A season against the AI on every circuit, points as in Formula 1 for the top ten, standings after every round.</p></div>
  </div><div class="wrap" style="margin-top:30px">${playBtn('Start a race')}</div></section>`,
);

// WEATHER
sub(
  'weather.html',
  'Features',
  'Weather system',
  'Six kinds of weather, every time of day, forecasts that change, tyres and engines that feel the temperature.',
  {
    img: photo('straight', 'zandvoort'),
    eyebrow: 'Features',
    title: 'Weather system',
    lead: 'The same forecast for every driver in the room, and a track that changes with it.',
  },
  `<section class="sec"><div class="wrap prose">
  <h2>Weather</h2>
  <p>Clear, cloudy, overcast, light rain, heavy rain and fog, or random. With changes on, the forecast can turn during a session: rain arriving mid-race or a track drying out. Every driver in the room sees the same forecast, worked out from the same seed.</p>
  <h2>Time of day</h2>
  <p>Dawn, morning, midday, afternoon, evening or night, with the sun and shadows where they would be. Headlights come on in the dark, the fog and the rain.</p>
  <h2>Grip</h2>
  <ul><li>Water on the track lowers grip, more for slicks than for wets; kerbs and paint are worse.</li><li>Rubber laid on the racing line raises grip through a dry session; rain washes it away.</li><li>Choose the right compound: slicks need heat, wets cool down on a drying track.</li></ul>
  <h2>Temperatures</h2>
  <p>Air and track temperatures follow the weather and the sun. A hot track heats the tyres, cold air slows their warm-up, and thin or hot air costs a naturally aspirated engine its power.</p>
  <p>${btn('/features#weather', 'Tyre compounds')}</p>
  </div></section>`,
);

// AI RACING
sub(
  'ai-racing.html',
  'Features',
  'AI racing',
  'GridCorsa AI drivers: six bot levels from Rookie to Alien, clean racecraft, pit stops and wet-weather tyres.',
  { img: photo('grid', 'zandvoort'), eyebrow: 'Features', title: 'AI racing', lead: 'Bots that race like people: fast, fair, and as good as you choose.' },
  `<section class="sec"><div class="wrap prose">
  <h2>Bot levels</h2>
  <p>Set for each race in the lobby’s Rules: the share of the car’s grip the bots plan their corners and braking with. Each bot drives a little under the level so they spread out over a lap.</p>
  <div class="lic">${[
    ['82%', 'Rookie'],
    ['88%', 'Amateur'],
    ['93%', 'Club'],
    ['97%', 'Pro'],
    ['101%', 'Elite'],
    ['105%', 'Alien'],
  ]
    .map(([p, n], i) => `<div style="--lc:hsl(${210 - i * 38} 70% 52%)"><b>${p}</b><span>${n}</span></div>`)
    .join('')}</div>
  <h2>Racecraft</h2>
  <ul>
    <li>A car alongside is a wall a car’s width away: they leave you room and lift rather than turn in on you.</li>
    <li>A faster car coming up on one side keeps that side: no closing the door.</li>
    <li>They brake for the car ahead from its stopping distance, not at the last moment.</li>
    <li>They pass slower cars in the slipstream and finish the move on the brakes.</li>
    <li>No overtaking under yellow flags or the safety car.</li>
  </ul>
  <h2>Driving</h2>
  <p>They follow a racing line computed for each layout, at speeds planned from their car’s grip and downforce, trail-brake into corners, catch slides, and back off the throttle when the rear lets go. They pit when the rules ask for it, and start on wets when the forecast says rain.</p>
  <h2>Fill the grid</h2>
  <p>Add them in any lobby, solo or online: they are simulated on the host’s computer and race everyone in the room. Online, a room nobody joins in 15 seconds fills itself with bots.</p>
  <p>${playBtn('Race the AI')}</p>
  </div></section>`,
);

// SPECTATING
sub(
  'spectating.html',
  'Features',
  'Spectating & TV',
  'Watch live races, TV cameras, the timing screen and a ghost of your best lap in GridCorsa.',
  { img: photo('aerial', 'spa'), eyebrow: 'Features', title: 'Spectating & TV', lead: 'Watch your friends race, or yourself on TV.' },
  `<section class="sec"><div class="wrap grid g2">
    <div class="step"><h3>Watch a race</h3><p>Every public session and every room you have the code for can be watched live, from the online list or a friend’s card.</p></div>
    <div class="step"><h3>TV cameras</h3><p>Trackside cameras follow the action like a broadcast; switch to them at any time with <kbd>T</kbd>, and see your pit stop from the crew’s side.</p></div>
    <div class="step"><h3>Timing screen</h3><p>Hold <kbd>Tab</kbd> for the full timing: positions, gaps, best laps, tyres and penalties.</p></div>
    <div class="step"><h3>Ghost car</h3><p>Your best valid lap drives with you as a translucent ghost to chase.</p></div>
  </div></section>`,
);

// KEYBOARD SHORTCUTS
sub(
  'keyboard-shortcuts.html',
  'Multimedia',
  'Keyboard shortcuts',
  'Every keyboard shortcut in GridCorsa.',
  { img: photo('pole', 'spa'), eyebrow: 'Multimedia', title: 'Keyboard shortcuts', lead: 'The default keys; change any of them in Settings → Controls.' },
  `<section class="sec"><div class="wrap prose">
  <h2>Driving</h2><div class="keys">${KEYS.slice(0, 6)
    .map(([a, ks]) => `<div><span>${esc(a)}</span><span>${ks.map((k) => `<kbd>${esc(k)}</kbd>`).join(' ')}</span></div>`)
    .join('')}<div><span>Manual / automatic gearbox</span><span><kbd>M</kbd></span></div></div>
  <h2>Views & information</h2><div class="keys">${KEYS.slice(6, 11)
    .map(([a, ks]) => `<div><span>${esc(a)}</span><span>${ks.map((k) => `<kbd>${esc(k)}</kbd>`).join(' ')}</span></div>`)
    .join('')}</div>
  <h2>Race</h2><div class="keys"><div><span>Reset to the track</span><span><kbd>R</kbd></span></div><div><span>Pause menu</span><span><kbd>Esc</kbd></span></div><div><span>Skip the intro</span><span><kbd>Enter</kbd></span></div></div>
  <div class="callout">Keys can have two bindings each. Keyboard throttle, brake and steering are smoothed: set how fast they respond in Settings → Controls.</div>
  </div></section>`,
);

// ACCOUNT
sub(
  'account.html',
  'Account',
  'What comes with an account',
  'A free GridCorsa account: online racing, friends, lap records, your driver profile and online career.',
  {
    img: photo('grid', 'spa'),
    eyebrow: 'Account',
    title: 'Free. And it stays free.',
    lead: 'A nickname and a password, nothing else: no e-mail, no card.',
    ctas: playBtn('Create your account'),
  },
  `<section class="sec"><div class="wrap grid g3">
    <div class="step"><h3>Online racing</h3><p>Create and join rooms, Quick Match into public lobbies, watch live races.</p></div>
    <div class="step"><h3>Friends</h3><p>See who is online and where, join their lobbies, chat in the room.</p></div>
    <div class="step"><h3>Lap records</h3><p>Your best laps on every layout, on the <a href="/leaderboards">leaderboards</a> for everyone or just your friends.</p></div>
    <div class="step"><h3>Driver profile</h3><p>Your flag, number, three-letter code and helmet on the timing screens.</p></div>
    <div class="step"><h3>Online career</h3><p>Starts, wins, podiums, poles and laps, with your personal bests.</p></div>
    <div class="step"><h3>Yours to delete</h3><p>Delete your account from the game at any time, with everything in it.</p></div>
  </div>
  <div class="wrap prose" style="margin-top:40px"><h2>Without an account</h2><p>Solo races, championships, the garage, your local career and races hosted on your own device for friends on the same Wi-Fi all work without one.</p></div></section>`,
);

// WHEELS & CONTROLLERS
sub(
  'wheels-controllers.html',
  'Account',
  'Wheels & controllers',
  'Steering wheels with soft lock per car, Xbox, PlayStation and Switch Pro controllers, keyboard settings.',
  { img: photo('straight', 'nurburgring'), eyebrow: 'Account', title: 'Wheels & controllers', lead: 'Plug in and drive: GridCorsa recognises them for you.' },
  `<section class="sec"><div class="wrap layout-side">${sideToc([
    ['wheel', 'Steering wheels'],
    ['pad', 'Controllers'],
    ['keys', 'Keyboard'],
  ])}<div class="prose">
  <h2 id="wheel">Steering wheels</h2>
  <p>Wheels the browser reports are recognised automatically. Set your wheel base’s rotation in Settings (the same as in its own software; 900° is what the sims recommend) and each car steers with its real lock: the game uses only that part of your wheel’s rotation, with no filters in between. The pedals are linear, with a curve for the brake.</p>
  <table class="spec"><tbody>${[...new Set(cars.map((c) => c.manufacturer))]
    .sort()
    .map((m) => {
      const c = cars.find((x) => x.manufacturer === m);
      return `<tr><th>${esc(m)}</th><td>${lockOf(c.id)}° lock to lock</td></tr>`;
    })
    .join('')}</tbody></table>
  <h2 id="pad">Controllers</h2>
  <p>Xbox, PlayStation and Switch Pro controllers work on connection: triggers for throttle and brake, the left stick to steer, the bumpers to shift. Adjust the dead zone, steering curve and speed, speed sensitivity, brake curve, trigger dead zones and saturation, and rumble. Buttons can be remapped.</p>
  <h2 id="keys">Keyboard</h2>
  <p>Choose how long the throttle and brake take from nothing to full (a tap gives part of it) and how fast the steering turns. A slip-limited steering filter keeps the front tyres at their best angle. See the <a href="/keyboard-shortcuts">keyboard shortcuts</a>.</p>
  </div></div></section>`,
);

// SPORTING CODE
sub(
  'sporting-code.html',
  'Account',
  'Sporting code',
  'The GridCorsa sporting code: track limits, penalties, flags, full-course yellow, the safety car, blue flags and pit stops.',
  {
    img: photo('grid', 'nurburgring'),
    eyebrow: 'Account',
    title: 'Sporting code',
    lead: 'The rules of every race, after SRO’s GT World Challenge procedures.',
  },
  `<section class="sec"><div class="wrap layout-side">${sideToc([
    ['limits', 'Track limits'],
    ['penalties', 'Penalties'],
    ['flags', 'Flags & safety car'],
    ['pits', 'Pit stops'],
    ['finish', 'The finish'],
    ['conduct', 'Conduct'],
  ])}<div class="prose">
  <h2 id="limits">Track limits</h2>
  <p>The white lines define the track. A car with all four wheels beyond them has left it, and the lap does not count as a fastest lap. In the race, three warnings come first, then a 5-second penalty; cutting a corner to gain time is penalised at once. A car pushed off by another car within the previous 12 seconds is not penalised.</p>
  <h2 id="penalties">Penalties</h2>
  <table class="spec"><tbody>
    <tr><th>Track limits, after 3 warnings</th><td>+5 s</td></tr>
    <tr><th>Cutting a corner (time gained)</th><td>+5 s, or +10 s for a gain of more than 2 s or a cut of more than 60 m of track</td></tr>
    <tr><th>Reset to the track</th><td>Lap deleted in practice and qualifying; +5 s in the race</td></tr>
    <tr><th>Overtaking under yellow, FCY or safety car</th><td>Drive-through, unless the place is given back within 8 s</td></tr>
    <tr><th>Ignoring blue flags for 25 s</th><td>Drive-through</td></tr>
    <tr><th>Drive-through not served within 3 laps</th><td>Its time cost plus 10 s added to the race time</td></tr>
    <tr><th>No stop in the pit window</th><td>+90 s</td></tr>
  </tbody></table>
  <h2 id="flags">Flags & safety car</h2>
  <ul>
    <li><b>Yellow flag</b> – a car has stopped on track: from 250 m before it, no overtaking.</li>
    <li><b>Full-course yellow</b> – a car stopped for 12 s: after a 10 s warning, 80 km/h for everyone, single file, no overtaking.</li>
    <li><b>Safety car</b> – if the incident lasts 40 s more, two or more cars are stopped, or one is badly damaged: it joins ahead of the leader, everyone queues behind it, and it stays out at least 75 s. The race restarts when the leader crosses the line after it has pulled into the pits.</li>
    <li><b>Blue flag</b> – a car about to be lapped with the leader within 80 m must let it by.</li>
    <li>A car slower than about 43 km/h (one with a problem) may be passed under a caution.</li>
  </ul>
  <h2 id="pits">Pit stops</h2>
  <p>Respect the pit lane speed limit. With the mandatory stop rule, every car stops once with a driver change inside the pit window: from 40 % to 60 % of the laps, or in a timed race from 25:00 to 34:59 of an hour (the same shares of any length), standing at least 20 seconds in the box.</p>
  <h2 id="finish">The finish</h2>
  <p>After the winner of a race by laps takes the flag, the others finish the lap they are on. A timed race ends with the leader’s first crossing after the time is up.</p>
  <h2 id="conduct">Conduct</h2>
  <p>Race hard and fair: leave a car’s width to a car alongside, do not move across a faster car that is already there, and rejoin the track safely. Contact and resets count against your Safety Rating (see <a href="/licences">licences & ratings</a>).</p>
  </div></div></section>`,
);

// LEGAL
sub(
  'legal.html',
  'Account',
  'Legal & privacy',
  'GridCorsa terms of use, privacy and trademarks.',
  { img: photo('aerial', 'zandvoort'), eyebrow: 'Account', title: 'Legal & privacy', lead: 'Short and plain.' },
  `<section class="sec"><div class="wrap prose">
  <h2>Terms of use</h2>
  <p>GridCorsa is free to play and provided as it is, without warranties. Race fairly: cheating, abusive nicknames or chat and deliberately wrecking other drivers can get an account removed. Online services may change or be paused for maintenance.</p>
  <h2 id="privacy">Privacy</h2>
  <ul>
    <li><b>Playing solo</b> sends nothing to a server; your settings, garage, career and history stay in your browser.</li>
    <li><b>An account</b> stores your nickname, a salted hash of your password (PBKDF2), your driver profile, friends, online results and lap records.</li>
    <li><b>Online races</b> pass your car’s position and your chat lines to the other drivers in the room.</li>
    <li>No adverts, no analytics, no tracking cookies. Fonts are loaded from Google Fonts.</li>
    <li>You can delete your account, and everything in it, from the game.</li>
  </ul>
  <h2>Trademarks</h2>
  <p>Car makes, models and liveries, team names and circuit names belong to their owners. They are used only to identify the real cars and places the game recreates. GridCorsa is an independent game and is not affiliated with or endorsed by any of them.</p>
  </div></section>`,
);

// TROUBLESHOOTING
sub(
  'troubleshooting.html',
  'Support',
  'Troubleshooting',
  'Fix performance, controller, wheel, sound and connection problems in GridCorsa.',
  { img: photo('pole', 'nurburgring'), eyebrow: 'Support', title: 'Troubleshooting', lead: 'The usual problems and how to fix them.' },
  `<section class="sec"><div class="wrap" style="max-width:900px">${[
    [
      'The game is slow or stutters',
      'Lower the preset in Settings → Graphics, or the resolution scale; keep dynamic resolution on. Make sure hardware acceleration is on in your browser, close other tabs, and on a laptop plug it in and choose the high-performance graphics card.',
    ],
    [
      'The screen went black or the game says the graphics were lost',
      'The browser reset the graphics card (another app, a driver update or sleep). The game restores itself; if it does not, reload the page.',
    ],
    [
      'My controller does nothing',
      'Press a button with the game’s tab in focus: browsers only show a controller after it has been used. Check Settings → Controller for the layout and dead zone.',
    ],
    [
      'My wheel turns too much or too little',
      'Set your wheel base’s rotation in Settings to the same value as in its own software. The game then uses each car’s real lock.',
    ],
    ['There is no sound', 'Browsers allow sound only after you click or press a key on the page: click once. Check the levels in Settings → Sound.'],
    ['I cannot join a room', 'Online rooms need an account. Check the five-letter code; a race already running lets you join the next session or watch.'],
    [
      'My settings and career are gone',
      'They are kept in the browser: clearing its data, or a private window, starts again. Online results stay with your account.',
    ],
  ]
    .map(([q, a]) => `<details class="faq"><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`)
    .join('')}<p style="margin-top:30px">${btn('/faq', 'FAQ', 'btn-light')}</p></div></section>`,
);

// LIVE
const layoutNames = Object.fromEntries(layouts.map((l) => [l.id, l.name]));
sub(
  'live.html',
  'Live',
  'Live sessions',
  'Public GridCorsa races happening right now: join or watch.',
  {
    img: photo('grid', 'spa'),
    eyebrow: 'Live',
    title: 'Live sessions',
    lead: 'Public races right now. Join one, watch one, or start your own.',
    ctas: playBtn('Quick match'),
  },
  `<section class="sec"><div class="wrap"><div class="sec-head"><div><h2>Racing now</h2><p>Refreshed every 15 seconds.</p></div></div>
  <div class="grid g3" data-live data-server="${SERVER}" data-tracks='${esc(JSON.stringify(layoutNames))}'><p class="muted">Looking for public sessions…</p></div></div></section>`,
);

// LEADERBOARDS
sub(
  'leaderboards.html',
  'Live',
  'Leaderboards',
  'The fastest laps on every GridCorsa layout, dry and wet, by car.',
  { img: photo('pole', 'spa'), eyebrow: 'Live', title: 'Leaderboards', lead: 'The best lap of every driver on every layout, set in online sessions.' },
  `<section class="sec"><div class="wrap">
  <div class="filters" data-board data-server="${SERVER}" data-cars='${esc(JSON.stringify(Object.fromEntries(cars.map((c) => [c.id, c.name]))))}'>
    <select data-k="track" aria-label="Layout">${layouts.map((l) => `<option value="${l.id}"${l.map === 'spa' ? ' selected' : ''}>${esc(l.name)}</option>`).join('')}</select>
    <select data-k="car" aria-label="Car"><option value="">All cars</option>${cars.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select>
    <select data-k="wet" aria-label="Conditions"><option value="">Dry</option><option value="1">Wet</option></select>
  </div>
  <div class="board-wrap"><table class="spec board"><thead><tr><th>#</th><th>Driver</th><th>Car</th><th>Lap</th><th>Sectors</th><th>Laps</th><th>Set</th><th></th></tr></thead><tbody data-rows><tr><td colspan="8">Loading…</td></tr></tbody></table></div>
  </div></section>`,
);

// TELEMETRY: a driver's best lap on the map, with speed, pedals, steering and gear, against another
mkdirSync(path.join(out, 'site/tracks'), { recursive: true });
for (const l of layouts) {
  const td = JSON.parse(readFileSync(path.join(pub, l.file.replace(/\?.*$/, '')), 'utf8'));
  const cl = td.centerline;
  const n = cl.length / 3;
  const step = Math.max(1, Math.round(n / 1500));
  const pts = [];
  for (let i = 0; i < n; i += step) pts.push(Math.round(cl[i * 3] * 4) / 4, Math.round(cl[i * 3 + 2] * 4) / 4);
  writeFileSync(path.join(out, `site/tracks/${l.id}.json`), JSON.stringify({ id: l.id, name: l.name, length: l.length, pts }));
}
sub(
  'telemetry.html',
  'Live',
  'Telemetry',
  'Every driver’s best lap on the map: speed, throttle, brake, steering and gear, lap against lap, to see where the time is.',
  {
    img: photo('pole', 'spa'),
    eyebrow: 'Live',
    title: 'Telemetry',
    lead: 'The best lap of every driver on every layout, metre by metre. Pick a lap, compare it with another and see where the time goes.',
  },
  `<section class="sec"><div class="wrap">
  <div class="filters tm-pick" data-tm data-server="${SERVER}" data-cars='${esc(JSON.stringify(Object.fromEntries(cars.map((c) => [c.id, c.name]))))}'>
    <select data-k="track" aria-label="Layout">${layouts.map((l) => `<option value="${l.id}"${l.map === 'spa' ? ' selected' : ''}>${esc(l.name)}</option>`).join('')}</select>
    <select data-k="wet" aria-label="Conditions"><option value="">Dry</option><option value="1">Wet</option></select>
    <label class="tm-lap a"><span>Lap A</span><select data-k="a" aria-label="Lap A"></select></label>
    <label class="tm-lap b"><span>Compare with</span><select data-k="b" aria-label="Lap B"></select></label>
  </div>
  <p class="tm-msg" data-msg>Loading the laps…</p>
  <div class="tm" data-view hidden>
    <div class="tm-left">
      <div class="tm-map"><canvas data-map></canvas><div class="tm-legend"><span>slow</span><i></i><span>fast</span></div></div>
      <div class="tm-read" data-read></div>
      <div class="tm-sectors" data-sectors></div>
    </div>
    <div class="tm-charts" data-charts></div>
  </div>
  <div class="callout" style="margin-top:30px"><b>How it works:</b> when you set a personal best in an online session, the game sends that lap’s telemetry with it. The server keeps it only for a lap it timed itself, and only your best on each layout in the dry and in the wet. Move over a chart or the map to see every value at that point.</div>
  </div></section>
  <script src="/site/telemetry.js" defer></script>`,
);

// DRIVERS: look up any driver's online career
sub(
  'drivers.html',
  'Live',
  'Driver lookup',
  'Look up any GridCorsa driver: starts, wins, podiums, poles, laps and their best lap on every layout.',
  { img: photo('grid', 'zandvoort'), eyebrow: 'Live', title: 'Driver lookup', lead: 'Every online driver’s career: results, best laps and telemetry.' },
  `<section class="sec"><div class="wrap">
  <div class="filters" data-drivers data-server="${SERVER}" data-tracks='${esc(JSON.stringify(layoutNames))}' data-cars='${esc(JSON.stringify(Object.fromEntries(cars.map((c) => [c.id, c.name]))))}'>
    <input type="search" placeholder="Search a nickname (2 letters or more)" data-q aria-label="Nickname" />
  </div>
  <div class="grid g4" data-found></div>
  <div data-driver></div>
  </div></section>`,
);

// DRIVING SCHOOL
sub(
  'driving-school.html',
  'Multimedia',
  'Driving school',
  'How to drive a GT3 car fast: braking, trail braking, the racing line, corner types, throttle, tyres, the wet, racecraft.',
  {
    img: photo('straight', 'spa'),
    eyebrow: 'Multimedia',
    title: 'Driving school',
    lead: 'The technique behind a fast lap, from your first braking point to wheel-to-wheel racing.',
  },
  `<section class="sec"><div class="wrap layout-side">${sideToc([
    ['braking', 'Braking'],
    ['trail', 'Trail braking'],
    ['line', 'The racing line'],
    ['corners', 'Corner types'],
    ['throttle', 'Throttle'],
    ['tyres', 'Tyres'],
    ['wet', 'In the wet'],
    ['racecraft', 'Racecraft'],
    ['practice', 'Getting faster'],
  ])}<div class="prose">
  <h2 id="braking">Braking</h2>
  <p>A GT3 car stops from 250 km/h in about 100 metres. Brake hard and early in the stop, when the downforce is highest, then ease off as the car slows. ABS lets you stand on the pedal, but it is not free time: braking too late costs more on the exit than it gains on entry.</p>
  <ul><li>Pick a fixed reference for each braking point: a board, a kerb, a shadow.</li><li>Move it later a few metres at a time; when you miss the apex, you have gone too far.</li><li>The racing line turns red when you arrive too fast for the corner.</li></ul>
  <h2 id="trail">Trail braking</h2>
  <p>Do not let go of the brake all at once as you turn in. Release it gradually as you add steering: the load stays on the front tyres, the car turns, and you can brake later. Be off the brake before the apex, so the tyres can use all their grip to corner.</p>
  <div class="callout">Trail braking matters most in slow corners, where you want the car to rotate. In fast corners, brake less and earlier and keep the rear settled.</div>
  <h2 id="line">The racing line</h2>
  <p>The fastest way round is the widest arc: outside on entry, the apex on the inside, all the way out on the exit. A wider arc means less steering, and less steering means more speed. Use every metre of the track up to the white lines; beyond them the lap does not count.</p>
  <h2 id="corners">Corner types</h2>
  <ul>
    <li><b>Slow corners before a straight</b>: brake in a straight line, turn in late, apex late, and be on the power early. The exit speed carries all the way down the straight.</li>
    <li><b>Fast corners</b>: an earlier apex and smoother, slower steering; carry the speed rather than braking late.</li>
    <li><b>Chicanes</b>: sacrifice the first part to get the second part right; straighten the line over the kerbs where you can.</li>
    <li><b>Sequences</b>: the corner before a long straight matters most; set up the earlier corners for it.</li>
  </ul>
  <h2 id="throttle">Throttle</h2>
  <p>Squeeze the throttle on, do not stamp on it. Open the steering as you open the throttle: the more lock you have on, the less throttle the rear tyres can take. Traction control helps, but every time it cuts in you are losing drive.</p>
  <h2 id="tyres">Tyres</h2>
  <p>Cold tyres slide. On your out lap, push gradually and watch the tyre panel turn from blue to green. Too much sliding overheats them (orange, red) and they grip less until they cool down. Over a long run, a smooth driver keeps the tyres in their window and the lap times flat.</p>
  <h2 id="wet">In the wet</h2>
  <p>Brake earlier and gentler, turn in more smoothly, and avoid the painted lines and kerbs. Try a line off the rubbered racing line, where the grip can be better in the rain. Use wet tyres when the track is properly wet; slicks again when a dry line appears.</p>
  <h2 id="racecraft">Racecraft</h2>
  <ul>
    <li><b>Overtaking</b>: follow closely on the straight to use the slipstream, pull out before the braking zone and finish the move on the brakes, on the inside.</li>
    <li><b>Defending</b>: one move to cover the inside, before the braking zone; never move across a car that is already alongside.</li>
    <li><b>Side by side</b>: leave a car’s width. Lift rather than turn into the other car.</li>
    <li><b>Lapped cars</b>: under a blue flag, let the leaders by on a straight.</li>
  </ul>
  <h2 id="practice">Getting faster</h2>
  <ul>
    <li>Race your ghost: your best lap drives with you, and the delta bar shows where you gain and lose.</li>
    <li>Compare your telemetry with faster drivers on the <a href="/telemetry">telemetry page</a>: where do they brake, how much speed do they carry, when are they back on the throttle?</li>
    <li>One corner at a time. Consistency first, then pace.</li>
  </ul>
  <p>${playBtn('Put it into practice')}</p>
  </div></div></section>`,
);

// GLOSSARY
const GLOSSARY = [
  ['Apex', 'The innermost point of your line through a corner.'],
  ['ABS', 'Anti-lock braking: keeps the wheels from locking so you can brake hard and still steer.'],
  ['Blue flag', 'Shown to a car about to be lapped: let the faster car through.'],
  ['Brake balance', 'The share of braking force on the front axle.'],
  ['Delta', 'The time you are gaining or losing against your best lap at the same point.'],
  ['Dirty air', 'The turbulent wake behind a car: less downforce, so less grip in corners.'],
  ['Downforce', 'Aerodynamic force pressing the car onto the road, growing with speed.'],
  ['Drive-through', 'A penalty served by driving through the pit lane at the speed limit.'],
  ['FCY', 'Full-course yellow: everyone slows to 80 km/h, no overtaking.'],
  ['Ghost', 'A translucent replay of your best lap that drives with you.'],
  ['GT3', 'The international category of racing cars based on road cars, balanced to race each other.'],
  ['Out lap', 'The first lap out of the pits: not timed, used to warm the tyres.'],
  ['Oversteer', 'The rear of the car slides more than the front: the car turns more than you ask.'],
  ['Pit window', 'The part of the race in which the mandatory stop must be made.'],
  ['Safety car', 'A car that leads the field at reduced speed while an incident is cleared.'],
  ['Safety Rating', 'A measure of how cleanly you drive: corners per incident.'],
  ['Sector', 'One of the three parts a lap is timed in.'],
  ['Slipstream', 'The tow behind another car on a straight: less drag, more speed.'],
  ['TC', 'Traction control: cuts power when the driven wheels spin.'],
  ['Track limits', 'The white lines; all four wheels beyond them and you have left the track.'],
  ['Trail braking', 'Easing off the brake gradually while turning in.'],
  ['Understeer', 'The front of the car slides more than the rear: the car turns less than you ask.'],
];
sub(
  'glossary.html',
  'Multimedia',
  'Glossary',
  'Sim racing terms explained: apex, delta, dirty air, FCY, slipstream, trail braking and more.',
  { img: photo('aerial', 'spa'), eyebrow: 'Multimedia', title: 'Glossary', lead: 'The words of the paddock, explained.' },
  `<section class="sec"><div class="wrap" style="max-width:900px"><table class="spec"><tbody>${GLOSSARY.map(([w, d]) => `<tr><th id="${slug(w)}">${esc(w)}</th><td>${esc(d)}</td></tr>`).join('')}</tbody></table></div></section>`,
);

// PRESS
sub(
  'press.html',
  'About',
  'Press kit',
  'GridCorsa press kit: fact sheet, description, screenshots and logo.',
  { img: photo('hero', 'spa'), eyebrow: 'About', title: 'Press kit', lead: 'Everything you need to write about GridCorsa.' },
  `<section class="sec"><div class="wrap grid g2" style="gap:40px">
  <div class="prose"><h2>Fact sheet</h2><table class="spec"><tbody>
    <tr><th>Name</th><td>GridCorsa</td></tr>
    <tr><th>Genre</th><td>Racing simulation (GT3)</td></tr>
    <tr><th>Platforms</th><td>Web browser (Windows, macOS, Linux), Android</td></tr>
    <tr><th>Price</th><td>Free</td></tr>
    <tr><th>Players</th><td>1 offline; up to 12 online</td></tr>
    <tr><th>Content</th><td>${cars.length} GT3 cars, ${CIRCUITS.length} circuits, ${layouts.length} layouts</td></tr>
    <tr><th>Languages</th><td>English, Spanish</td></tr>
    <tr><th>First released</th><td>17 October 2026</td></tr>
  </tbody></table></div>
  <div class="prose"><h2>Description</h2><p><b>Short:</b> GT3 sim racing in your browser: real cars, real circuits, free.</p><p><b>Long:</b> GridCorsa is a free racing simulation that runs in the browser. Twenty GT3 race cars, Spa-Francorchamps, the Nürburgring with the Nordschleife and Zandvoort, tyre and vehicle physics, changing weather, pit stops and race control, AI drivers from Rookie to Alien, and online races for up to twelve drivers with friends, licences and leaderboards.</p>
  <h2>Logo</h2><p><span class="brand" style="font-size:2.4rem">GRID<b>CORSA</b></span></p><p>The wordmark: “GRID” in white, “CORSA” in white on a slanted red block (#E3183D), condensed capitals.</p></div>
  </div>
  <div class="wrap" style="margin-top:40px"><h2>Screenshots</h2><div class="gallery">${CIRCUITS.flatMap((c) => ['hero', 'grid'].map((s) => `<a href="${photo(s, c.photoMap)}" aria-label="${esc(c.short)}" style="background-image:url('${photo(s, c.photoMap)}')"></a>`)).join('')}</div></div></section>`,
);

// STATUS
sub(
  'status.html',
  'Support',
  'Service status',
  'Is GridCorsa online? The game server and the website, live.',
  { img: photo('pole', 'nurburgring'), eyebrow: 'Support', title: 'Service status', lead: 'Checked live from your browser.' },
  `<section class="sec"><div class="wrap grid g3" data-status data-server="${SERVER}">
    <div class="step" data-svc="site"><h3>Website</h3><p class="st">Online</p><p>You are reading it.</p></div>
    <div class="step" data-svc="server"><h3>Game server</h3><p class="st">Checking…</p><p data-ms></p></div>
    <div class="step" data-svc="rooms"><h3>Online races</h3><p class="st">Checking…</p><p data-n></p></div>
  </div><div class="wrap prose" style="margin-top:30px"><p>Solo races work even when the game server is down: they run in your browser.</p></div></section>`,
);

/* ------------------------------------------------------------------------------------------------- files */
mkdirSync(path.join(out, 'site'), { recursive: true });
copyFileSync(path.join(here, 'site.css'), path.join(out, 'site/site.css'));
copyFileSync(path.join(here, 'site.js'), path.join(out, 'site/site.js'));
copyFileSync(path.join(here, 'telemetry.js'), path.join(out, 'site/telemetry.js'));
copyFileSync(path.join(here, 'vercel.json'), path.join(out, 'vercel.json'));
console.log(`website: ${cars.length} car pages, ${CIRCUITS.length} circuit pages and the rest → ${path.relative(root, out)}`);
