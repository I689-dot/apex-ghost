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

/** fetch with byte progress (used for the loading bar). */
export async function fetchWithProgress(path: string, onBytes: (n: number) => void): Promise<ArrayBuffer> {
  const res = await assetFetch(url(path));
  if (!res.ok || !res.body) throw new Error(`Failed to load ${path} (${res.status})`);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
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
}

export async function parseGltf(buf: ArrayBuffer): Promise<GLTF> {
  if (!loader) throw new Error('loaders not initialised');
  return loader.parseAsync(buf, '');
}

let carsCache: Promise<CarsFile> | null = null;
export function loadCarsFile(): Promise<CarsFile> {
  carsCache ??= assetFetch(url('assets/cars.json'))
    .then((r) => {
      if (!r.ok) throw new Error('Could not load the car list (assets/cars.json). Did you run `pnpm assets`?');
      return r.json() as Promise<CarsFile>;
    })
    .then((f) => {
      // thumbnails are page-relative paths: point them at the asset host when it is elsewhere (mobile app)
      if (ASSET_BASE !== import.meta.env.BASE_URL) for (const c of f.cars) if (c.thumbnail && !/^[a-z]+:/i.test(c.thumbnail)) c.thumbnail = url(c.thumbnail);
      return f;
    });
  return carsCache;
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

let indexCache: Promise<TrackIndexEntry[]> | null = null;
/** The layouts the host can choose (assets/tracks.json). */
export function loadTrackIndex(): Promise<TrackIndexEntry[]> {
  indexCache ??= assetFetch(url('assets/tracks.json'))
    .then((r) => (r.ok ? (r.json() as Promise<{ tracks: TrackIndexEntry[] }>) : { tracks: [] }))
    .then((j) => j.tracks)
    .catch(() => []);
  return indexCache;
}

const trackFiles = new Map<string, Promise<TrackData>>();
/** A layout by id (the default GP when the id is unknown). */
export async function loadTrackFile(trackId?: string): Promise<TrackData> {
  const index = await loadTrackIndex();
  const entry = index.find((t) => t.id === trackId) ?? index.find((t) => t.default);
  const file = entry?.file ?? 'assets/track.json';
  let p = trackFiles.get(file);
  if (!p) {
    p = assetFetch(url(file))
      .then((r) => {
        if (!r.ok) throw new Error(`Could not load the track (${file}).`);
        return r.json() as Promise<TrackData>;
      })
      .then((d) => ({ ...d, turns: d.turns ?? entry?.turns ?? null }));
    trackFiles.set(file, p);
  }
  return p;
}

/* ------------------------------------------------------------- cars --- */

export interface CarModel {
  entry: CarEntry;
  lods: THREE.Group[];
}

const carModels = new Map<string, Promise<CarModel>>();

/** Loads all LODs of a car once; instances are cloned from these. */
/** `cockpit`: your own car with its high-detail interior model in place of LOD0 (when the car has one). */
export function loadCarModel(entry: CarEntry, onBytes: (n: number) => void = () => {}, lodsWanted = 3, cockpit = false): Promise<CarModel> {
  const files = cockpit && entry.cockpit ? [entry.cockpit, ...entry.lods.slice(1)] : entry.lods;
  const key = `${entry.id}:${lodsWanted}:${cockpit && !!entry.cockpit}`;
  let p = carModels.get(key);
  if (!p) {
    p = (async () => {
      const lods: THREE.Group[] = [];
      for (const f of files.slice(0, lodsWanted)) {
        const g = await parseGltf(await fetchWithProgress(f, onBytes));
        lods.push(g.scene);
      }
      return { entry, lods };
    })();
    carModels.set(key, p);
  }
  return p;
}

/* -------------------------------------------------------- collision --- */

export interface CollisionMesh {
  surface: Surface;
  positions: Float32Array;
  indices: Uint32Array;
}

export async function loadCollision(track: TrackData, onBytes: (n: number) => void): Promise<CollisionMesh[]> {
  const raw = await fetchWithProgress(track.collision.file, onBytes);
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
