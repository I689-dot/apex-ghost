/* global document, location, setInterval, history */
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
