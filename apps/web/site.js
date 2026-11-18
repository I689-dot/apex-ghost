/* global document, location, setInterval, history, window, requestAnimationFrame, IntersectionObserver */
// GridCorsa website: the small things a static page needs.
(() => {
  // invite links from before the game moved to /play/ (…/?join=CODE): into the game with the code
  const q = new URLSearchParams(location.search);
  if (q.has('join') && !location.pathname.startsWith('/play')) {
    location.replace(`/play/?join=${encodeURIComponent(q.get('join') || '')}`);
    return;
  }

  // the phone menu
  const burger = document.querySelector('.burger');
  const nav = document.querySelector('.nav');
  burger?.addEventListener('click', () => {
    const open = nav.classList.toggle('open');
    burger.setAttribute('aria-expanded', String(open));
  });

  // the cars page: by make, and a search
  const grid = document.querySelector('[data-cars]');
  if (grid) {
    const cards = [...grid.querySelectorAll('[data-make]')];
    const buttons = [...document.querySelectorAll('[data-filter]')];
    const search = document.querySelector('[data-search]');
    let make = '';
    const apply = () => {
      const s = (search?.value || '').trim().toLowerCase();
      for (const c of cards) c.hidden = (make && c.dataset.make !== make) || (s && !c.dataset.text.includes(s));
      for (const b of buttons) b.classList.toggle('on', b.dataset.filter === make);
    };
    for (const b of buttons)
      b.addEventListener('click', () => {
        make = b.dataset.filter;
        apply();
      });
    search?.addEventListener('input', apply);
    // /cars#porsche: that make's cars (the home page's makes link here)
    const h = decodeURIComponent(location.hash.slice(1));
    const slug = (s) =>
      s
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
    const hit = h && buttons.find((b) => b.dataset.filter && slug(b.dataset.filter) === h);
    if (hit) {
      make = hit.dataset.filter;
      apply();
    }
  }

  const fmtLap = (ms) => {
    const m = Math.floor(ms / 60000);
    const s = (ms - m * 60000) / 1000;
    return `${m}:${s.toFixed(3).padStart(6, '0')}`;
  };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  // Live sessions: the server's public room list, every 15 s
  const live = document.querySelector('[data-live]');
  if (live) {
    const tracks = JSON.parse(live.dataset.tracks || '{}');
    const phase = (r) =>
      r.phase === 'lobby'
        ? 'In the lobby'
        : r.phase === 'briefing'
          ? 'Briefing'
          : r.kind === 'race'
            ? r.raceLaps
              ? `Race · ${r.raceLaps} laps`
              : 'Race · timed'
            : r.kind === 'practice'
              ? 'Free practice'
              : 'Qualifying';
    const load = async () => {
      try {
        const res = await fetch(`${live.dataset.server}/api/rooms`);
        const { rooms } = await res.json();
        live.innerHTML = rooms.length
          ? rooms
              .map(
                (r) =>
                  `<div class="card"><div class="card-body"><span class="date">${esc(phase(r))}</span><h3>${esc(tracks[r.trackId] || r.trackId)}</h3><p>Host ${esc(r.host)} · ${r.drivers}/${r.maxPlayers} drivers${r.spectators ? ` · ${r.spectators} watching` : ''}</p><div class="meta"><a class="btn btn-play" href="/play/?join=${encodeURIComponent(r.code)}">${r.phase === 'lobby' ? 'Join' : 'Join next'}</a><span class="tag">${esc(r.code)}</span></div></div></div>`,
              )
              .join('')
          : '<div class="step"><h3>No public races right now</h3><p>Start one: Quick Match opens a public room others can join.</p><a class="btn btn-play" href="/play/">Quick match</a></div>';
      } catch {
        live.innerHTML = '<p>The live list could not be loaded. Try again in a moment.</p>';
      }
    };
    load();
    setInterval(load, 15000);
  }

  // Leaderboards: the best lap of each driver on a layout
  const board = document.querySelector('[data-board]');
  if (board) {
    const cars = JSON.parse(board.dataset.cars || '{}');
    const rows = document.querySelector('[data-rows]');
    const sel = (k) => board.querySelector(`[data-k="${k}"]`);
    const load = async () => {
      rows.innerHTML = '<tr><td colspan="8">Loading…</td></tr>';
      const q = new URLSearchParams({ track: sel('track').value, scope: 'global' });
      if (sel('car').value) q.set('car', sel('car').value);
      if (sel('wet').value) q.set('wet', '1');
      try {
        const res = await fetch(`${board.dataset.server}/api/records?${q}`);
        const { rows: list } = await res.json();
        rows.innerHTML = list.length
          ? list
              .map(
                (r) =>
                  `<tr><td>${r.position}</td><td><b>${esc(r.nick)}</b></td><td>${esc(cars[r.carId] || r.carId)}</td><td><b>${fmtLap(r.lapMs)}</b></td><td>${(r.sectors || []).map((s) => (s / 1000).toFixed(3)).join(' · ')}</td><td>${r.laps}</td><td>${new Date(r.at).toLocaleDateString()}</td><td><a class="link-more" href="/telemetry?track=${encodeURIComponent(sel('track').value)}${sel('wet').value ? '&wet=1' : ''}&user=${encodeURIComponent(r.userId)}">Telemetry →</a></td></tr>`,
              )
              .join('')
          : '<tr><td colspan="8">No laps here yet. Be the first: race online and set a time.</td></tr>';
      } catch {
        rows.innerHTML = '<tr><td colspan="8">The leaderboard could not be loaded.</td></tr>';
      }
    };
    for (const k of ['track', 'car', 'wet']) sel(k).addEventListener('change', load);
    load();
  }

  // Driver lookup: search by nickname, then the driver's online career and best laps
  const drv = document.querySelector('[data-drivers]');
  if (drv) {
    const S = drv.dataset.server;
    const tracks = JSON.parse(drv.dataset.tracks || '{}');
    const cars = JSON.parse(drv.dataset.cars || '{}');
    const found = document.querySelector('[data-found]');
    const panel = document.querySelector('[data-driver]');
    const input = drv.querySelector('[data-q]');
    const flag = (cc) =>
      cc
        ? `<img src="https://flagcdn.com/w40/${cc.toLowerCase()}.png" alt="${esc(cc)}" width="24" height="18" style="display:inline;vertical-align:-2px;border-radius:2px" />`
        : '';
    const show = async (id) => {
      panel.innerHTML = '<p>Loading…</p>';
      try {
        const { stats: s } = await (await fetch(`${S}/api/stats?user=${encodeURIComponent(id)}`)).json();
        if (!s) throw new Error();
        history.replaceState(null, '', `/drivers?id=${encodeURIComponent(id)}`);
        const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '—');
        panel.innerHTML = `<div class="drv-card"><div><span class="eyebrow">Driver since ${new Date(s.since).toLocaleDateString(undefined, { year: 'numeric', month: 'long' })}</span><h2>${esc(s.nick)}</h2></div>
          <div class="stats" style="margin:20px 0">
            <div><b>${s.races}</b><span>Starts</span></div><div><b>${s.wins}</b><span>Wins · ${pct(s.wins, s.races)}</span></div>
            <div><b>${s.podiums}</b><span>Podiums · ${pct(s.podiums, s.races)}</span></div><div><b>${s.poles}</b><span>Poles</span></div></div>
          <h3>Best laps (dry)</h3>
          <table class="spec board"><thead><tr><th>Layout</th><th>Car</th><th>Lap</th><th></th></tr></thead><tbody>${
            s.best.length
              ? s.best
                  .map(
                    (b) =>
                      `<tr><td>${esc(tracks[b.trackId] || b.trackId)}</td><td>${esc(cars[b.carId] || b.carId)}</td><td><b>${fmtLap(b.lapMs)}</b></td><td><a class="link-more" href="/telemetry?track=${encodeURIComponent(b.trackId)}&user=${encodeURIComponent(id)}">Telemetry →</a></td></tr>`,
                  )
                  .join('')
              : '<tr><td colspan="4">No timed laps yet.</td></tr>'
          }</tbody></table><p style="margin-top:14px;color:var(--muted)">${s.laps} timed laps in total.</p></div>`;
      } catch {
        panel.innerHTML = '<p>That driver could not be loaded.</p>';
      }
    };
    let timer = 0;
    input.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const q = input.value.trim();
        if (q.length < 2) {
          found.innerHTML = '';
          return;
        }
        try {
          const { rows } = await (await fetch(`${S}/api/drivers?q=${encodeURIComponent(q)}`)).json();
          found.innerHTML = rows.length
            ? rows
                .map(
                  (d) =>
                    `<button class="card drv-pick" data-id="${esc(d.id)}"><div class="card-body"><h3 style="font-size:1.2rem">${flag(d.country)} ${esc(d.nick)}</h3><p>${d.num ? `#${d.num}` : ''} ${esc(d.abbr || '')}</p></div></button>`,
                )
                .join('')
            : '<p>No driver by that name.</p>';
          for (const b of found.querySelectorAll('[data-id]')) b.addEventListener('click', () => show(b.dataset.id));
        } catch {
          found.innerHTML = '<p>The search is not available right now.</p>';
        }
      }, 250);
    });
    const id = new URLSearchParams(location.search).get('id');
    if (id) show(id);
  }

  // Service status
  const st = document.querySelector('[data-status]');
  if (st) {
    const S = st.dataset.server;
    const set = (svc, ok, text, extra) => {
      const el = st.querySelector(`[data-svc="${svc}"]`);
      el.querySelector('.st').innerHTML = `<span class="dot" style="background:${ok ? '#1fbf6a' : '#e3183d'}"></span>${esc(text)}`;
      if (extra !== undefined) el.querySelector('p:last-child').textContent = extra;
    };
    set('site', true, 'Online');
    (async () => {
      const t0 = performance.now();
      try {
        const r = await fetch(`${S}/health`, { cache: 'no-store' });
        const ms = Math.round(performance.now() - t0);
        set('server', r.ok, r.ok ? 'Online' : 'Problems', `Answered in ${ms} ms`);
      } catch {
        set('server', false, 'Unreachable', 'Online races are not available; solo races work.');
      }
      try {
        const { rooms } = await (await fetch(`${S}/api/rooms`, { cache: 'no-store' })).json();
        set('rooms', true, 'Online', `${rooms.length} public room${rooms.length === 1 ? '' : 's'} right now`);
      } catch {
        set('rooms', false, 'Unavailable', '');
      }
    })();
  }

  // screenshots: full size on click
  for (const a of document.querySelectorAll('.gallery a')) {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const box = document.createElement('div');
      box.className = 'lightbox';
      const img = document.createElement('img');
      img.src = a.getAttribute('href');
      img.alt = a.getAttribute('aria-label') || '';
      box.append(img);
      const close = () => box.remove();
      box.addEventListener('click', close);
      document.addEventListener('keydown', (k) => k.key === 'Escape' && close(), { once: true });
      document.body.append(box);
    });
  }
})();

/*
 * Scroll motion: quiet and tied to the scroll, after the motorsport and automotive sites (Porsche Motorsport, the
 * pinned and parallax patterns of their sections). Reveals as things enter the view (IntersectionObserver), a
 * parallax layer behind photos, the cars running sideways while their section is pinned, a story whose photo
 * changes with the step being read, counters, outlines drawing themselves, a header that steps aside when reading
 * down and comes back when scrolling up, and a hairline of progress. Nothing moves with prefers-reduced-motion.
 */
(() => {
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const body = document.body;
  const progress = document.querySelector('.progress');

  // reveals, staggered among siblings
  for (const el of document.querySelectorAll('.rv, .rv-img')) {
    const sibs = [...el.parentElement.children].filter((c) => c.classList.contains('rv') || c.classList.contains('rv-img'));
    el.style.setProperty('--d', String(Math.min(6, sibs.indexOf(el))));
  }
  for (const svg of document.querySelectorAll('.draw .outline path')) {
    try {
      svg.style.setProperty('--len', String(Math.ceil(svg.getTotalLength())));
    } catch {
      /* not drawn yet */
    }
  }
  const counters = [...document.querySelectorAll('[data-count]')];
  const count = (el) => {
    const end = Number(el.dataset.count);
    if (still || !end) return;
    const t0 = performance.now();
    const dur = 1600;
    const tick = (now) => {
      const f = Math.min(1, (now - t0) / dur);
      el.textContent = String(Math.round(end * (1 - Math.pow(1 - f, 3))));
      if (f < 1) requestAnimationFrame(tick);
    };
    el.textContent = '0';
    requestAnimationFrame(tick);
  };
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.classList.add('in');
        for (const c of e.target.querySelectorAll('[data-count]')) count(c);
        io.unobserve(e.target);
      }
    },
    { rootMargin: '0px 0px -10% 0px', threshold: 0.12 },
  );
  for (const el of document.querySelectorAll('.rv, .rv-img, .draw, .bars')) io.observe(el);
  if (still) for (const el of document.querySelectorAll('.rv, .rv-img, .draw, .bars')) el.classList.add('in');
  void counters;

  // the story: the step in the middle of the screen sets the photo
  const story = document.querySelector('[data-story]');
  if (story) {
    const figs = [...story.querySelectorAll('.story-media figure')];
    const steps = [...story.querySelectorAll('.story-step')];
    const sio = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const i = Number(e.target.dataset.i);
          steps.forEach((s, k) => s.classList.toggle('on', k === i));
          figs.forEach((f, k) => f.classList.toggle('on', k === i));
        }
      },
      { rootMargin: '-45% 0px -45% 0px' },
    );
    for (const s of steps) sio.observe(s);
  }

  // the table of contents follows the section being read
  const toc = document.querySelector('.toc');
  if (toc) {
    const links = [...toc.querySelectorAll('a[href^="#"]')];
    const tio = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) for (const a of links) a.classList.toggle('on', a.getAttribute('href') === `#${e.target.id}`);
      },
      { rootMargin: '-20% 0px -70% 0px' },
    );
    for (const a of links) {
      const h = document.getElementById(a.getAttribute('href').slice(1));
      if (h) tio.observe(h);
    }
  }

  // pinned horizontal run: the section is as tall as the track is wide; scrolling down moves the cars sideways
  const hs = document.querySelector('[data-hscroll]');
  const wide = () => window.innerWidth > 1000 && !still;
  let hsSpan = 0;
  const hsLayout = () => {
    if (!hs) return;
    const track = hs.querySelector('.hscroll-track');
    if (!wide()) {
      hs.style.height = '';
      track.style.transform = '';
      hs.classList.add('flat');
      return;
    }
    hs.classList.remove('flat');
    hsSpan = Math.max(0, track.scrollWidth - window.innerWidth + 80);
    hs.style.height = `${window.innerHeight + hsSpan}px`;
  };

  // parallax layers
  const layers = still ? [] : [...document.querySelectorAll('[data-parallax]')];
  let lastY = window.scrollY;
  let ticking = false;
  const frame = () => {
    ticking = false;
    const y = window.scrollY;
    const vh = window.innerHeight;
    body.classList.toggle('scrolled', y > 40);
    if (y > 500 && y > lastY + 6) body.classList.add('head-hidden');
    else if (y < lastY - 6 || y < 200) body.classList.remove('head-hidden');
    lastY = y;
    if (progress) progress.style.transform = `scaleX(${Math.min(1, y / Math.max(1, document.documentElement.scrollHeight - vh))})`;
    for (const el of layers) {
      const r = (el.parentElement || el).getBoundingClientRect();
      if (r.bottom < -100 || r.top > vh + 100) continue;
      const k = Number(el.dataset.parallax) || 0.1;
      el.style.translate = `0 ${((r.top + r.height / 2 - vh / 2) * k).toFixed(1)}px`;
    }
    if (hs && wide()) {
      const r = hs.getBoundingClientRect();
      const f = Math.min(1, Math.max(0, -r.top / Math.max(1, r.height - vh)));
      hs.querySelector('.hscroll-track').style.transform = `translate3d(${(-f * hsSpan).toFixed(1)}px,0,0)`;
      const bar = hs.querySelector('.hscroll-bar i');
      if (bar) bar.style.transform = `scaleX(${f})`;
    }
  };
  const onScroll = () => {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(frame);
    }
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', () => {
    hsLayout();
    onScroll();
  });
  window.addEventListener('load', () => {
    hsLayout();
    onScroll();
  });
  hsLayout();
  frame();
})();
