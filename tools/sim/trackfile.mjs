/**
 * Track lookup for the headless tools: a layout id from public/assets/tracks.json (default: the default layout,
 * the Nürburgring GP) → its JSON and the bytes of its collision file.
 *
 *   const { track, collision } = loadTrack(trackArg(process.argv));
 */
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const PUB = path.resolve(here, '../../apps/client/public');

/** `--track <id>` from an argv list (or undefined). */
export function trackArg(argv) {
  const i = argv.indexOf('--track');
  return i >= 0 ? argv[i + 1] : undefined;
}

/** Asset URL as stored in the JSONs ("assets/…?v=…") → file path. */
export function assetPath(url) {
  return path.join(PUB, url.replace(/\?.*$/, ''));
}

/**
 * @param {string | undefined} id layout id; undefined = the default layout
 * @returns {{ track: any, collision: Buffer, file: string }}
 */
export function loadTrack(id) {
  const index = JSON.parse(readFileSync(path.join(PUB, 'assets/tracks.json'), 'utf8')).tracks;
  const entry = id ? index.find((t) => t.id === id) : index.find((t) => t.default);
  if (!entry) throw new Error(`unknown track ${id}; known: ${index.map((t) => t.id).join(', ')}`);
  const file = assetPath(entry.file);
  const track = JSON.parse(readFileSync(file, 'utf8'));
  const raw = readFileSync(assetPath(track.collision.file));
  const collision = raw[0] === 0x1f && raw[1] === 0x8b ? gunzipSync(raw) : raw;
  return { track, collision, file };
}

/** A collision file's bytes (gzipped or not) from a path. */
export function readCollisionFile(file) {
  const raw = readFileSync(file);
  return raw[0] === 0x1f && raw[1] === 0x8b ? gunzipSync(raw) : raw;
}

/**
 * The parts of a collision file (collision.apxc: a 12-byte header with the part count at byte 8, then per part its
 * surface index, vertex and index counts, positions as float32 xyz and triangle indices as uint32).
 * @param {Uint8Array} buf
 * @returns {{ surface: number, pos: Float32Array, idx: Uint32Array }[]}
 */
export function collisionParts(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const parts = [];
  let o = 12;
  for (let i = 0; i < dv.getUint32(8, true); i++) {
    const surface = dv.getUint32(o, true);
    const nv = dv.getUint32(o + 4, true);
    const ni = dv.getUint32(o + 8, true);
    o += 12;
    const pos = new Float32Array(buf.buffer.slice(buf.byteOffset + o, buf.byteOffset + o + nv * 12));
    o += nv * 12;
    const idx = new Uint32Array(buf.buffer.slice(buf.byteOffset + o, buf.byteOffset + o + ni * 4));
    o += ni * 4;
    parts.push({ surface, pos, idx });
  }
  return parts;
}
