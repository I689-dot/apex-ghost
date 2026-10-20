import * as THREE from 'three';
import type { CarEntry } from '@apex/shared';
import type { CarModel } from './assets';

const WHEELS = ['FL', 'FR', 'RL', 'RR'] as const;
const LOD_DIST = [0, 18, 80]; // LOD0 is cockpit-grade (100–200k tris): only very close remote cars use it

interface WheelRig {
  hub: THREE.Object3D;
  spin: THREE.Object3D;
  baseY: number;
}

interface LevelRig {
  root: THREE.Object3D;
  wheels: WheelRig[];
  steering: THREE.Object3D | null;
}

const _v = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();

let poolTexture: THREE.Texture | null = null;
function lightPoolTexture(): THREE.Texture {
  if (poolTexture) return poolTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  const grd = g.createRadialGradient(64, 40, 4, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,245,220,0.9)');
  grd.addColorStop(0.5, 'rgba(255,240,210,0.35)');
  grd.addColorStop(1, 'rgba(255,240,210,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  poolTexture = new THREE.CanvasTexture(c);
  poolTexture.colorSpace = THREE.SRGBColorSpace;
  return poolTexture;
}

const GLASS_RE = /glass|window|windscreen|windshield|visor|lexan/i;

/** 1 while the camera is in your own cockpit (set by the session each frame). */
export const cockpitGlass = { value: 0 };

/**
 * Your car's glass from the driver's seat. Sun strips and window lettering are printed on the outside of the
 * glass texture, so from inside the source models showed them mirrored and fully lit (a giant "MARTIN" across
 * the Aston's windscreen). Real ones read as a dark tinted band with faint reversed lettering: while the camera
 * is inside, the glass colour is cut down. Face winding can't tell inside from outside (several models are
 * mirrored), the camera position can: from the seat every pane is seen from inside.
 */
function darkenFromCockpit(m: THREE.MeshStandardMaterial): void {
  m.onBeforeCompile = (sh) => {
    sh.uniforms.cockpitGlass = cockpitGlass;
    sh.fragmentShader = sh.fragmentShader
      .replace('void main() {', 'uniform float cockpitGlass;\nvoid main() {')
      .replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.12 + 0.01, cockpitGlass);');
  };
  m.customProgramCacheKey = () => 'cockpit-glass';
}

/**
 * A visible car: LOD levels cloned from the shared model, rigged wheels/steering,
 * per-instance light materials, dents and ghost fading.
 */
export class CarVisual {
  readonly object = new THREE.Group();
  private levels: LevelRig[] = [];
  private lod: THREE.LOD | null = null;
  private headMats: THREE.MeshStandardMaterial[] = [];
  private tailMats: THREE.MeshStandardMaterial[] = [];
  private fadeMats: THREE.Material[] = [];
  private bodyMeshes: THREE.Mesh[] = [];
  private originalPositions = new Map<THREE.BufferGeometry, Float32Array>();
  private originalNormals = new Map<THREE.BufferGeometry, Float32Array>();
  private steerAxis = new THREE.Vector3(0, 0, 1);
  private steerRatio = 11; // steering-wheel angle : road-wheel angle
  private headlightPool: THREE.Mesh | null = null;
  headlights: THREE.SpotLight[] = [];
  private smoke: THREE.Sprite[] = [];
  private smokeT = 0;
  private opacity = 1;
  readonly staticComp: number[];

  constructor(
    readonly entry: CarEntry,
    model: CarModel,
    readonly local: boolean,
  ) {
    this.object.name = `car_${entry.id}`;
    if (entry.steering) this.steerAxis.set(...entry.steering.axis).normalize();
    const levels = local ? model.lods.slice(0, 1) : model.lods;
    if (levels.length > 1) {
      this.lod = new THREE.LOD();
      this.lod.autoUpdate = true;
      this.object.add(this.lod);
    }
    const matCache = new Map<THREE.Material, THREE.Material>();
    levels.forEach((src, i) => {
      const root = src.clone(true);
      this.prepareMaterials(root, matCache);
      const rig = this.rig(root);
      this.levels.push(rig);
      if (this.lod) this.lod.addLevel(root, LOD_DIST[i] ?? 200, 0.02);
      else this.object.add(root);
      if (i === 0) {
        const body = root.getObjectByName('body');
        body?.traverse((o) => {
          if ((o as THREE.Mesh).isMesh) this.bodyMeshes.push(o as THREE.Mesh);
        });
      }
    });
    this.object.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = true;
        m.receiveShadow = local;
      }
    });
    this.staticComp = [0, 0, 0, 0];
    // remote cars always, and your own car when real spot lights are too expensive, get a projected light pool
    this.makeLightPool();
  }

  private prepareMaterials(root: THREE.Object3D, cache: Map<THREE.Material, THREE.Material>): void {
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const swap = (m: THREE.Material): THREE.Material => {
        let c = cache.get(m);
        if (!c) {
          c = m.clone();
          cache.set(m, c);
          const sm = c as THREE.MeshStandardMaterial;
          if (sm.name.startsWith('LIGHT_HEAD_')) {
            if (!sm.emissiveMap && sm.emissive.getHex() === 0) sm.emissive.setRGB(1, 0.97, 0.9);
            this.headMats.push(sm);
          } else if (sm.name.startsWith('LIGHT_TAIL_')) {
            if (!sm.emissiveMap && sm.emissive.getHex() === 0) sm.emissive.setRGB(1, 0.05, 0.02);
            else sm.emissive.setRGB(1, 0.12, 0.08);
            this.tailMats.push(sm);
          }
          // an untextured opaque "glass" (the BMW M4 Touring's glassin) is really its whole untextured cabin shell,
          // light grey in the source: from the seat it washed the view out white. Give it a dark trim colour.
          if (sm.isMeshStandardMaterial && !sm.transparent && !sm.map && GLASS_RE.test(sm.name)) {
            sm.color.setHex(0x1b1d21);
            sm.roughness = 0.85;
            sm.metalness = 0;
          }
          if (this.local && sm.isMeshStandardMaterial && sm.transparent && GLASS_RE.test(sm.name)) darkenFromCockpit(sm);
          if (!this.local) {
            // stochastic transparency: fades without sorting and without recompiling later
            if (!sm.transparent) sm.alphaHash = true;
            this.fadeMats.push(sm);
          }
        }
        return c;
      };
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material);
    });
  }

  private rig(root: THREE.Object3D): LevelRig {
    const wheels: WheelRig[] = [];
    for (const k of WHEELS) {
      const hub = root.getObjectByName(`wheel_${k}`);
      if (!hub) continue;
      // insert a pivot at the hub so spinning is about the true axle, whatever the mesh node transform is
      const spinPivot = new THREE.Group();
      spinPivot.name = `spin_${k}`;
      const children = hub.children.filter((c) => c.name.endsWith('_spin') || c.name.includes('spin'));
      hub.add(spinPivot);
      for (const c of children) spinPivot.attach(c);
      wheels.push({ hub, spin: spinPivot, baseY: hub.position.y });
    }
    let steering: THREE.Object3D | null = null;
    const sw = root.getObjectByName('steering_wheel');
    if (sw) {
      const pivot = new THREE.Group();
      pivot.name = 'steering_pivot';
      const kids = [...sw.children];
      sw.add(pivot);
      for (const c of kids) pivot.attach(c);
      steering = pivot;
    }
    return { root, wheels, steering };
  }

  private makeLightPool(): void {
    const geo = new THREE.PlaneGeometry(9, 22);
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, 0.06, this.entry.dims.length / 2 + 10);
    const mat = new THREE.MeshBasicMaterial({
      map: lightPoolTexture(),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      opacity: 0,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    this.headlightPool = new THREE.Mesh(geo, mat);
    this.headlightPool.renderOrder = 2;
    this.headlightPool.visible = false;
    this.object.add(this.headlightPool);
  }

  /**
   * Cockpit-only cost cut for weaker GPUs: glass becomes a plain tint (no PBR layer over the
   * whole screen). The interior keeps environment lighting. Must run before shader warm-up.
   */
  simplifyForCockpit(): void {
    const tint = new THREE.MeshBasicMaterial({ color: 0x8090a0, transparent: true, opacity: 0.1, depthWrite: false });
    this.object.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const swap = (m: THREE.Material): THREE.Material => {
        const sm = m as THREE.MeshStandardMaterial;
        if (!sm.isMeshStandardMaterial || sm.name.startsWith('LIGHT_')) return m;
        // only real glass becomes a cheap tint; anything else that blends keeps its material
        if (sm.transparent && GLASS_RE.test(sm.name)) return tint;
        // the cabin is lit mostly by the environment (the roof blocks the sun): keep it, a bit stronger
        sm.userData.envBoost = 1.35;
        return m;
      };
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material);
    });
  }

  /** Real spot lights for the local car (shadows optional). */
  addHeadlights(shadows: boolean): void {
    const z = this.entry.dims.length / 2 - 0.3;
    for (const x of [0.6, -0.6]) {
      const l = new THREE.SpotLight(0xfff3e0, 0, 140, 0.42, 0.55, 1.2);
      l.position.set(x, 0.65, z);
      l.target.position.set(x * 0.6, 0, z + 25);
      l.castShadow = shadows && x > 0;
      if (l.castShadow) {
        l.shadow.mapSize.set(1024, 1024);
        l.shadow.camera.near = 0.5;
        l.shadow.camera.far = 80;
        l.shadow.bias = -0.0005;
      }
      this.object.add(l, l.target);
      this.headlights.push(l);
    }
  }

  /**
   * Update visual state.
   * @param steer road-wheel angle (rad) @param rotF/rotR wheel angles @param susp per-wheel compression delta from static (m)
   */
  setPose(steer: number, rotF: number, rotR: number, susp: ArrayLike<number>): void {
    for (const lvl of this.levels) {
      for (let i = 0; i < lvl.wheels.length; i++) {
        const w = lvl.wheels[i];
        const front = i < 2;
        w.hub.rotation.y = front ? steer : 0;
        w.spin.rotation.x = front ? rotF : rotR;
        w.hub.position.y = w.baseY + (susp[i] ?? 0);
      }
      if (lvl.steering) {
        // the axis points at the driver, so a positive angle turns the rim counter-clockwise (left)
        lvl.steering.quaternion.setFromAxisAngle(this.steerAxis, steer * this.steerRatio);
      }
    }
  }

  setLights(brake: boolean, headlights: boolean, night: number): void {
    const tail = brake ? 5 : headlights || night > 0.3 ? 1.1 : 0.12;
    for (const m of this.tailMats) m.emissiveIntensity = tail;
    const head = headlights ? 4 : 0.35;
    for (const m of this.headMats) m.emissiveIntensity = head;
    for (const l of this.headlights) l.intensity = headlights ? 60 : 0;
    if (this.headlightPool) {
      this.headlightPool.visible = headlights;
      (this.headlightPool.material as THREE.MeshBasicMaterial).opacity = headlights ? 0.55 * Math.min(1, night + 0.3) : 0;
    }
  }

  /** Ghost fade for remote cars near the camera (0 invisible … 1 solid). */
  setOpacity(a: number): void {
    if (Math.abs(a - this.opacity) < 0.01) return;
    this.opacity = a;
    for (const m of this.fadeMats) m.opacity = a * ((m as THREE.MeshStandardMaterial).transparent ? 0.5 : 1);
    this.object.visible = a > 0.04;
  }

  /**
   * Dent the body around a car-local impact point. Geometry is cloned per instance on first use.
   */
  dent(localPoint: THREE.Vector3, direction: THREE.Vector3, amount: number): void {
    const radius = 0.45 + amount * 0.6;
    const depth = Math.min(0.09, amount * 0.12);
    for (const mesh of this.bodyMeshes) {
      if (!this.originalPositions.has(mesh.geometry)) {
        mesh.geometry = mesh.geometry.clone();
        const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
        // meshopt-quantized attributes are normalized ints: store a float copy we can modify
        if (pos.normalized || !(pos.array instanceof Float32Array)) {
          const f = new Float32Array(pos.count * 3);
          for (let i = 0; i < pos.count; i++) {
            f[i * 3] = pos.getX(i);
            f[i * 3 + 1] = pos.getY(i);
            f[i * 3 + 2] = pos.getZ(i);
          }
          mesh.geometry.setAttribute('position', new THREE.BufferAttribute(f, 3));
        }
        this.originalPositions.set(mesh.geometry, Float32Array.from((mesh.geometry.getAttribute('position') as THREE.BufferAttribute).array as Float32Array));
        // the authored normals too: recomputing them loses hard edges and seams (the interior went dark), and a
        // repair must give the original shading back exactly
        const nrm = mesh.geometry.getAttribute('normal') as THREE.BufferAttribute | undefined;
        if (nrm) {
          const fn = new Float32Array(nrm.count * 3);
          for (let i = 0; i < nrm.count; i++) {
            fn[i * 3] = nrm.getX(i);
            fn[i * 3 + 1] = nrm.getY(i);
            fn[i * 3 + 2] = nrm.getZ(i);
          }
          mesh.geometry.setAttribute('normal', new THREE.BufferAttribute(fn, 3));
          this.originalNormals.set(mesh.geometry, Float32Array.from(fn));
        }
      }
      const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
      const arr = pos.array as Float32Array;
      // impact point into the mesh's local space
      _m.copy(mesh.matrixWorld).invert().multiply(this.object.matrixWorld);
      _v.copy(localPoint).applyMatrix4(_m);
      _q.setFromRotationMatrix(_m);
      const dir = direction.clone().applyQuaternion(_q).normalize();
      const r2 = radius * radius;
      let touched = false;
      for (let i = 0; i < pos.count; i++) {
        const dx = arr[i * 3] - _v.x;
        const dy = arr[i * 3 + 1] - _v.y;
        const dz = arr[i * 3 + 2] - _v.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > r2) continue;
        const f = 1 - Math.sqrt(d2) / radius;
        const k = depth * f * f;
        arr[i * 3] += dir.x * k;
        arr[i * 3 + 1] += dir.y * k * 0.5;
        arr[i * 3 + 2] += dir.z * k;
        touched = true;
      }
      if (touched) {
        pos.needsUpdate = true;
        mesh.geometry.computeVertexNormals();
      }
    }
  }

  resetDamage(): void {
    for (const mesh of this.bodyMeshes) {
      const orig = this.originalPositions.get(mesh.geometry);
      if (!orig) continue;
      const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
      (pos.array as Float32Array).set(orig);
      pos.needsUpdate = true;
      const on = this.originalNormals.get(mesh.geometry);
      const nrm = mesh.geometry.getAttribute('normal') as THREE.BufferAttribute | undefined;
      if (on && nrm) {
        (nrm.array as Float32Array).set(on);
        nrm.needsUpdate = true;
      } else mesh.geometry.computeVertexNormals();
    }
  }

  /** Engine smoke at high damage. */
  updateSmoke(dt: number, engineDamage: number, scene: THREE.Scene): void {
    if (engineDamage < 0.55) {
      for (const s of this.smoke) s.visible = false;
      return;
    }
    if (this.smoke.length === 0) {
      const tex = smokeTexture();
      for (let i = 0; i < 24; i++) {
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0, color: 0x555555 }));
        s.visible = false;
        s.userData.age = 99;
        scene.add(s);
        this.smoke.push(s);
      }
    }
    this.smokeT -= dt;
    if (this.smokeT <= 0) {
      this.smokeT = 0.12 / engineDamage;
      const s = this.smoke.find((p) => p.userData.age > 2.2);
      if (s) {
        s.userData.age = 0;
        s.position.set(0, 0.9, this.entry.dims.length * 0.32).applyMatrix4(this.object.matrixWorld);
        s.visible = true;
      }
    }
    for (const s of this.smoke) {
      if (!s.visible) continue;
      s.userData.age += dt;
      const a = s.userData.age as number;
      s.position.y += dt * 1.2;
      s.scale.setScalar(0.6 + a * 1.6);
      (s.material as THREE.SpriteMaterial).opacity = Math.max(0, 0.45 * (1 - a / 2.2) * engineDamage);
      if (a > 2.2) s.visible = false;
    }
  }

  get currentLevel(): number {
    return this.lod ? this.lod.getCurrentLevel() : 0;
  }

  dispose(scene: THREE.Scene): void {
    for (const s of this.smoke) scene.remove(s);
    this.object.removeFromParent();
  }
}

let smokeTex: THREE.Texture | null = null;
function smokeTexture(): THREE.Texture {
  if (smokeTex) return smokeTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  const grd = g.createRadialGradient(32, 32, 2, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,0.8)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  smokeTex = new THREE.CanvasTexture(c);
  return smokeTex;
}
