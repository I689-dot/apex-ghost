/**
 * Applies kerb_conform.mjs (subdivide, then conformKerbs) to a finished collision file (.apxc): kerbs added after the pipeline's conform pass (or
 * files built before it) get the same treatment. Writes the file in place (gzip kept).
 *   node tools/asset-pipeline/conform_apxc.mjs [--track=godot/data/tracks/spa.json --stray=3200:3320[,...]] <file.apxc>...
 * --stray: lap stretches (m) where stacked road pieces over the road are removed (dropCoveredRoad).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';

const opts = Object.fromEntries(process.argv.filter((a) => a.startsWith('--')).map((a) => a.slice(2).split('=')));
const files = process.argv.slice(2).filter((a) => !a.startsWith('--'));
/** Circles along the given stretches of the lap's centreline. */
function strayZones() {
  if (!opts.track || !opts.stray) return [];
  const td = JSON.parse(readFileSync(opts.track, 'utf8'));
  const zones = [];
  for (const range of opts.stray.split(',')) {
    const [s0, s1] = range.split(':').map(Number);
    for (let i = 0; i < td.cumS.length; i++)
      if (td.cumS[i] >= s0 && td.cumS[i] <= s1) zones.push({ x: td.centerline[i * 3], z: td.centerline[i * 3 + 2], r: 12 });
  }
  return zones;
}
import { conformKerbs, dropCoveredRoad, kerbSkirts, lowerRoadSpikes, lowerStrayRoad, subdivide } from './kerb_conform.mjs';

const SURFACES = ['asphalt', 'curb', 'grass', 'gravel', 'sand', 'wall'];
for (const file of files) {
  const raw = readFileSync(file);
  const gz = raw[0] === 0x1f && raw[1] === 0x8b;
  const buf = gz ? gunzipSync(raw) : raw;
  if (buf.toString('ascii', 0, 4) !== 'APXC') throw new Error(`${file}: not an APXC file`);
  const n = buf.readUInt32LE(8);
  const parts = [];
  let o = 12;
  for (let i = 0; i < n; i++) {
    const si = buf.readUInt32LE(o);
    const nv = buf.readUInt32LE(o + 4);
    const ni = buf.readUInt32LE(o + 8);
    o += 12;
    const pos = new Float32Array(buf.buffer.slice(buf.byteOffset + o, buf.byteOffset + o + nv * 12));
    o += nv * 12;
    const idx = new Int32Array(buf.buffer.slice(buf.byteOffset + o, buf.byteOffset + o + ni * 4));
    o += ni * 4;
    parts.push({ si, pos, idx });
  }
  const zones = strayZones();
  if (zones.length)
    console.log(
      `${file}: ${dropCoveredRoad(
        parts.filter((p) => SURFACES[p.si] === 'asphalt'),
        zones,
      )} stray road triangles over the road removed, ${lowerStrayRoad(
        parts.filter((p) => SURFACES[p.si] === 'asphalt'),
        zones,
      )} vertices lowered onto the road under them, ${lowerRoadSpikes(
        parts.filter((p) => SURFACES[p.si] === 'asphalt'),
        zones,
      )} spikes brought down to the road around them`,
    );
  for (const p of parts) if (SURFACES[p.si] === 'curb') Object.assign(p, subdivide(p.pos, p.idx));
  const of = (s) => parts.filter((p) => SURFACES[p.si] === s);
  const k = conformKerbs(of('asphalt'), of('curb'), [...of('grass'), ...of('gravel'), ...of('sand')]);
  const skirt = kerbSkirts(of('asphalt'), of('curb'), [...of('grass'), ...of('gravel'), ...of('sand')]);
  parts.push({ si: SURFACES.indexOf('grass'), ...skirt });
  console.log(`${file}: ${skirt.idx.length / 6} kerb edges skirted`);
  const chunks = [Buffer.from(buf.subarray(0, 12))];
  chunks[0].writeUInt32LE(parts.length, 8);
  for (const p of parts) {
    const h = Buffer.alloc(12);
    h.writeUInt32LE(p.si, 0);
    h.writeUInt32LE(p.pos.length / 3, 4);
    h.writeUInt32LE(p.idx.length, 8);
    chunks.push(h, Buffer.from(p.pos.buffer, p.pos.byteOffset, p.pos.byteLength), Buffer.from(p.idx.buffer, p.idx.byteOffset, p.idx.byteLength));
  }
  const out = Buffer.concat(chunks);
  writeFileSync(file, gz ? gzipSync(out, { level: 9 }) : out);
  console.log(
    `${file}: ${k.moved} kerb vertices moved (up to ${(k.maxMove * 100).toFixed(1)} cm), ${k.ground} ground vertices followed, ${k.lifted} raised to meet a kerb`,
  );
}
