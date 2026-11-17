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
    label: 'The Game',
    href: '/features',
    sub: [
      ['/features', 'Features', 'Physics, weather, pit stops, AI'],
      ['/cars', 'Cars', `${cars.length} GT3 race cars`],
      ['/tracks', 'Circuits', `${CIRCUITS.length} circuits, ${layouts.length} layouts`],
      ['/licences', 'Licences & ratings', 'Safety Rating, levels, achievements'],
    ],
  },
  {
    label: 'Racing',
    href: '/online',
    sub: [
      ['/online', 'Online racing', 'Rooms, quick match, friends'],
      ['/online#weekend', 'Race weekends', 'Practice, qualifying, race'],
      ['/online#solo', 'Solo & championship', 'Race the AI offline'],
      ['/features#ai', 'Bot levels', 'From Rookie to Alien'],
    ],
  },
  {
    label: 'Getting Started',
    href: '/getting-started',
    sub: [
      ['/getting-started', 'New racer guide', 'Your first race in minutes'],
      ['/getting-started#controls', 'Controls', 'Keyboard, controller, wheel'],
      ['/getting-started#requirements', 'System requirements', 'What your computer needs'],
      ['/faq', 'FAQ & support', 'Answers to common questions'],
    ],
  },
  { label: 'News', href: '/news' },
  { label: 'Media', href: '/media' },
  { label: 'Download', href: '/download' },
];

function page({ file, title, desc, body, active = '' }) {
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
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700;800&family=Barlow:wght@400;500;600&display=swap" rel="stylesheet" />
<link rel="stylesheet" href="/site/site.css" />
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="site-head">
  <div class="util"><div class="wrap"><span>Free GT3 sim racing in your browser · no download</span><nav><a href="/faq">Support</a><a href="/download">Download</a><a href="/play/">Sign in</a></nav></div></div>
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
      <div><h4>The Game</h4><ul><li><a href="/features">Features</a></li><li><a href="/cars">Cars</a></li><li><a href="/tracks">Circuits</a></li><li><a href="/licences">Licences & ratings</a></li></ul></div>
      <div><h4>Racing</h4><ul><li><a href="/online">Online racing</a></li><li><a href="/online#weekend">Race weekends</a></li><li><a href="/online#solo">Solo & championship</a></li><li><a href="/features#ai">Bot levels</a></li></ul></div>
      <div><h4>Resources</h4><ul><li><a href="/getting-started">New racer guide</a></li><li><a href="/getting-started#controls">Controls</a></li><li><a href="/getting-started#requirements">System requirements</a></li><li><a href="/faq">FAQ & support</a></li></ul></div>
      <div><h4>Quick links</h4><ul><li><a href="/play/">Play in the browser</a></li><li><a href="/download">Android app</a></li><li><a href="/news">News & updates</a></li><li><a href="/media">Screenshots</a></li></ul></div>
    </div>
    <div class="legal">
      <p>© 2026 GridCorsa. Car makes, models and liveries, team names and circuit names belong to their owners; they are used only to identify the real cars and places the game recreates. GridCorsa is an independent game and is not affiliated with or endorsed by them.</p>
      <p><a href="/faq#privacy">Privacy</a> · <a href="/faq">Help</a></p>
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
  <div class="hero-img" style="--img:url('${img}')"></div>
  <div class="wrap hero-in">
    ${eyebrow ? `<span class="eyebrow">${esc(eyebrow)}</span>` : ''}
    <h1>${title}</h1>
    ${lead ? `<p class="lead">${lead}</p>` : ''}
    ${ctas ? `<div class="cta-row">${ctas}</div>` : ''}
    ${badges.length ? `<div class="badges">${badges.map((b) => `<span>${esc(b)}</span>`).join('')}</div>` : ''}
  </div>
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

// HOME
page({
  file: 'index.html',
  title: 'GridCorsa · GT3 sim racing in your browser',
  desc: 'Race 20 real GT3 cars at Spa, the Nürburgring and Zandvoort, free in your browser. Online with friends or against the AI, with real physics, weather, pit stops and race control.',
  body: `
${hero({
  img: photo('hero', 'spa'),
  eyebrow: 'GT3 sim racing · free in your browser',
  title: 'The grid is waiting',
  lead: 'Twenty real GT3 cars, three legendary circuits, real physics. Race your friends online or the AI on your own, with nothing to download: open it and drive.',
  ctas: `${playBtn()}${btn('/features', 'Explore the game')}`,
  badges: ['Free to play', 'No download', `${cars.length} GT3 cars`, `${layouts.length} layouts`, 'Up to 12 drivers'],
})}
<section class="sec">
  <div class="wrap">
    <div class="stats">
      <div><b>${cars.length}</b><span>GT3 race cars</span></div>
      <div><b>${CIRCUITS.length}</b><span>Circuits · ${layouts.length} layouts</span></div>
      <div><b>12</b><span>Drivers per race</span></div>
      <div><b>0</b><span>Downloads needed</span></div>
    </div>
  </div>
</section>
<section class="sec alt">
  <div class="wrap">
    <div class="sec-head"><div><span class="eyebrow">Latest news</span><h2>What’s new</h2></div><a class="link-more" href="/news">All news →</a></div>
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
    <div class="sec-head"><div><span class="eyebrow">The cars</span><h2>Drive ${cars.length} of today’s GT3 racers</h2><p>Porsche, Ferrari, Lamborghini, McLaren, BMW, Mercedes-AMG, Aston Martin, Audi, Ford, Chevrolet and Lexus: the cars that fight for the Spa 24 Hours, each with its own power, weight, gearbox and character.</p></div><div class="actions">${btn('/cars', 'All cars', 'btn-light')}</div></div>
    <div class="strip">${cars.map(carCard).join('')}</div>
  </div>
</section>
<section class="sec alt">
  <div class="wrap">
    <div class="feat">
      <div class="feat-img" style="--img:url('${photo('grid', 'zandvoort')}')"></div>
      <div><span class="eyebrow">Online racing</span><h3>Race your friends, anywhere</h3><p>Open a room and share its code or an invite link, jump into a public lobby with Quick Match, or host a race on your own device for friends on the same Wi-Fi. Practice, qualifying and the race, with up to twelve drivers.</p>${btn('/online', 'Online racing')}</div>
    </div>
    <div class="feat flip">
      <div class="feat-img" style="--img:url('${photo('pole', 'spa')}')"></div>
      <div><span class="eyebrow">Licences & ratings</span><h3>Earn your licence</h3><p>Every clean corner counts. Your Safety Rating rises as you drive cleanly and falls with every incident, and lifts you from Rookie to the Pro licence. Levels, experience and achievements track the rest of your career.</p>${btn('/licences', 'Licences & ratings')}</div>
    </div>
    <div class="feat">
      <div class="feat-img" style="--img:url('${photo('straight', 'zandvoort')}')"></div>
      <div><span class="eyebrow">Weather & time of day</span><h3>Dawn to night, sun to rain</h3><p>Six kinds of weather and the full day, with forecasts that can change during a session. A drying line, tyres that need the right temperature, and wets when the rain comes.</p>${btn('/features#weather', 'Weather & tyres')}</div>
    </div>
    <div class="feat flip">
      <div class="feat-img" style="--img:url('${photo('grid', 'spa')}')"></div>
      <div><span class="eyebrow">Strategy</span><h3>Pit stops, fuel and race control</h3><p>A pit crew that changes your tyres and fills the tank, mandatory stops as in GT World Challenge, yellow flags, the safety car and drive-through penalties. Turn on what you want for each race.</p>${btn('/features#strategy', 'Strategy')}</div>
    </div>
    <div class="feat">
      <div class="feat-img" style="--img:url('${photo('hero', 'zandvoort')}')"></div>
      <div><span class="eyebrow">AI drivers</span><h3>Bots that race you fairly</h3><p>Choose their level from Rookie to Alien. They leave you room side by side, brake for you in time and make clean passes, so racing them feels like racing people.</p>${btn('/features#ai', 'Bot levels')}</div>
    </div>
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
    <div class="sec-head"><div><span class="eyebrow">New to sim racing?</span><h2>Start in three steps</h2></div></div>
    <div class="grid g3">
      <div class="step"><div class="n">01</div><h3>Your computer</h3><p>A recent browser with WebGL 2 is all it takes. A graphics card makes it shine.</p><a class="link-more" href="/getting-started#requirements">System requirements →</a></div>
      <div class="step"><div class="n">02</div><h3>Keyboard, controller or wheel</h3><p>Drive with the keyboard, an Xbox or PlayStation controller, or a steering wheel with its real lock.</p><a class="link-more" href="/getting-started#controls">Controls →</a></div>
      <div class="step"><div class="n">03</div><h3>Pick a car and race</h3><p>Choose your nickname and your car in the garage, then race solo or join your friends.</p><a class="link-more" href="/play/">Play now →</a></div>
    </div>
  </div>
</section>
<section class="band">
  <div class="wrap"><div><h2>Free. In your browser. Right now.</h2><p>No download, no account needed to race the AI.</p></div><div class="cta-row">${playBtn('Start racing')}</div></div>
</section>`,
});

// CARS
const makes = [...new Set(cars.map((c) => c.manufacturer))].sort();
page({
  file: 'cars.html',
  active: 'The Game',
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
    active: 'The Game',
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
  active: 'The Game',
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
    active: 'The Game',
    title: `${c.name} · Circuits · GridCorsa`,
    desc: `${c.name} (${c.country}) in GridCorsa: ${c.layouts.length} layout(s), ${(c.main.length / 1000).toFixed(2)} km.`,
    body: `
${hero({ img: photo('hero', c.photoMap), eyebrow: `${c.country} · ${c.place}`, title: esc(c.short), lead: esc(c.intro), ctas: `${playBtn('Race here now')}${btn('/tracks', 'All circuits')}`, short: true })}
<section class="sec">
  <div class="wrap">
    <h2>Layouts</h2>
    <div class="grid g${Math.min(3, c.layouts.length)}">${c.layouts
      .map(
        (l) =>
          `<div class="card"><div class="card-img" style="display:grid;place-items:center;padding:20px;background:#0e1528">${l.svg.replace('class="outline"', 'class="outline" style="width:70%;height:100%"')}</div><div class="card-body"><h3>${esc(l.name)}</h3><div class="meta"><span class="tag red">${(l.length / 1000).toFixed(2)} km</span>${l.turns ? `<span class="tag">${l.turns} turns</span>` : ''}${l.default ? '<span class="tag gt3">Main layout</span>' : ''}</div></div></div>`,
      )
      .join('')}</div>
    <div class="grid g2" style="margin-top:56px;gap:40px">
      <div><h2>Key corners</h2><ul class="prose" style="padding-left:1.2em">${c.corners.map((k) => `<li>${esc(k)}</li>`).join('')}</ul></div>
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
  active: 'The Game',
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
        .map(([n, p], i) => `<div style="background:hsl(${210 - i * 38} 60% ${26 + i * 3}%)"><b>${p}</b><span>${n}</span></div>`)
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
  active: 'Racing',
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
  active: 'The Game',
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
      ['P', 'Pro', '#1b1d22'],
    ]
      .map(([l, n, col]) => `<div style="background:${col}"><b>${l}</b><span>${n}</span></div>`)
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
  active: 'Getting Started',
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
  active: 'Media',
  title: 'Screenshots · GridCorsa',
  desc: 'Screenshots of GridCorsa at Spa-Francorchamps, the Nürburgring and Zandvoort, and renders of every car.',
  body: `
${hero({ img: photo('pole', 'zandvoort'), eyebrow: 'Media', title: 'Screenshots', lead: 'Straight from the game.', short: true })}
<section class="sec">
  <div class="wrap">
    <div class="gallery">${shots.map(([src, name]) => `<a href="${src}" aria-label="${esc(name)}" style="background-image:url('${src}')"></a>`).join('')}</div>
    <h2 style="margin-top:56px">The cars</h2>
    <div class="gallery">${cars.map((c) => `<a href="${carImg(c.id)}" aria-label="${esc(c.name)}" style="background-image:url('${carImg(c.id)}');background-size:contain;background-color:#0e1528"></a>`).join('')}</div>
  </div>
</section>`,
});

// DOWNLOAD
page({
  file: 'download.html',
  active: 'Download',
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
  active: 'Getting Started',
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

/* ------------------------------------------------------------------------------------------------- files */
mkdirSync(path.join(out, 'site'), { recursive: true });
copyFileSync(path.join(here, 'site.css'), path.join(out, 'site/site.css'));
copyFileSync(path.join(here, 'site.js'), path.join(out, 'site/site.js'));
copyFileSync(path.join(here, 'vercel.json'), path.join(out, 'vercel.json'));
console.log(`website: ${cars.length} car pages, ${CIRCUITS.length} circuit pages, 11 more → ${path.relative(root, out)}`);
