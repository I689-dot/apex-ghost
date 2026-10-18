# APEX GHOST

Online multiplayer sim racing in the browser for a private group of friends: up to 12 players per room, keyboard-only cockpit driving, timed qualifying at the Nürburgring GP (or its short layout) or Circuit Zandvoort, with ghost cars, damage, and random weather and time of day.

- **Client:** Vite + Three.js + Rapier, deployed as a static site on Vercel.
- **Server:** Cloudflare Workers + Durable Objects, free plan.

See [DECISIONS.md](DECISIONS.md) for every design choice and [ASSET_REPORT.md](ASSET_REPORT.md) for the asset inventory and conversion results.

## Requirements

- Node.js 22 and pnpm 9 (`corepack enable` or `npm i -g pnpm@9`).
- A Cloudflare account (free) for the server, and a Vercel account (free) for the client.
- **Only to re-run the asset pipeline** (the converted assets are already in `apps/client/public/assets`):
  - Blender 4.2;
  - Python 3 with `usd-core`;
  - KTX-Software (`toktx`).

  On Linux x64 one command installs all three into `~/.local/opt`, no sudo:

  ```bash
  pnpm setup:tools
  ```

  Elsewhere, install them yourself and set `BLENDER=/path/to/blender`, `USD_PYTHON=/path/to/python-with-usd-core` and `KTX_DIR=/path/to/KTX-Software`.

## 1. Install

```bash
pnpm install
```

## 2. Asset pipeline (optional, already done)

```bash
pnpm assets
```

The pipeline converts everything in `3D MODELS/` (USDC) into optimised GLB/KTX2 files plus `cars.json` and `track.json` in `apps/client/public/assets`. It takes about 30 minutes. Steps:

1. `inventory` writes `ASSET_REPORT.md`.
2. `cars`: Blender normalises each car, splits the wheels, finds the cockpit anchor and renders a thumbnail.
3. `map`: traces the centreline, places gates, sectors and grid, builds collision and render chunks.
4. `optimize`: LODs, Meshopt and KTX2.
5. `report` updates `ASSET_REPORT.md`.

Run one step with `pnpm assets --only cars` (or `map`, `optimize`, `report`). Run one car with `--car <id>`; add `--force` to rebuild.

**Maps.** Each map is configured in `tools/asset-pipeline/maps/<id>.json` (`nurburgring`, `zandvoort`): source model, output folder (`tools/asset-pipeline/out/map`, `out/map_zandvoort`), runtime asset folder (`public/assets/track`, `public/assets/maps/zandvoort`), layouts and turn counts, and for maps whose source has generic material names (Zandvoort) the material renames, surface rules, pit lane and other analysis settings. Rebuild one map:

```bash
pnpm assets --only map --map zandvoort        # track analysis + Blender chunks (~1 min)
pnpm assets --only optimize --map zandvoort   # textures, meshes, collision, hole fill, layout JSONs (~30 s)
node tools/asset-pipeline/optimize.mjs --map zandvoort --only tracks      # layout JSONs only
node tools/asset-pipeline/optimize.mjs --map zandvoort --only collision   # collision + hole fill + JSONs
```

Set `MODELS_DIR=/path/to/3D MODELS` when the sources are elsewhere (for example in a git worktree). Each run updates its own map's entries in `public/assets/tracks.json` (the lobby list) and `packages/shared/src/generated/tracks-race.json` (server lap validation) and keeps the other maps'. Check a rebuilt map with `pnpm tsx tools/sim/holes.ts --track zandvoort`, `node tools/sim/pitlat.mjs 0 640 --track zandvoort`, `pnpm tsx tools/sim/ailap.ts --track zandvoort --laps 3` and `node tools/e2e/tour.mjs --track zandvoort --aerial`; debug plots are in the map's output folder (`debug_track.png`, `debug_grid.png`).

Car physics live in `tools/asset-pipeline/cars.config.json` and are meant to be edited by hand. After editing, run `pnpm assets --only optimize` to regenerate `cars.json`.

## 3. Run locally

```bash
pnpm dev
```

This starts:

- the realtime server with `wrangler dev` on <http://localhost:8787>;
- the game with Vite on <http://localhost:5173>.

Open the game in several browser tabs (or on several PCs on your LAN, using `http://<your-ip>:5173`) to test multiplayer. One tab creates a room; the others join with the 5-letter code.

Dev builds add:

- **F2:** the track data editor (centreline, gates, grid, surface types; nudge items and export `track.json`);
- the performance overlay.

## 4. Tests

```bash
pnpm test          # unit tests (protocol, room codes, nicknames, car-lock race condition, laps, positions, weather, clock sync)
pnpm lint          # eslint + prettier check
pnpm typecheck     # strict TypeScript in every package
pnpm loadtest      # 12 headless clients race a full 3-lap race (needs `pnpm dev` running in another terminal)
pnpm sim -- 2024_porsche_992_gt3_r   # vehicle-dynamics numbers for one car (0-100, top speed, braking, cornering g, drift)
pnpm e2e           # browser smoke test with Playwright (needs `pnpm dev`; first run: `npx playwright install chromium`); add --gpu for real GPU fps, --bots 5 to race bots
pnpm tsx tools/sim/ailap.ts 2024_porsche_992_gt3_r   # one bot lap on the real track per skill level (+ theoretical lap time); --track zandvoort, --laps 3 --wet 1 --slot 5
pnpm tsx tools/sim/flatness.ts       # bumps, steps and stacked ground layers under the road, per stretch
node tools/e2e/botrace.mjs --bots 7 --minutes 3 --gpu   # bots in a real session: resets, spins, offs, overlaps (needs `pnpm dev`)
node tools/e2e/cockpitlab.mjs --cars 0,16             # each car's cockpit from several eye positions
node tools/e2e/lapviews.mjs                           # the lap at driver height and from the air, with a z-fighting check
pnpm tsx tools/sim/calibrate.ts      # fit each car's drag to its spec top speed (--write to save)
pnpm tsx tools/sim/engineaudio.ts    # render every engine's rev sweep to tools/sim/out/*.wav (--synth: old procedural sound)
pnpm tsx tools/sim/steerresp.ts      # keyboard steering response of every car at 120/200/250 km/h
node tools/e2e/profile.mjs --quality medium   # GPU cost of individual features (needs `pnpm dev`)
```

`pnpm loadtest` accepts `--url https://your-worker.workers.dev` to test the deployed server. It prints how many free-plan requests one race uses.

## 5. Deploy the server (Cloudflare Workers, free)

```bash
cd apps/server
npx wrangler login              # once, opens the browser
cd ../..
pnpm deploy:server
```

Wrangler prints the URL, for example `https://apex-ghost-server.<your-subdomain>.workers.dev`. Keep it for the next step.

The free plan is enough: one Durable Object per room, SQLite-backed, with the WebSocket Hibernation API. About 60 full 12-player races a day fit in the free 100,000 requests (see DECISIONS.md).

## 6. Deploy the client (Vercel, free)

```bash
npm i -g vercel                 # once
vercel login                    # once
echo "VITE_SERVER_URL=https://apex-ghost-server.<your-subdomain>.workers.dev" > apps/client/.env.production.local
pnpm deploy:client
```

`deploy:client` builds the static site into `apps/client/dist/apex-ghost` and uploads it with `vercel deploy --prod`. The first deploy creates a Vercel project called `apex-ghost` automatically. Vercel shows the `*.vercel.app` URL at the end; share that with your friends.

`apps/client/public/vercel.json` sets long-term caching for the hashed and immutable assets. The build is about 90 MB, under the Hobby plan's 100 MB upload limit.

## Environment variables

| Variable | Where | Default | Purpose |
|---|---|---|---|
| `VITE_SERVER_URL` | client build (`apps/client/.env.production.local` or shell) | `http://<page-host>:8787` | Realtime server base URL (`https://…workers.dev`); the client derives `wss://` from it. |
| `BLENDER`, `USD_PYTHON`, `KTX_DIR` | asset pipeline | `~/.local/opt/...` | Tool locations. |
| `SERVER_URL` | load test | `http://localhost:8787` | Same as `--url`. |

## Controls (remappable in Settings)

| Action | Keys |
|---|---|
| Throttle / brake (hold brake when stopped to reverse) | W / S or ↑ / ↓ |
| Steer | A / D or ← / → |
| Handbrake (ramped, speed-faded: rotates the car, doesn't spin it) | Space |
| Shift up / down (manual mode) | Left Shift or E / Left Ctrl or Q |
| Manual / automatic gearbox | M |
| Reset to the last checkpoint (the lap no longer counts) | R |
| Look left / right / back | Z / C / X |
| Timing screen (hold) | Tab |
| Pause menu (the race keeps running) | Esc |

How a session works (as in GT3 qualifying): the host picks the length in the lobby (default 10 minutes). Lap 1 from the grid is an untimed **out lap**, then lap as often as you like; **the best valid lap wins**. When the clock runs out, the chequered flag falls and you finish the lap you're on. A lap is invalid if all four wheels leave the track or if you reset.

Before the session: the host picks the track (Nürburgring GP 5.2 km, the Nürburgring short layout without the Müllenbachschleife 4.1 km, or Circuit Zandvoort 4.3 km), weather, time of day, whether conditions change, and the length. Everyone sees the exact forecast and sets up their car: starting tyres, rear wing (top speed vs cornering) and brake balance, with an engineer's suggestion.

During the session: hold **Tab** for the full timing screen (best lap, gaps, last lap, sectors, status). Your best valid lap is replayed as a ghost car (Settings → Best-lap ghost). Following another car closely gives you a slipstream; brakes heat up and fade when overheated (dots on the wheels of the HUD instrument).

Pit stops: take the pit entry on the inside of the last corner (at Zandvoort: on the right of the main straight, 100 m before the line; the exit lane runs inside Tarzan and rejoins at Gerlach). The 60 km/h limiter engages automatically. Stop in the yellow PIT SERVICE box beside the start line to change tyres (Soft / Medium / Hard / Wet; softs are fastest but wear quickly, wets for rain) and repair bodywork, suspension or engine. Each job takes time and the session clock keeps running. The lap after the pit exit is an out lap.

The HUD shows the session clock, OUT / lap, INVALID, the live delta to your best lap, and the tyre instrument (temperature, tread, compound, damage). Settings → Racing line shows the braking line.

Before the start: a TV-style intro (aerial flyover with the track map and entry list, then a pass down the grid naming every driver). Press Enter to skip it.

Sound (if you open the game through a LAN address, the engines use a fallback that works on plain http): engines are real onboard recordings by Pole Position Production (Porsche flat-six, Audi V10, BMW inline-six, McLaren and Ferrari V8s, Dodge Viper V10, from the royalty-free Sonniss GDC bundles; see DECISIONS.md), turned into rpm loop banks and played with granular synthesis over a light layer synthesized from each car's real firing order, plus tyres, kerbs, gravel, wind, rain, crowd and birds. Browsers start audio after your first click. Settings → Sound has the volumes.

The bottom-left instrument shows your tyres (°C, blue cold, green ready, red hot), damage on the car's body, and the ABS / TC lamps.

Bots: the room host can add AI drivers in the lobby (**+ Add bot**, ✕ to remove). They are simulated on the host's computer and race as ghosts like everyone else.

## Project layout

```
apps/client            Vite + Three.js game (static, Vercel)
apps/server            Cloudflare Worker + Durable Object rooms (RoomCore is host-agnostic)
packages/shared        protocol, binary codec, race tracker, weather, validation, types
tools/asset-pipeline   USDC → GLB pipeline (Blender, usd-core, gltf-transform, toktx)
tools/loadtest         12-client race load test
tools/sim              headless vehicle-dynamics checks
tools/e2e              browser smoke test
3D MODELS              source assets (not deployed)
```
