/* global document, location, history, window, atob, ResizeObserver */
/**
 * The telemetry page: a driver's best lap (the game's lap trace: game/lapTrace.ts) drawn on the circuit coloured by
 * speed, and charts of speed, throttle, brake, steering, gear and the time gap against a second lap, along the lap's
 * distance. Moving over a chart or the map shows every value at that point, on both laps.
 */
(() => {
  const root = document.querySelector('[data-tm]');
  if (!root) return;
  const SERVER = root.dataset.server;
  const CARS = JSON.parse(root.dataset.cars || '{}');
  const sel = (k) => root.querySelector(`[data-k="${k}"]`);
  const msg = document.querySelector('[data-msg]');
  const view = document.querySelector('[data-view]');
  const mapCv = document.querySelector('[data-map]');
  const chartsEl = document.querySelector('[data-charts]');
  const readEl = document.querySelector('[data-read]');
  const sectorsEl = document.querySelector('[data-sectors]');
  const COL = { a: '#ff3d5e', b: '#3fc6ff' };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const fmtLap = (ms) => {
    const m = Math.floor(ms / 60000);
    const s = (ms - m * 60000) / 1000;
    return `${m}:${s.toFixed(3).padStart(6, '0')}`;
  };

  /** Points of a lap: distance (m), x, z, time (s), speed (km/h), throttle, brake (0…1), steer (−1…1), gear. */
  function decode(t) {
    const raw = atob(t.data);
    const n = Math.floor(raw.length / 11);
    const buf = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
    const dv = new DataView(buf.buffer);
    const pts = [];
    for (let i = 0; i < n; i++) {
      const o = i * 11;
      const g = dv.getUint8(o + 10) - 1;
      pts.push({
        d: i * t.bin,
        x: dv.getInt16(o, true) / 4,
        z: dv.getInt16(o + 2, true) / 4,
        t: dv.getUint16(o + 4, true) / 100,
        v: dv.getUint8(o + 6) * 1.25,
        thr: dv.getUint8(o + 7) / 255,
        brk: dv.getUint8(o + 8) / 255,
        steer: dv.getInt8(o + 9) / 127,
        gear: g < 0 ? 'R' : g === 0 ? 'N' : String(g),
        g: Math.max(0, g),
      });
    }
    return pts;
  }

  let track = null; // { pts, length }
  let laps = []; // list from the server
  let A = null; // { meta, pts }
  let B = null;
  let cursor = -1; // point index
  const cache = new Map();

  const api = async (path) => {
    const r = await fetch(`${SERVER}/api/${path}`);
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Could not load');
    return r.json();
  };
  const getLap = async (user) => {
    const key = `${sel('track').value}|${sel('wet').value}|${user}`;
    if (!cache.has(key)) {
      const q = new URLSearchParams({ track: sel('track').value, user });
      if (sel('wet').value) q.set('wet', '1');
      const meta = await api(`telemetry?${q}`);
      cache.set(key, { meta, pts: decode(meta) });
    }
    return cache.get(key);
  };

  // ------------------------------------------------------------------ drawing helpers
  function fit(cv) {
    const r = cv.getBoundingClientRect();
    const k = window.devicePixelRatio || 1;
    cv.width = Math.round(r.width * k);
    cv.height = Math.round(r.height * k);
    const g = cv.getContext('2d');
    g.setTransform(k, 0, 0, k, 0, 0);
    return { g, w: r.width, h: r.height };
  }
  const speedCol = (v, lo, hi) => {
    const f = Math.max(0, Math.min(1, (v - lo) / Math.max(1, hi - lo)));
    return `hsl(${220 - f * 220} 95% ${48 + f * 8}%)`;
  };

  function drawMap() {
    const { g, w, h } = fit(mapCv);
    g.clearRect(0, 0, w, h);
    if (!track) return;
    const p = track.pts;
    let x0 = Infinity,
      x1 = -Infinity,
      z0 = Infinity,
      z1 = -Infinity;
    for (let i = 0; i < p.length; i += 2) {
      x0 = Math.min(x0, p[i]);
      x1 = Math.max(x1, p[i]);
      z0 = Math.min(z0, p[i + 1]);
      z1 = Math.max(z1, p[i + 1]);
    }
    const pad = 18;
    const k = Math.min((w - pad * 2) / (x1 - x0 || 1), (h - pad * 2) / (z1 - z0 || 1));
    const ox = (w - (x1 - x0) * k) / 2;
    const oz = (h - (z1 - z0) * k) / 2;
    const X = (x) => ox + (x - x0) * k;
    const Z = (z) => oz + (z - z0) * k;
    mapCv._proj = { X, Z };
    // the circuit
    g.lineJoin = 'round';
    g.lineCap = 'round';
    g.strokeStyle = 'rgba(255,255,255,0.13)';
    g.lineWidth = 9;
    g.beginPath();
    for (let i = 0; i < p.length; i += 2) (i ? g.lineTo : g.moveTo).call(g, X(p[i]), Z(p[i + 1]));
    g.closePath();
    g.stroke();
    // lap A by speed
    if (A) {
      const vs = A.pts.map((q) => q.v);
      const lo = Math.min(...vs);
      const hi = Math.max(...vs);
      g.lineWidth = 4;
      for (let i = 1; i < A.pts.length; i++) {
        const a = A.pts[i - 1];
        const b = A.pts[i];
        g.strokeStyle = speedCol(b.v, lo, hi);
        g.beginPath();
        g.moveTo(X(a.x), Z(a.z));
        g.lineTo(X(b.x), Z(b.z));
        g.stroke();
      }
      const s = A.pts[0];
      g.fillStyle = '#fff';
      g.beginPath();
      g.arc(X(s.x), Z(s.z), 5, 0, Math.PI * 2);
      g.fill();
    }
    // the cursor: both cars at that distance
    for (const [lap, col] of [
      [B, COL.b],
      [A, COL.a],
    ]) {
      if (!lap || cursor < 0) continue;
      const q = lap.pts[Math.min(cursor, lap.pts.length - 1)];
      g.fillStyle = col;
      g.strokeStyle = '#fff';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(X(q.x), Z(q.z), 7, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }
  }

  const CHARTS = [
    { key: 'v', label: 'Speed', unit: 'km/h', min: 0, max: null, fmt: (v) => `${Math.round(v)} km/h` },
    { key: 'thr', label: 'Throttle', min: 0, max: 1, fmt: (v) => `${Math.round(v * 100)} %`, h: 64 },
    { key: 'brk', label: 'Brake', min: 0, max: 1, fmt: (v) => `${Math.round(v * 100)} %`, h: 64 },
    { key: 'steer', label: 'Steering', min: -1, max: 1, fmt: (v) => `${v > 0.02 ? 'L' : v < -0.02 ? 'R' : ''} ${Math.round(Math.abs(v) * 100)} %`, h: 70 },
    { key: 'g', label: 'Gear', min: 0, max: 7, fmt: (_v, q) => q.gear, h: 56, step: true },
    { key: 'delta', label: 'Time gap', min: null, max: null, fmt: (v) => `${v > 0 ? '+' : ''}${v.toFixed(3)} s`, h: 80 },
  ];
  let cvs = [];
  function buildCharts() {
    chartsEl.innerHTML = CHARTS.map(
      (c) =>
        `<div class="tm-chart" style="--h:${c.h || 130}px"><div class="tm-chart-head"><b>${c.label}</b><span data-val="${c.key}"></span></div><canvas data-c="${c.key}"></canvas></div>`,
    ).join('');
    cvs = CHARTS.map((c) => chartsEl.querySelector(`[data-c="${c.key}"]`));
    for (const cv of cvs) {
      cv.addEventListener('pointermove', (e) => {
        const r = cv.getBoundingClientRect();
        const f = (e.clientX - r.left) / r.width;
        cursor = Math.max(0, Math.min(A.pts.length - 1, Math.round(f * (A.pts.length - 1))));
        redrawCursor();
      });
      cv.addEventListener('pointerleave', () => {
        cursor = -1;
        redrawCursor();
      });
    }
  }

  /** B's time gap against A at each of A's points (s, + = B behind), by distance. */
  function deltas() {
    if (!A || !B) return null;
    return A.pts.map((p, i) => {
      const q = B.pts[Math.min(i, B.pts.length - 1)];
      return q.t - p.t;
    });
  }

  function drawCharts() {
    const del = deltas();
    CHARTS.forEach((c, ci) => {
      const cv = cvs[ci];
      cv.parentElement.hidden = c.key === 'delta' && !del;
      if (cv.parentElement.hidden) return;
      const { g, w, h } = fit(cv);
      g.clearRect(0, 0, w, h);
      const series = (lap) => (c.key === 'delta' ? del : lap.pts.map((p) => p[c.key]));
      const all = [...series(A), ...(B && c.key !== 'delta' ? series(B) : [])];
      let lo = c.min ?? Math.min(...all);
      let hi = c.max ?? Math.max(...all);
      if (c.key === 'v') {
        lo = Math.max(0, Math.floor(Math.min(...all) / 20) * 20);
        hi = Math.ceil(Math.max(...all) / 20) * 20;
      }
      if (c.key === 'delta') {
        const m = Math.max(0.2, ...all.map(Math.abs));
        lo = -m;
        hi = m;
      }
      const Y = (v) => h - 4 - ((v - lo) / (hi - lo || 1)) * (h - 8);
      // grid
      g.strokeStyle = 'rgba(255,255,255,0.07)';
      g.lineWidth = 1;
      for (let k = 0; k <= 4; k++) {
        const y = 4 + ((h - 8) * k) / 4;
        g.beginPath();
        g.moveTo(0, y);
        g.lineTo(w, y);
        g.stroke();
      }
      if (c.key === 'steer' || c.key === 'delta') {
        g.strokeStyle = 'rgba(255,255,255,0.25)';
        g.beginPath();
        g.moveTo(0, Y(0));
        g.lineTo(w, Y(0));
        g.stroke();
      }
      const line = (vals, col, width) => {
        const n = vals.length;
        g.strokeStyle = col;
        g.lineWidth = width;
        g.beginPath();
        for (let i = 0; i < n; i++) {
          const x = (i / (n - 1)) * w;
          if (c.step && i) g.lineTo(x, Y(vals[i - 1]));
          (i ? g.lineTo : g.moveTo).call(g, x, Y(vals[i]));
        }
        g.stroke();
      };
      if (c.key === 'delta') {
        // above zero: B behind A (red is A's colour: A gaining)
        const n = del.length;
        g.fillStyle = 'rgba(63,198,255,0.12)';
        g.beginPath();
        g.moveTo(0, Y(0));
        for (let i = 0; i < n; i++) g.lineTo((i / (n - 1)) * w, Y(del[i]));
        g.lineTo(w, Y(0));
        g.fill();
        line(del, '#fff', 1.6);
      } else {
        if (B) line(series(B), COL.b, 1.5);
        line(series(A), COL.a, 1.8);
      }
      cv._Y = Y;
    });
    redrawCursor();
  }

  function redrawCursor() {
    drawMap();
    const del = deltas();
    CHARTS.forEach((c, ci) => {
      const cv = cvs[ci];
      if (cv.parentElement.hidden) return;
      let ov = cv.parentElement.querySelector('.tm-cur');
      if (!ov) {
        ov = document.createElement('i');
        ov.className = 'tm-cur';
        cv.parentElement.append(ov);
      }
      const val = cv.parentElement.querySelector(`[data-val="${c.key}"]`);
      if (cursor < 0 || !A) {
        ov.hidden = true;
        val.innerHTML = '';
        return;
      }
      ov.hidden = false;
      ov.style.left = `calc(10px + (100% - 20px) * ${cursor / (A.pts.length - 1)})`;
      const qa = A.pts[cursor];
      const qb = B ? B.pts[Math.min(cursor, B.pts.length - 1)] : null;
      val.innerHTML =
        c.key === 'delta'
          ? `<b style="color:${del[cursor] > 0 ? COL.a : COL.b}">${c.fmt(del[cursor])}</b>`
          : `<b style="color:${COL.a}">${esc(c.fmt(qa[c.key], qa))}</b>${qb ? ` <b style="color:${COL.b}">${esc(c.fmt(qb[c.key], qb))}</b>` : ''}`;
    });
    const q = cursor >= 0 && A ? A.pts[cursor] : null;
    readEl.innerHTML = A
      ? `<div><span class="dot" style="background:${COL.a}"></span><b>${esc(A.meta.nick)}</b> · ${esc(CARS[A.meta.carId] || A.meta.carId)} · <b>${fmtLap(A.meta.lapMs)}</b></div>${
          B
            ? `<div><span class="dot" style="background:${COL.b}"></span><b>${esc(B.meta.nick)}</b> · ${esc(CARS[B.meta.carId] || B.meta.carId)} · <b>${fmtLap(B.meta.lapMs)}</b></div>`
            : ''
        }${q ? `<div class="tm-at">${(q.d / 1000).toFixed(2)} km · ${q.t.toFixed(2)} s into the lap</div>` : '<div class="tm-at">Move over a chart or the map</div>'}`
      : '';
  }

  function drawSectors() {
    const row = (lap, col) =>
      lap.meta.sectors.length
        ? `<tr><td><span class="dot" style="background:${col}"></span>${esc(lap.meta.nick)}</td>${lap.meta.sectors.map((s) => `<td>${(s / 1000).toFixed(3)}</td>`).join('')}<td><b>${fmtLap(lap.meta.lapMs)}</b></td></tr>`
        : '';
    const n = A.meta.sectors.length || 3;
    sectorsEl.innerHTML = `<table class="spec board"><thead><tr><th></th>${Array.from({ length: n }, (_, i) => `<th>S${i + 1}</th>`).join('')}<th>Lap</th></tr></thead><tbody>${row(A, COL.a)}${B ? row(B, COL.b) : ''}</tbody></table>`;
  }

  // the map follows the cursor too: the nearest point of lap A
  mapCv.addEventListener('pointermove', (e) => {
    if (!A || !mapCv._proj) return;
    const r = mapCv.getBoundingClientRect();
    const mx = e.clientX - r.left;
    const my = e.clientY - r.top;
    let best = -1;
    let bd = 30 * 30;
    A.pts.forEach((p, i) => {
      const d = (mapCv._proj.X(p.x) - mx) ** 2 + (mapCv._proj.Z(p.z) - my) ** 2;
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    cursor = best;
    redrawCursor();
  });
  mapCv.addEventListener('pointerleave', () => {
    cursor = -1;
    redrawCursor();
  });

  // ------------------------------------------------------------------ loading
  async function loadTrack() {
    const id = sel('track').value;
    track = await (await fetch(`/site/tracks/${id}.json`)).json();
  }
  async function loadList(prefUser) {
    msg.hidden = false;
    msg.textContent = 'Loading the laps…';
    view.hidden = true;
    A = B = null;
    await loadTrack();
    const q = new URLSearchParams({ track: sel('track').value });
    if (sel('wet').value) q.set('wet', '1');
    try {
      laps = (await api(`traces?${q}`)).rows;
    } catch {
      laps = [];
    }
    const opt = (l, i) => `<option value="${esc(l.userId)}">${i + 1}. ${esc(l.nick)} · ${fmtLap(l.lapMs)} · ${esc(CARS[l.carId] || l.carId)}</option>`;
    sel('a').innerHTML = laps.map(opt).join('');
    sel('b').innerHTML = `<option value="">Nobody</option>${laps.map(opt).join('')}`;
    if (!laps.length) {
      msg.textContent = 'No telemetry on this layout yet. Set a personal best online and yours will be the first.';
      return;
    }
    if (prefUser && laps.some((l) => l.userId === prefUser)) sel('a').value = prefUser;
    const other = laps.find((l) => l.userId !== sel('a').value);
    sel('b').value = other ? other.userId : '';
    await loadLaps();
  }
  async function loadLaps() {
    try {
      A = await getLap(sel('a').value);
      B = sel('b').value && sel('b').value !== sel('a').value ? await getLap(sel('b').value) : null;
    } catch (e) {
      msg.hidden = false;
      msg.textContent = e.message;
      return;
    }
    msg.hidden = true;
    view.hidden = false;
    const q = new URLSearchParams({ track: sel('track').value, user: sel('a').value });
    if (sel('wet').value) q.set('wet', '1');
    history.replaceState(null, '', `/telemetry?${q}`);
    drawSectors();
    drawCharts();
  }

  buildCharts();
  const params = new URLSearchParams(location.search);
  if (params.get('track') && [...sel('track').options].some((o) => o.value === params.get('track'))) sel('track').value = params.get('track');
  if (params.get('wet') === '1') sel('wet').value = '1';
  sel('track').addEventListener('change', () => loadList());
  sel('wet').addEventListener('change', () => loadList());
  sel('a').addEventListener('change', loadLaps);
  sel('b').addEventListener('change', loadLaps);
  new ResizeObserver(() => A && drawCharts()).observe(chartsEl);
  loadList(params.get('user'));
})();
