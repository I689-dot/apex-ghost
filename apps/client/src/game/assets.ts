import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import type { CarEntry, CarsFile, Surface, TrackData } from '@apex/shared';
import { ASSET_BASE } from '../config';
import { assetFetch } from '../mobile/assetCache';

export type Progress = (loaded: number, total: number, label: string) => void;

let loader: GLTFLoader | null = null;
let ktx2: KTX2Loader | null = null;

export function initLoaders(renderer: THREE.WebGLRenderer): GLTFLoader {
  if (loader) return loader;
  ktx2 = new KTX2Loader().setTranscoderPath(`${import.meta.env.BASE_URL}libs/basis/`).detectSupport(renderer);
  loader = new GLTFLoader().setKTX2Loader(ktx2).setMeshoptDecoder(MeshoptDecoder);
  return loader;
}

export function url(p: string): string {
  return `${ASSET_BASE}${p}`;
}

/** Attempts per file, and the wait before each retry (ms). */
const FETCH_TRIES = 4;
const RETRY_WAIT = [600, 1800, 4000];

/**
 * fetch with byte progress (used for the loading bar). A session downloads 50–75 MB in dozens of files (more
 * cars, more files), so a dropped connection or a server hiccup on one of them is retried instead of failing
 * the whole load; a missing file (4xx) fails at once.
 */
export async function fetchWithProgress(path: string, onBytes: (n: number) => void): Promise<ArrayBuffer> {
  for (let attempt = 1; ; attempt++) {
    let size = 0;
    try {
      const res = await assetFetch(url(path));
      if (!res.ok || !res.body) {
        const err = new Error(`Failed to load ${path} (${res.status})`);
        if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) (err as { fatal?: boolean }).fatal = true;
        throw err;
      }
      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        size += value.byteLength;
        onBytes(value.byteLength);
      }
      const out = new Uint8Array(size);
      let o = 0;
      for (const c of chunks) {
        out.set(c, o);
        o += c.byteLength;
      }
      return out.buffer;
    } catch (e) {
      onBytes(-size); // the progress bar counts this file again on the next attempt
      if ((e as { fatal?: boolean }).fatal || attempt >= FETCH_TRIES) throw e;
      console.warn(`[assets] ${path}: ${(e as Error).message}, retrying (${attempt}/${FETCH_TRIES - 1})`);
      await new Promise((r) => setTimeout(r, RETRY_WAIT[attempt - 1] ?? 4000));
    }
  }
}

/** A JSON asset, retried like the rest. */
async function fetchJson<T>(path: string, failMessage: string): Promise<T> {
  try {
    return JSON.parse(new TextDecoder().decode(await fetchWithProgress(path, () => {}))) as T;
  } catch (e) {
    console.warn(`[assets] ${path}:`, e);
    throw new Error(failMessage);
  }
}

/** Remember a load, but forget it when it fails, so the next session tries again instead of failing at once. */
function cached<K, V>(map: Map<K, Promise<V>>, key: K, make: () => Promise<V>): Promise<V> {
  let p = map.get(key);
  if (!p) {
    p = make();
    map.set(key, p);
    p.catch(() => map.get(key) === p && map.delete(key));
  }
  return p;
}

export async function parseGltf(buf: ArrayBuffer): Promise<GLTF> {
  if (!loader) throw new Error('loaders not initialised');
  return loader.parseAsync(buf, '');
}

const carsCache = new Map<string, Promise<CarsFile>>();
export function loadCarsFile(): Promise<CarsFile> {
  return cached(carsCache, 'cars', () =>
    fetchJson<CarsFile>('assets/cars.json', 'Could not load the car list (assets/cars.json). Did you run `pnpm assets`?').then((f) => {
      // thumbnails are page-relative paths: point them at the asset host when it is elsewhere (mobile app)
      if (ASSET_BASE !== import.meta.env.BASE_URL) for (const c of f.cars) if (c.thumbnail && !/^[a-z]+:/i.test(c.thumbnail)) c.thumbnail = url(c.thumbnail);
      return f;
    }),
  );
}

export interface TrackIndexEntry {
  id: string;
  name: string;
  length: number;
  turns: number | null;
  file: string;
  default: boolean;
  /** Map the layout belongs to (maps/<id>.json); absent = the Nürburgring. */
  map?: string;
}

const indexCache = new Map<string, Promise<TrackIndexEntry[]>>();
/** The layouts the host can choose (assets/tracks.json); empty while it can't be loaded (asked again next time). */
export function loadTrackIndex(): Promise<TrackIndexEntry[]> {
  return cached(indexCache, 'index', () =>
    fetchJson<{ tracks: TrackIndexEntry[] }>('assets/tracks.json', 'Could not load the track list.').then((j) => j.tracks),
  ).catch(() => []);
}

const trackFiles = new Map<string, Promise<TrackData>>();
/** A layout by id (the default GP when the id is unknown). */
export async function loadTrackFile(trackId?: string): Promise<TrackData> {
  const index = await loadTrackIndex();
  // without the list a chosen layout can't be found: never fall back to another circuit than the session's
  if (trackId && !index.length) throw new Error('Could not load the track list.');
  const entry = index.find((t) => t.id === trackId) ?? index.find((t) => t.default);
  const file = entry?.file ?? 'assets/track.json';
  return cached(trackFiles, file, () =>
    fetchJson<TrackData>(file, `Could not load the track (${file}).`).then((d) => ({
      ...d,
      turns: d.turns ?? entry?.turns ?? null,
      map: entry?.map ?? 'nurburgring',
    })),
  );
}

/* ------------------------------------------------------------- cars --- */

export interface CarModel {
  entry: CarEntry;
  lods: THREE.Group[];
  /** LOD index of lods[0] (1: the light levels only, LOD0 added later). */
  firstLevel: number;
}

const carModels = new Map<string, Promise<CarModel>>();

/**
 * Loads LODs `firstLevel` … `lodsWanted - 1` of a car once; instances are cloned from these.
 * `cockpit`: your own car with its high-detail interior model in place of LOD0 (when the car has one).
 */
export function loadCarModel(entry: CarEntry, onBytes: (n: number) => void = () => {}, lodsWanted = 3, cockpit = false, firstLevel = 0): Promise<CarModel> {
  const files = cockpit && entry.cockpit ? [entry.cockpit, ...entry.lods.slice(1)] : entry.lods;
  const first = Math.min(firstLevel, files.length - 1);
  const key = `${entry.id}:${first}-${lodsWanted}:${cockpit && !!entry.cockpit}`;
  return cached(carModels, key, async () => {
    const lods: THREE.Group[] = [];
    for (const f of files.slice(first, lodsWanted)) {
      const g = await parseGltf(await fetchWithProgress(f, onBytes));
      lods.push(g.scene);
    }
    return { entry, lods, firstLevel: first };
  });
}

/* -------------------------------------------------------- collision --- */

export interface CollisionMesh {
  surface: Surface;
  positions: Float32Array;
  indices: Uint32Array;
}

export async function loadCollision(track: TrackData, onBytes: (n: number) => void): Promise<CollisionMesh[]> {
  const files = [track.collision.file, ...(track.collision.extra ?? [])];
  const all = await Promise.all(files.map((f) => loadCollisionFile(f, track, onBytes)));
  return all.flat();
}

async function loadCollisionFile(file: string, track: TrackData, onBytes: (n: number) => void): Promise<CollisionMesh[]> {
  const raw = await fetchWithProgress(file, onBytes);
  const head = new Uint8Array(raw, 0, 2);
  // gzip magic → inflate here; otherwise the host already decoded it (Content-Encoding)
  const buf =
    head[0] === 0x1f && head[1] === 0x8b ? await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer() : raw;
  const dv = new DataView(buf);
  const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (magic !== 'APXC') throw new Error('Invalid collision file');
  const n = dv.getUint32(8, true);
  let o = 12;
  const out: CollisionMesh[] = [];
  for (let i = 0; i < n; i++) {
    const si = dv.getUint32(o, true);
    const nv = dv.getUint32(o + 4, true);
    const ni = dv.getUint32(o + 8, true);
    o += 12;
    const positions = new Float32Array(buf.slice(o, o + nv * 12));
    o += nv * 12;
    const indices = new Uint32Array(buf.slice(o, o + ni * 4));
    o += ni * 4;
    out.push({ surface: track.collision.surfaces[si], positions, indices });
  }
  return out;
}
