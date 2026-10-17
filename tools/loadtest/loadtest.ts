/**
 * Load test: 12 headless fake clients join one room, lock different cars, and drive a full
 * qualifying session (default 4 minutes: out lap, laps until the chequered flag, finish the last lap) along the
 * track centreline, sending realistic binary state packets.
 * Test tool only (not in-game bots).
 *
 *   pnpm loadtest [--url http://localhost:8787] [--clients 12] [--speed 55] [--minutes 4]
 *
 * Verifies: unique car locks, synchronised countdown, server-validated laps, results for all,
 * and reports the message volume against the Cloudflare free-plan request allowance.
 */
import WebSocket from 'ws';
import {
  CLIENT_HEADER,
  PROTOCOL_VERSION,
  STATE_BYTES,
  STATE_HZ,
  STATES_PER_PACKET,
  encodeClientStates,
  makeCarState,
  type CarState,
  type ServerMsg,
  type TrackRaceData,
} from '../../packages/shared/src/index.ts';
import track from '../../packages/shared/src/generated/track-race.json' with { type: 'json' };
import carIds from '../../packages/shared/src/generated/car-ids.json' with { type: 'json' };

const args = process.argv.slice(2);
const opt = (k: string, d: string) => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : d);
const URL_BASE = opt('url', process.env.SERVER_URL ?? 'http://localhost:8787');
const N = Number(opt('clients', '12'));
const BASE_SPEED = Number(opt('speed', '55'));
const SESSION_MIN = Number(opt('minutes', '4'));
const T = track as unknown as TrackRaceData;
const CARS = carIds as string[];

const FREE_DO_REQUESTS_PER_DAY = 100_000;
const WS_MESSAGES_PER_REQUEST = 20;

interface Bot {
  i: number;
  nick: string;
  ws: WebSocket;
  id: string;
  offset: number;
  inbox: ServerMsg[];
  sent: number;
  binRecv: number;
  speed: number;
  lateral: number;
  laps: number;
  finished: number | null;
  carId: string | null;
  waiters: { pred: (m: ServerMsg) => boolean; res: (m: ServerMsg) => void }[];
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function connect(code: string, nick: string, i: number): Promise<Bot> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${URL_BASE.replace(/^http/, 'ws')}/api/rooms/${code}/ws`);
    ws.binaryType = 'arraybuffer';
    const bot: Bot = {
      i,
      nick,
      ws,
      id: '',
      offset: 0,
      inbox: [],
      sent: 0,
      binRecv: 0,
      speed: BASE_SPEED * (0.9 + (i % 5) * 0.035),
      lateral: ((i % 4) - 1.5) * 1.6,
      laps: 0,
      finished: null,
      carId: null,
      waiters: [],
    };
    ws.on('open', () => {
      ws.send(JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION, nick, session: null }));
      bot.sent++;
    });
    ws.on('message', (data: Buffer | ArrayBuffer, isBinary: boolean) => {
      if (isBinary) {
        bot.binRecv++;
        return;
      }
      const m = JSON.parse(data.toString()) as ServerMsg;
      bot.inbox.push(m);
      if (m.t === 'welcome') {
        bot.id = m.you;
        bot.offset = m.serverTime - Date.now();
        resolve(bot);
      }
      if (m.t === 'error' && m.fatal) reject(new Error(`${nick}: ${m.message}`));
      if (m.t === 'lap' && m.playerId === bot.id) bot.laps = m.lap;
      if (m.t === 'finished' && m.playerId === bot.id) bot.finished = m.totalMs;
      for (const w of [...bot.waiters]) {
        if (w.pred(m)) {
          bot.waiters.splice(bot.waiters.indexOf(w), 1);
          w.res(m);
        }
      }
    });
    ws.on('error', reject);
  });
}

function waitFor<T extends ServerMsg['t']>(
  bot: Bot,
  t: T,
  timeout = 60_000,
  pred: (m: Extract<ServerMsg, { t: T }>) => boolean = () => true,
): Promise<Extract<ServerMsg, { t: T }>> {
  const existing = bot.inbox.find((m) => m.t === t && pred(m as Extract<ServerMsg, { t: T }>));
  if (existing) return Promise.resolve(existing as Extract<ServerMsg, { t: T }>);
  return new Promise((res, rej) => {
    const timer = setTimeout(() => rej(new Error(`${bot.nick}: timeout waiting for ${t}`)), timeout);
    bot.waiters.push({
      pred: (m) => m.t === t && pred(m as Extract<ServerMsg, { t: T }>),
      res: (m) => {
        clearTimeout(timer);
        res(m as Extract<ServerMsg, { t: T }>);
      },
    });
  });
}

function send(bot: Bot, msg: object) {
  bot.ws.send(JSON.stringify(msg));
  bot.sent++;
}

/** Point on the centreline at distance s (+ lateral offset), with heading. */
function pose(s: number, lateral: number, out: CarState): void {
  const L = T.length;
  s = ((s % L) + L) % L;
  let i = 0;
  while (i < T.cumS.length - 1 && T.cumS[i + 1] <= s) i++;
  const j = (i + 1) % T.cumS.length;
  const seg = (j === 0 ? L : T.cumS[j]) - T.cumS[i];
  const u = (s - T.cumS[i]) / seg;
  const c = T.centerline;
  const dx = c[j * 3] - c[i * 3];
  const dz = c[j * 3 + 2] - c[i * 3 + 2];
  const len = Math.hypot(dx, dz) || 1;
  out.px = c[i * 3] + dx * u + (dz / len) * lateral;
  out.py = c[i * 3 + 1] + (c[j * 3 + 1] - c[i * 3 + 1]) * u + 0.3;
  out.pz = c[i * 3 + 2] + dz * u - (dx / len) * lateral;
  const yaw = Math.atan2(dx, dz);
  out.qx = 0;
  out.qy = Math.sin(yaw / 2);
  out.qz = 0;
  out.qw = Math.cos(yaw / 2);
}

async function drive(bot: Bot, startAt: number, gridS: number): Promise<void> {
  const buf = new ArrayBuffer(CLIENT_HEADER + STATE_BYTES * 4);
  const states = [makeCarState(), makeCarState()];
  let seq = 0;
  let n = 0;
  const dt = 1000 / STATE_HZ;
  const now = () => Date.now() + bot.offset;
  let s = gridS;
  while (bot.finished === null) {
    if (bot.ws.readyState !== WebSocket.OPEN) throw new Error(`${bot.nick}: connection closed by the server`);
    const t = now();
    const racing = t >= startAt;
    if (racing) {
      // a bit slower in the first seconds (standing start), some variation along the lap
      const accel = Math.min(1, (t - startAt) / 6000);
      s += (bot.speed * (0.35 + 0.65 * accel) * (0.92 + 0.08 * Math.sin(s / 180 + bot.i)) * dt) / 1000;
    }
    const st = states[n];
    st.t = Math.round(t);
    pose(s, bot.lateral, st);
    st.vx = bot.speed;
    st.flags = 0;
    n++;
    if (n === STATES_PER_PACKET) {
      const len = encodeClientStates(buf, seq++, states, n);
      bot.ws.send(buf.slice(0, len));
      bot.sent++;
      n = 0;
    }
    if (seq % 30 === 0 && n === 0) send(bot, { t: 'ping', c: performance.now() });
    await sleep(dt);
    if (now() - startAt > 15 * 60_000) throw new Error(`${bot.nick}: race did not finish in 15 minutes`);
  }
}

async function main() {
  console.log(`▶ load test: ${N} clients → ${URL_BASE}`);
  if (CARS.length < N) console.warn(`  only ${CARS.length} cars available; some clients will not race`);
  const res = await fetch(`${URL_BASE}/api/rooms`, { method: 'POST' });
  if (!res.ok) throw new Error(`create room failed: ${res.status}`);
  const { code } = (await res.json()) as { code: string };
  console.log(`  room ${code}`);
  const bots: Bot[] = [];
  for (let i = 0; i < N; i++) bots.push(await connect(code, `Bot${String(i + 1).padStart(2, '0')}`, i));
  console.log(`  ${bots.length} joined`);

  // everyone grabs a car at the same time; half of them first fight over the same car
  await Promise.all(bots.map((b) => send(b, { t: 'selectCar', carId: CARS[0] })));
  await sleep(500);
  const winners = bots.filter((b) => b.inbox.some((m) => m.t === 'carLock' && m.ok && m.carId === CARS[0]));
  if (winners.length !== 1) throw new Error(`car lock broken: ${winners.length} players got ${CARS[0]}`);
  console.log(`  ✔ contested car locked by exactly one player (${winners[0].nick})`);
  winners[0].carId = CARS[0];
  let next = 1;
  for (const b of bots) {
    if (b.carId) continue;
    b.carId = CARS[next++ % CARS.length];
    send(b, { t: 'selectCar', carId: b.carId });
  }
  await sleep(500);
  const room = bots[0].inbox.filter((m) => m.t === 'room').pop() as Extract<ServerMsg, { t: 'room' }>;
  const owners = Object.values(room.room.carLocks);
  if (new Set(owners).size !== owners.length) throw new Error('two players hold the same car!');
  console.log(`  ✔ ${owners.length} unique car locks`);
  for (const b of bots) send(b, { t: 'ready', ready: true });
  await sleep(400);
  send(bots[0], { t: 'setSession', minutes: SESSION_MIN });
  await new Promise((r) => setTimeout(r, 300));
  send(bots[0], { t: 'start' });
  const setups = await Promise.all(bots.map((b) => waitFor(b, 'raceSetup')));
  const race = setups[0].race;
  if (!setups.every((s) => s.race.seed === race.seed)) throw new Error('weather seed mismatch');
  console.log(`  ✔ race ${race.raceId}: ${race.weather.kind} at ${race.weather.startHour.toFixed(2)} h, same seed for all`);
  for (const b of bots) send(b, { t: 'loaded', raceId: race.raceId });
  const cds = await Promise.all(bots.map((b) => waitFor(b, 'countdown')));
  if (!cds.every((c) => c.startAt === cds[0].startAt)) throw new Error('countdown mismatch');
  const startAt = cds[0].startAt;
  console.log(`  ✔ synchronised countdown, start in ${((startAt - (Date.now() + bots[0].offset)) / 1000).toFixed(1)} s`);

  const t0 = Date.now();
  const sentBefore = bots.reduce((s, b) => s + b.sent, 0);
  // grid position as distance behind the start: use the race slot
  const progress = setInterval(() => {
    const leader = bots.reduce((a, b) => (b.laps > a.laps ? b : a));
    process.stdout.write(
      `\r  racing… ${((Date.now() - t0) / 1000).toFixed(0)} s, leader ${leader.laps === 0 ? 'out lap' : `lap ${leader.laps}`}, finished ${bots.filter((b) => b.finished !== null).length}/${bots.length}   `,
    );
  }, 1000);
  await Promise.all(bots.map((b) => drive(b, startAt, -12 - (race.slots[b.id] ?? 0) * 8 + T.gates[T.firstGate].s - 30)));
  const results = await Promise.all(bots.map((b) => waitFor(b, 'results', 90_000)));
  clearInterval(progress);
  process.stdout.write('\n');
  const rows = results[0].rows;
  console.log('  results:');
  for (const r of rows)
    console.log(
      `    P${r.position} ${r.nick.padEnd(6)} best ${r.bestLapMs !== null ? (r.bestLapMs / 1000).toFixed(3) : '-'}  valid laps ${r.validLaps}${r.dnf ? '  DNF' : ''}`,
    );
  const finishedAll = rows.filter((r) => !r.dnf).length;
  if (finishedAll !== bots.length) throw new Error(`only ${finishedAll}/${bots.length} finished`);
  console.log(`  ✔ all ${bots.length} drove a ${SESSION_MIN}-minute session to the chequered flag (server-validated laps)`);

  // usage report
  const raceSec = (Date.now() - t0) / 1000;
  const msgs = bots.reduce((s, b) => s + b.sent, 0) - sentBefore;
  const totalMsgs = bots.reduce((s, b) => s + b.sent, 0);
  const requests = Math.ceil(totalMsgs / WS_MESSAGES_PER_REQUEST) + bots.length + 1;
  const recvBin = bots.reduce((s, b) => s + b.binRecv, 0);
  console.log(
    `  messages client→server during race: ${msgs} (${(msgs / raceSec / bots.length).toFixed(1)}/s per client), relayed packets received: ${recvBin}`,
  );
  console.log(`  ≈ ${requests} billable Durable Object requests for this race (incoming WS msgs / ${WS_MESSAGES_PER_REQUEST} + connections)`);
  console.log(`  ≈ ${Math.floor(FREE_DO_REQUESTS_PER_DAY / requests)} full ${bots.length}-player races per day on the free plan (100k requests/day)`);
  for (const b of bots) b.ws.close();
  console.log('✔ load test passed');
}

main().catch((e) => {
  console.error('\n✘ load test failed:', e.message);
  process.exit(1);
});
