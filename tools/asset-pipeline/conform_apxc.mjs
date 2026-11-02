/**
 * Applies kerb_conform.mjs (subdivide, then conformKerbs) to a finished collision file (.apxc): kerbs added after the pipeline's conform pass (or
 * files built before it) get the same treatment. Writes the file in place (gzip kept).
 *   node tools/asset-pipeline/conform_apxc.mjs apps/client/public/assets/maps/spa/collision.apxc
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';
import { conformKerbs, kerbSkirts, subdivide } from './kerb_conform.mjs';

const SURFACES = ['asphalt', 'curb', 'grass', 'gravel', 'sand', 'wall'];
for (const file of process.argv.slice(2)) {
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
  console.log(`${file}: ${k.moved} kerb vertices moved (up to ${(k.maxMove * 100).toFixed(1)} cm), ${k.ground} ground vertices followed, ${k.lifted} raised to meet a kerb`);
}
