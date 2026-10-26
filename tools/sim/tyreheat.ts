/**
 * Tyre temperature survey and calibration: every car runs 3 laps with the bots' AI (tools/sim/ailap.ts, in
 * parallel) and its flying laps' front/rear tyre temperatures are compared. GT3 slicks work in about 70–100 °C, best
 * near 85–90 °C (Pirelli's GT3 tyre, ACC's licensed model). A car whose hotter axle runs past `--max` on average gets
 * a tyreHeatScale (its tyres' thermal size: heat capacity and cooling, × — real tyres are built for their car) that
 * brings it to `--target`; cars inside the window keep theirs. The temperature over the air settles in inverse
 * proportion to the scale, so one pass is close and a second refines it.
 *
 *   pnpm tsx tools/sim/tyreheat.ts                    # survey (GP, Medium, 0.95 skill)
 *   pnpm tsx tools/sim/tyreheat.ts --write            # also store the scales in cars.config.json, then
 *   node tools/asset-pipeline/car_specs.mjs           # regenerate cars.json from it
 *   options: --track <layout id>  --jobs 8  --target 88  --max 92
 */
import { execFile } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CarsFile } from '../../packages/shared/src/index.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const cfgPath = path.join(root, 'tools/asset-pipeline/cars.config.json');
const args = process.argv.slice(2);
const opt = (k: string, d: string) => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : d);
const TRACK = opt('track', '');
const JOBS = Number(opt('jobs', '8'));
const TARGET = Number(opt('target', '88'));
const MAX = Number(opt('max', '92'));
/** What the tyres would cool to with no work (air and track): the base of the inverse scaling. */
const BASE = 30;
const cars = JSON.parse(readFileSync(path.join(root, 'apps/client/public/assets/cars.json'), 'utf8')) as CarsFile;
const ids = cars.cars.filter((c) => c.role !== 'safety').map((c) => c.id);

interface Result {
  id: string;
  front: number;
  rear: number;
  peak: number;
  lap: string;
}
const run = (id: string) =>
  new Promise<Result | null>((resolve) => {
    const a = ['tsx', 'tools/sim/ailap.ts', id, '--laps', '3', '--skills', '0.95', ...(TRACK ? ['--track', TRACK] : [])];
    execFile('corepack', ['pnpm', ...a], { cwd: root, maxBuffer: 1 << 26, timeout: 30 * 60_000 }, (_e, out) => {
      const m = /flying laps avg (\d+)\/(\d+), peak (\d+)/.exec(out);
      const lap = /lap ([\d:.]+(?: [\d:.]+)*), resets/.exec(out)?.[1] ?? '?';
      resolve(m ? { id, front: Number(m[1]), rear: Number(m[2]), peak: Number(m[3]), lap } : null);
    });
  });

const results: Result[] = [];
const queue = [...ids];
await Promise.all(
  Array.from({ length: JOBS }, async () => {
    for (let id = queue.shift(); id; id = queue.shift()) {
      const r = await run(id);
      if (r) results.push(r);
      else console.log(`  ${id}: no result`);
    }
  }),
);
const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
console.log(`car${' '.repeat(37)}front/rear °C  peak  scale now → new   (laps)`);
let changed = 0;
for (const r of results.sort((a, b) => Math.max(b.front, b.rear) - Math.max(a.front, a.rear))) {
  const entry = cars.cars.find((c) => c.id === r.id);
  const now = entry?.specs.tyreHeatScale ?? 1;
  const hot = Math.max(r.front, r.rear);
  const next = hot > MAX ? Math.round(now * ((hot - BASE) / (TARGET - BASE)) * 100) / 100 : now;
  console.log(
    `${r.id.padEnd(40)} ${String(r.front).padStart(4)}/${String(r.rear).padEnd(4)}     ${String(r.peak).padStart(4)}   ${now.toFixed(2)} → ${next.toFixed(2)}   (${r.lap})`,
  );
  if (next !== now && args.includes('--write')) {
    const c = cfg.cars[r.id];
    c.specs = { ...(c.specs ?? {}), tyreHeatScale: next };
    changed++;
  }
}
if (changed) {
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
  await new Promise((r) => execFile('npx', ['prettier', '--write', cfgPath], { cwd: root }, r)); // the repo's JSON style
  console.log(`${changed} cars' tyreHeatScale written to cars.config.json: run node tools/asset-pipeline/car_specs.mjs`);
}
