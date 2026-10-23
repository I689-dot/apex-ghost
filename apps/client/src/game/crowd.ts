import * as THREE from 'three';
import type { TrackData } from '@apex/shared';

/**
 * Spectators on the grandstands. The source map's stands are low-poly shells with the seat rows painted on one
 * sloped face (wall_ringwerk: the main grandstand; openstand, stairs: the open stands; wall_dorint), so they looked
 * empty. People are placed on those sloped faces where they look towards the track, one per seat-sized cell with
 * gaps (a race-day crowd, not a sell-out), each a small card facing the track, all in one instanced draw call.
 */

/** Materials whose sloped faces are seating (the Nürburgring GP model; other maps have none named so). */
const STAND_MAT_RE = /^(wall_ringwerk|wall_dorint|openstand|stairs)/i;
/** Metres between seats, and the share of seats taken. */
const SEAT_M = 0.95;
const OCCUPANCY = 0.68;
const VARIANTS = 8;

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
}

/** Eight seated figures side by side: skin, hair, shirt in team and fan colours, darker legs. */
function crowdTexture(): THREE.CanvasTexture {
  const W = 32;
  const H = 64;
  const c = document.createElement('canvas');
  c.width = W * VARIANTS;
  c.height = H;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  const shirts = ['#d8262f', '#f2f2f2', '#1d4fa3', '#f2c230', '#222428', '#2e8b4a', '#ff7a1a', '#7a4fb0'];
  const skins = ['#e8c39e', '#c99a6e', '#8d5a3b', '#f1d2b6'];
  const hair = ['#2b1d14', '#5a3a22', '#9a7a4a', '#151515'];
  const r = rng(31);
  for (let k = 0; k < VARIANTS; k++) {
    const x = k * W;
    // legs (seated: short), torso, arms, head
    g.fillStyle = r() < 0.5 ? '#2a2f3a' : '#4a4038';
    g.fillRect(x + 10, 46, 12, 16);
    g.fillStyle = shirts[k];
    g.beginPath();
    g.roundRect(x + 7, 24, 18, 24, 5);
    g.fill();
    g.fillRect(x + 4, 27, 4, 15);
    g.fillRect(x + 24, 27, 4, 15);
    g.fillStyle = skins[k % skins.length];
    g.beginPath();
    g.arc(x + 16, 16, 6.5, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = hair[(k * 3) % hair.length];
    g.beginPath();
    g.arc(x + 16, 13, 6.5, Math.PI, 0);
    g.fill();
    // a cap on some
    if (k % 3 === 0) {
      g.fillStyle = shirts[(k + 2) % shirts.length];
      g.fillRect(x + 9, 8, 14, 4);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

/**
 * The crowd for this map (null when it has no stands): `density` 0…1 thins it (quality preset). Call after the
 * track's meshes are in place (world matrices).
 */
export function buildCrowd(root: THREE.Object3D, track: TrackData, density: number): THREE.InstancedMesh | null {
  if (density <= 0) return null;
  root.updateMatrixWorld(true);
  // the lap line every ~10 m: which way the track is from a seat
  const cl = track.centerline;
  const step = Math.max(1, Math.round(10 / (track.length / (cl.length / 3))));
  const line: [number, number][] = [];
  for (let i = 0; i < cl.length / 3; i += step) line.push([cl[i * 3], cl[i * 3 + 2]]);
  const r = rng(1234567);
  const seats: number[] = []; // x, y, z, yaw
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const cc = new THREE.Vector3();
  const n = new THREE.Vector3();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mat = [mesh.material].flat()[0] as THREE.Material | undefined;
    if (!mat || !STAND_MAT_RE.test(mat.name)) return;
    const pos = mesh.geometry.getAttribute('position');
    const idx = mesh.geometry.getIndex();
    const count = idx ? idx.count : pos.count;
    for (let k = 0; k < count; k += 3) {
      const ia = idx ? idx.getX(k) : k;
      const ib = idx ? idx.getX(k + 1) : k + 1;
      const ic = idx ? idx.getX(k + 2) : k + 2;
      a.fromBufferAttribute(pos, ia).applyMatrix4(mesh.matrixWorld);
      b.fromBufferAttribute(pos, ib).applyMatrix4(mesh.matrixWorld);
      cc.fromBufferAttribute(pos, ic).applyMatrix4(mesh.matrixWorld);
      n.subVectors(b, a).cross(cc.clone().sub(a));
      const area = n.length() / 2;
      if (area < 0.5) continue;
      n.normalize();
      if (n.y < 0) n.negate();
      // seating rises away from the track: a sloped face, up and towards the track
      if (n.y < 0.2 || n.y > 0.92) continue;
      const mx = (a.x + b.x + cc.x) / 3;
      const mz = (a.z + b.z + cc.z) / 3;
      let best = Infinity;
      let tx = 0;
      let tz = 0;
      for (const [px, pz] of line) {
        const d = (px - mx) * (px - mx) + (pz - mz) * (pz - mz);
        if (d < best) {
          best = d;
          tx = px - mx;
          tz = pz - mz;
        }
      }
      const dist = Math.sqrt(best);
      if (dist > 220) continue;
      const hl = Math.hypot(n.x, n.z) || 1;
      if ((n.x * tx + n.z * tz) / (hl * dist || 1) < 0.2) continue;
      const yaw = Math.atan2(tx, tz);
      const people = Math.floor((area * OCCUPANCY * density) / (SEAT_M * SEAT_M) + r());
      for (let p = 0; p < people; p++) {
        let u = r();
        let v = r();
        if (u + v > 1) {
          u = 1 - u;
          v = 1 - v;
        }
        seats.push(
          a.x + (b.x - a.x) * u + (cc.x - a.x) * v,
          a.y + (b.y - a.y) * u + (cc.y - a.y) * v + 0.02,
          a.z + (b.z - a.z) * u + (cc.z - a.z) * v,
          yaw + (r() - 0.5) * 0.5,
        );
      }
    }
  });
  const count = seats.length / 4;
  if (!count) return null;
  const geo = new THREE.PlaneGeometry(0.55, 1.05);
  geo.translate(0, 0.52, 0);
  const variant = new Float32Array(count);
  for (let i = 0; i < count; i++) variant[i] = Math.floor(r() * VARIANTS);
  geo.setAttribute('aVariant', new THREE.InstancedBufferAttribute(variant, 1));
  const mat = new THREE.MeshLambertMaterial({ map: crowdTexture(), alphaTest: 0.5, side: THREE.DoubleSide });
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('void main() {', 'attribute float aVariant;\nvoid main() {')
      .replace('#include <uv_vertex>', `#include <uv_vertex>\nvMapUv.x = (vMapUv.x + aVariant) / ${VARIANTS.toFixed(1)};`);
  };
  mat.customProgramCacheKey = () => 'crowd';
  const crowd = new THREE.InstancedMesh(geo, mat, count);
  crowd.name = 'crowd';
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const col = new THREE.Color();
  for (let i = 0; i < count; i++) {
    const h = 0.9 + r() * 0.25;
    q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, seats[i * 4 + 3]);
    m.compose(new THREE.Vector3(seats[i * 4], seats[i * 4 + 1], seats[i * 4 + 2]), q, s.set(h, h, h));
    crowd.setMatrixAt(i, m);
    crowd.setColorAt(i, col.setScalar(0.8 + r() * 0.3));
  }
  crowd.computeBoundingSphere();
  crowd.frustumCulled = false; // spread over the whole circuit: one draw call, culled per vertex by the GPU
  return crowd;
}
