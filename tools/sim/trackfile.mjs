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
