#!/usr/bin/env node
/**
 * One-command asset pipeline:  pnpm assets [--only cars|map|optimize|inventory] [--car <id>] [--map <id>] [--jobs N] [--force]
 *
 * Maps are configured in maps/<id>.json (nurburgring, zandvoort). Without --map the map and optimize steps run for
 * every map; with --map only for that one (and optimize leaves the cars alone).
 *
 * 1. inventory  — usd-core walks `3D MODELS/` → ASSET_REPORT.md
 * 2. cars       — Blender headless: USDC → normalised GLB + meta JSON + thumbnail (per car)
 * 3. map        — Blender headless: USDC → render chunks GLB + collision/surface data + track analysis
 * 4. optimize   — gltf-transform: LODs, meshopt, KTX2/WebP, cars.json, track.json → apps/client/public/assets
 *
 * Tool locations can be overridden with env vars: BLENDER, USD_PYTHON, TOKTX.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const srcDir = process.env.MODELS_DIR ?? path.join(root, '3D MODELS'); // MODELS_DIR: sources elsewhere (e.g. from a git worktree)
const outDir = path.join(here, 'out');

const BLENDER = process.env.BLENDER ?? path.join(homedir(), '.local/opt/blender-4.2.3-linux-x64/blender');
const USD_PYTHON = process.env.USD_PYTHON ?? path.join(homedir(), '.local/opt/usdenv/bin/python');

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const only = opt('only', null);
const carFilter = opt('car', null);
const mapFilter = opt('map', null);
const MAPS = readdirSync(path.join(here, 'maps'))
  .filter((f) => f.endsWith('.json'))
  .map((f) => ({ ...JSON.parse(readFileSync(path.join(here, 'maps', f), 'utf8')), config: path.join(here, 'maps', f) }))
  .sort((a, b) => Number(b.default) - Number(a.default))
  .filter((m) => !mapFilter || m.id === mapFilter);
const jobs = Number(opt('jobs', '2'));
const force = args.includes('--force');

export function slug(name) {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/__?www\.vecarz/i, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .toLowerCase();
}

function run(cmd, argv, label) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, argv, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    let tail = '';
    const onData = (d) => {
      const s = d.toString();
      for (const line of s.split('\n')) {
        if (/^\[(car|map)\]|Error|Traceback/.test(line)) console.log(`  ${label}: ${line}`);
      }
      tail = (tail + s).slice(-4000);
    };
    p.stdout.on('data', onData);
    p.stderr.on('data', onData);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${label} failed (${code})\n${tail}`))));
  });
}

async function pool(items, n, fn) {
  const queue = [...items];
  const workers = Array.from({ length: n }, async () => {
    while (queue.length) await fn(queue.shift());
  });
  await Promise.all(workers);
}

function checkTools() {
  if (!existsSync(BLENDER)) {
    console.error(`Blender not found at ${BLENDER}. Install Blender 4.2 LTS (portable tarball is fine) and set BLENDER=/path/to/blender.`);
    process.exit(1);
  }
}

async function inventory() {
  console.log('▶ inventory');
  await run(USD_PYTHON, ['tools/asset-pipeline/inventory.py'], 'inventory');
}

function carSources() {
  const dirs = readdirSync(path.join(srcDir, 'CARS')).sort();
  const seen = new Map();
  const list = [];
  for (const d of dirs) {
    const f = path.join(srcDir, 'CARS', d, 'scene.usdc');
    if (!existsSync(f)) continue;
    const hash = createHash('sha1').update(readFileSync(f)).digest('hex');
    if (seen.has(hash)) {
      console.log(`  skip duplicate ${d} (identical to ${seen.get(hash)})`);
      continue;
    }
    seen.set(hash, d);
    list.push({ id: slug(d), dir: d, file: f });
  }
  return list;
}

async function cars() {
  console.log('▶ cars (Blender)');
  const out = path.join(outDir, 'cars');
  mkdirSync(out, { recursive: true });
  const list = carSources().filter((c) => !carFilter || c.id === carFilter);
  await pool(list, jobs, async (c) => {
    const glb = path.join(out, `${c.id}.glb`);
    if (!force && existsSync(glb) && statSync(glb).mtimeMs > statSync(c.file).mtimeMs) {
      console.log(`  ${c.id}: up to date`);
      return;
    }
    console.log(`  ${c.id}: converting`);
    await run(
      BLENDER,
      [
        '-b',
        '--factory-startup',
        '-P',
        'tools/asset-pipeline/blender/convert_car.py',
        '--',
        c.file,
        glb,
        path.join(out, `${c.id}.json`),
        path.join(out, `${c.id}.png`),
        c.id,
      ],
      c.id,
    );
  });
}

async function map() {
  for (const m of MAPS) {
    console.log(`▶ map ${m.id} (track analysis + Blender)`);
    const mapOut = path.join(outDir, m.out);
    mkdirSync(mapOut, { recursive: true });
    const usd = path.join(srcDir, m.source);
    // the Nürburgring analysis has no config section (its defaults are built in)
    const cfg = m.analysis ? [m.config] : [];
    await run(USD_PYTHON, ['tools/asset-pipeline/track_analysis.py', usd, mapOut, ...cfg], 'track');
    await run(BLENDER, ['-b', '--factory-startup', '-P', 'tools/asset-pipeline/blender/convert_map.py', '--', usd, mapOut, ...cfg], 'map');
  }
}

async function optimize() {
  console.log('▶ optimize (gltf-transform)');
  if (!mapFilter) await run(process.execPath, ['tools/asset-pipeline/optimize.mjs', '--only', 'cars', ...(carFilter ? ['--car', carFilter] : [])], 'optimize');
  for (const m of MAPS) await run(process.execPath, ['tools/asset-pipeline/optimize.mjs', '--map', m.id, '--only', 'map'], 'optimize');
}

async function report() {
  console.log('▶ report');
  await run(process.execPath, ['tools/asset-pipeline/report.mjs'], 'report');
}

const steps = { inventory, cars, map, optimize, report };
const t0 = Date.now();
if (only) {
  if (only === 'cars' || only === 'map') checkTools();
  await steps[only]();
} else {
  checkTools();
  for (const s of Object.values(steps)) await s();
}
console.log(`✔ assets done in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
