import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { parseGltf } from './assets';
import { VEG_BASE } from './vegetation';
import type { CarEntry } from '@apex/shared';
import { SERVICE, serviceTime, type ServicePlan, type Zones } from './pitService';

/**
 * Pit crews and the pit stop as it happens, not a timer: each entrant's crew waits in front of its garage; when its
 * car stops in the box, one timeline (stopTimeline, built from the same durations as serviceTime) drives everything:
 * the refuel rig first (SRO: no other work while fuel flows), the air jacks, then a wheel man per corner, two
 * wheels a side (front, then rear), each wheel's nut off with the gun, the wheel off, the new one on and the nut
 * tightened, then the jacks down. The session plays the wheel-gun and jack sounds at those moments and fits each
 * new tyre when it goes on, so the sound, the crew and the tyres change together (they all changed at the end).
 *
 * Near the camera the crew are the rigged mechanic of assets/vegetation/mechanic_rig.glb (the user's model, posed by
 * code: its bones follow the same joints as the simple figures, RIG_MAP); further away, and until the model has
 * loaded, simple figures (fire suits in the car's colour, helmets) built from a handful of shapes, drawn as instanced
 * meshes. Each garage also gets a tool trolley and two engineers in white overalls standing inside it.
 */

/** Crews within this many metres of the camera are drawn with the rigged model. */
const RIG_RANGE = 60;

/**
 * The rigged mechanic's bones (a Ready Player Me skeleton, renamed n6…n86 by the export) and the joint of the simple
 * figure each follows; `limb`: the bone's child, whose direction is straightened (the model stands in an A-pose,
 * arms 30° out: the figure's joints at rest hang the limbs straight down). Bones not listed (fingers, toes, eyes)
 * keep their rest pose relative to their parent.
 */
const RIG_MAP: [string, keyof JointSet, string | null][] = [
  ['n6', 'hips', null],
  ['n7', 'chest', null],
  ['n10', 'neck', null],
  ['n18', 'chest', null],
  ['n19', 'shoulderL', 'n20'],
  ['n20', 'elbowL', 'n21'],
  ['n21', 'elbowL', null],
  ['n47', 'chest', null],
  ['n48', 'shoulderR', 'n49'],
  ['n49', 'elbowR', 'n50'],
  ['n50', 'elbowR', null],
  ['n76', 'hipL', 'n77'],
  ['n77', 'kneeL', 'n78'],
  ['n78', 'kneeL', null],
  ['n82', 'hipR', 'n83'],
  ['n83', 'kneeR', 'n84'],
  ['n84', 'kneeR', null],
];

type JointSet = Pick<Figure, 'hips' | 'chest' | 'neck' | 'shoulderL' | 'shoulderR' | 'elbowL' | 'elbowR' | 'hipL' | 'hipR' | 'kneeL' | 'kneeR'>;

/** The user's models for the pit lane (null until loaded, or when missing). */
export interface CrewModels {
  rig: GLTF;
  engineer: GLTF | null;
  cart: GLTF | null;
}

let crewModels: Promise<CrewModels | null> | null = null;
export function loadCrewModels(): Promise<CrewModels | null> {
  const get = async (f: string) => {
    const res = await fetch(`${VEG_BASE}${f}`);
    if (!res.ok) throw new Error(`${f}: ${res.status}`);
    return parseGltf(await res.arrayBuffer());
  };
  crewModels ??= (async () => {
    try {
      const [rig, engineer, cart] = await Promise.all([
        get('mechanic_rig.glb'),
        get('mechanic_static.glb').catch(() => null),
        get('tool_cart.glb').catch(() => null),
      ]);
      return { rig, engineer, cart };
    } catch (e) {
      console.warn('[crew] models not loaded, simple figures only', e);
      return null;
    }
  })();
  return crewModels;
}

/** One rigged mechanic: its object, its mapped bones with their rest pose (relative to the model's root). */
interface Rigged {
  object: THREE.Object3D;
  bones: { bone: THREE.Bone; joint: keyof JointSet; restWorld: THREE.Quaternion; fix: THREE.Quaternion; parent: number }[];
  hips: THREE.Bone;
  hipsRest: THREE.Vector3;
  /** The hips bone's parent (the armature node) relative to the model's root. */
  baseQ: THREE.Quaternion;
  /** World up (m) in the hips bone's parent space (its local units). */
  hipsUp: THREE.Vector3;
}

export type StopKind = 'jackUp' | 'jackDown' | 'gunOff' | 'gunOn' | 'wheelOff' | 'wheelOn' | 'fuelOn' | 'fuelOff';

export interface StopEvent {
  /** Seconds after the service started. */
  at: number;
  kind: StopKind;
  /** FL, FR, RL, RR. */
  wheel: number;
}

/** A wheel's change, as fractions of its share of the tyre time: gun off, wheel off, new wheel on, gun on. */
const WHEEL = { gunOff: 0.02, wheelOff: 0.14, wheelOn: 0.55, gunOn: 0.8 };
/** How long the gun runs (s), how far a wheel comes off the hub (m) and how high the jacks lift (m). */
export const GUN_S = 0.7;
const WHEEL_OUT_M = 0.62;
const JACK_M = 0.07;

/**
 * The events of a stop, in order. Its total matches serviceTime: refuelling (and the driver change) first, then
 * the jacks, the work (tyres alongside the repairs), the jacks down.
 */
export function stopTimeline(plan: ServicePlan, zones: Zones): StopEvent[] {
  const ev: StopEvent[] = [];
  const total = serviceTime(plan, zones).total;
  const fuel = plan.fuelL > 0 ? plan.fuelL / SERVICE.refuelLps : 0;
  const first = Math.max(fuel, plan.driverChange ? SERVICE.driverChange : 0);
  if (fuel > 0) ev.push({ at: 0.4, kind: 'fuelOn', wheel: 1 }, { at: Math.max(0.6, fuel - 0.3), kind: 'fuelOff', wheel: 1 });
  if (total - first <= 0.01) return ev;
  const jack = SERVICE.jacks / 2;
  ev.push({ at: first + 0.15, kind: 'jackUp', wheel: 0 });
  if (plan.tyres) {
    // two wheel men a side: the front wheel, then the rear
    const per = SERVICE.tyres / 2;
    for (const [w, k] of [
      [0, 0],
      [1, 0],
      [2, 1],
      [3, 1],
    ] as const) {
      const t0 = first + jack + k * per;
      for (const kind of ['gunOff', 'wheelOff', 'wheelOn', 'gunOn'] as const) ev.push({ at: t0 + WHEEL[kind] * per, kind, wheel: w });
    }
  }
  ev.push({ at: total - jack * 0.8, kind: 'jackDown', wheel: 0 });
  return ev.sort((a, b) => a.at - b.at);
}

/** The state of the car at time u of a stop: how far each wheel is off its hub (m) and the jack lift (m). */
export function stopPose(ev: StopEvent[], u: number, out: { wheelOut: Float32Array; lift: number }): void {
  out.lift = 0;
  out.wheelOut.fill(0);
  let up: number | null = null;
  let down: number | null = null;
  const off = [-1, -1, -1, -1];
  const on = [-1, -1, -1, -1];
  for (const e of ev) {
    if (e.kind === 'jackUp') up = e.at;
    else if (e.kind === 'jackDown') down = e.at;
    else if (e.kind === 'wheelOff') off[e.wheel] = e.at;
    else if (e.kind === 'wheelOn') on[e.wheel] = e.at;
  }
  if (up !== null && u >= up) out.lift = JACK_M * Math.min(1, (u - up) / 0.35) * (down !== null && u >= down ? Math.max(0, 1 - (u - down) / 0.35) : 1);
  for (let i = 0; i < 4; i++) {
    if (off[i] < 0) continue;
    // off: slides out over 0.6 s and stays with the wheel man; the new one slides on over 0.6 s
    if (u >= off[i] && u < on[i]) out.wheelOut[i] = WHEEL_OUT_M * Math.min(1, (u - off[i]) / 0.6);
    else if (u >= on[i]) out.wheelOut[i] = WHEEL_OUT_M * Math.max(0, 1 - (u - on[i]) / 0.6);
  }
}

/* --------------------------------------------------------------- figures --- */

/** Body parts, each an instanced mesh: one instance per crew member. */
const PARTS = ['torso', 'head', 'visor', 'upperL', 'upperR', 'lowerL', 'lowerR', 'thighL', 'thighR', 'shinL', 'shinR', 'gun'] as const;
type Part = (typeof PARTS)[number];

function partGeometry(p: Part): THREE.BufferGeometry {
  // each hangs down from its joint (the origin), so rotating the joint swings it
  const cap = (r: number, len: number) => {
    const g = new THREE.CapsuleGeometry(r, len, 3, 8);
    g.translate(0, -len / 2 - r * 0.5, 0);
    return g;
  };
  switch (p) {
    case 'torso': {
      // a baggy fire suit: hips, a chest widening to the shoulders, the shoulders themselves
      const hips = new THREE.SphereGeometry(0.17, 12, 8);
      hips.scale(1.05, 0.7, 0.78);
      hips.translate(0, 0.02, 0);
      const chest = new THREE.CylinderGeometry(0.2, 0.165, 0.5, 12, 1);
      chest.scale(1, 1, 0.66);
      chest.translate(0, 0.3, 0);
      const sh = new THREE.CapsuleGeometry(0.08, 0.3, 3, 8);
      sh.rotateZ(Math.PI / 2);
      sh.translate(0, 0.52, 0);
      const neck = new THREE.CylinderGeometry(0.06, 0.07, 0.1, 8);
      neck.translate(0, 0.6, 0);
      return merge(hips, chest, sh, neck);
    }
    case 'head': {
      // an open-face helmet (pit crews wear them), a little bigger than a head
      const g = new THREE.SphereGeometry(0.128, 16, 12);
      g.scale(1, 1.06, 1.1);
      g.translate(0, 0.13, -0.005);
      return g;
    }
    case 'visor': {
      const g = new THREE.SphereGeometry(0.131, 16, 8, -0.95, 1.9, 1.15, 0.65);
      g.scale(1, 1.06, 1.1);
      g.rotateY(Math.PI / 2);
      g.translate(0, 0.13, 0);
      return g;
    }
    case 'upperL':
    case 'upperR':
      return cap(0.068, 0.24);
    case 'lowerL':
    case 'lowerR': {
      // forearm and a glove
      const glove = new THREE.SphereGeometry(0.058, 10, 8);
      glove.scale(0.9, 1.2, 0.75);
      glove.translate(0, -0.33, 0);
      return merge(cap(0.058, 0.22), glove);
    }
    case 'thighL':
    case 'thighR':
      return cap(0.09, 0.32);
    case 'shinL':
    case 'shinR': {
      // shin and a race boot pointing forward
      const boot = new THREE.BoxGeometry(0.11, 0.08, 0.27);
      boot.translate(0, -0.44, 0.06);
      return merge(cap(0.072, 0.34), boot);
    }
    case 'gun': {
      // a wheel gun: the body, its handle and the socket pointing forward
      const body = new THREE.CylinderGeometry(0.05, 0.05, 0.2, 12);
      body.rotateX(Math.PI / 2);
      body.translate(0, -0.02, 0.07);
      const grip = new THREE.BoxGeometry(0.04, 0.12, 0.05);
      grip.translate(0, -0.1, 0.02);
      const sock = new THREE.CylinderGeometry(0.03, 0.03, 0.12, 10);
      sock.rotateX(Math.PI / 2);
      sock.translate(0, -0.02, 0.22);
      return merge(body, grip, sock);
    }
  }
}

/** One geometry from several (position, normal, uv only). */
function merge(...gs: THREE.BufferGeometry[]): THREE.BufferGeometry {
  return mergeGeometries(gs.map((g) => (g.index ? g.toNonIndexed() : g))) as THREE.BufferGeometry;
}

/** A figure's joints: posed every frame, their world matrices copied into the instanced parts. */
class Figure {
  readonly root = new THREE.Object3D();
  readonly hips = new THREE.Object3D();
  readonly chest = new THREE.Object3D();
  readonly neck = new THREE.Object3D();
  readonly shoulderL = new THREE.Object3D();
  readonly shoulderR = new THREE.Object3D();
  readonly elbowL = new THREE.Object3D();
  readonly elbowR = new THREE.Object3D();
  readonly hipL = new THREE.Object3D();
  readonly hipR = new THREE.Object3D();
  readonly kneeL = new THREE.Object3D();
  readonly kneeR = new THREE.Object3D();
  readonly hand = new THREE.Object3D();
  /** The joint each part hangs from. */
  readonly joints: Record<Part, THREE.Object3D>;

  constructor() {
    this.root.add(this.hips);
    this.hips.position.y = 0.92;
    this.hips.add(this.chest, this.hipL, this.hipR);
    this.chest.add(this.neck, this.shoulderL, this.shoulderR);
    this.neck.position.y = 0.6;
    this.shoulderL.position.set(0.21, 0.52, 0);
    this.shoulderR.position.set(-0.21, 0.52, 0);
    this.shoulderL.add(this.elbowL);
    this.shoulderR.add(this.elbowR);
    this.elbowL.position.y = -0.31;
    this.elbowR.position.y = -0.31;
    this.elbowR.add(this.hand);
    this.hand.position.y = -0.29;
    this.hipL.position.set(0.1, 0, 0);
    this.hipR.position.set(-0.1, 0, 0);
    this.hipL.add(this.kneeL);
    this.hipR.add(this.kneeR);
    this.kneeL.position.y = -0.44;
    this.kneeR.position.y = -0.44;
    this.joints = {
      torso: this.chest,
      head: this.neck,
      visor: this.neck,
      upperL: this.shoulderL,
      upperR: this.shoulderR,
      lowerL: this.elbowL,
      lowerR: this.elbowR,
      thighL: this.hipL,
      thighR: this.hipR,
      shinL: this.kneeL,
      shinR: this.kneeR,
      gun: this.hand,
    };
  }

  /**
   * Pose: standing (idle sway), kneeling at a wheel (gun at the nut, `work` 0..1 how hard), or walking.
   * Angles in rad; the figure faces +z.
   */
  pose(kind: 'stand' | 'kneel' | 'walk', t: number, work = 0): void {
    const s = Math.sin;
    const rx = (o: THREE.Object3D, a: number, z = 0) => o.rotation.set(a, 0, z);
    if (kind === 'kneel') {
      // right knee down, left foot planted, leaning in towards the wheel, gun held to it in both hands
      this.hips.position.y = 0.5;
      rx(this.hips, 0);
      rx(this.chest, 0.42 + 0.04 * s(t * 30) * work);
      rx(this.hipL, -1.45);
      rx(this.kneeL, 1.45);
      rx(this.hipR, 0.15);
      rx(this.kneeR, 1.42);
      const buzz = 0.03 * s(t * 47) * work;
      rx(this.shoulderL, -1.05 + buzz, -0.25);
      rx(this.elbowL, -0.75);
      rx(this.shoulderR, -1.15 + buzz, 0.2);
      rx(this.elbowR, -0.55);
      this.hand.rotation.set(-1.2, 0, 0);
      this.neck.rotation.set(-0.25, 0, 0);
    } else if (kind === 'walk') {
      const ph = t * 7.5;
      this.hips.position.y = 0.92 + 0.025 * Math.abs(s(ph));
      rx(this.hips, 0);
      rx(this.chest, 0.08);
      rx(this.hipL, 0.5 * s(ph));
      rx(this.kneeL, Math.max(0, 0.7 * s(ph + 1.2)));
      rx(this.hipR, -0.5 * s(ph));
      rx(this.kneeR, Math.max(0, -0.7 * s(ph + 1.2)));
      rx(this.shoulderL, -0.4 * s(ph), 0.08);
      rx(this.elbowL, -0.3);
      rx(this.shoulderR, 0.4 * s(ph), -0.08);
      rx(this.elbowR, -0.3);
      this.hand.rotation.set(-1.4, 0, 0);
      this.neck.rotation.set(0, 0, 0);
    } else {
      // waiting: weight shifting, a look around now and then
      this.hips.position.y = 0.92;
      this.hips.rotation.set(0, 0, 0.02 * s(t * 0.7));
      rx(this.chest, 0.03);
      rx(this.hipL, 0.02);
      rx(this.kneeL, 0.04);
      rx(this.hipR, -0.02);
      rx(this.kneeR, 0.02);
      rx(this.shoulderL, 0.05, 0.1);
      rx(this.elbowL, -0.2);
      rx(this.shoulderR, -0.35, -0.1);
      rx(this.elbowR, -0.9);
      this.hand.rotation.set(-0.6, 0, 0);
      this.neck.rotation.set(0, 0.5 * s(t * 0.23), 0);
    }
  }
}

/** The jobs of a crew: four wheel men (FL, FR, RL, RR), the refueller, the chief (jack and lollipop). */
const ROLES = 4 + 2;

interface Crew {
  /** Where they wait (in front of the garage) and the box's frame: centre, along the lane, towards the garage. */
  home: THREE.Vector3;
  centre: THREE.Vector3;
  along: THREE.Vector3;
  away: THREE.Vector3;
  colour: THREE.Color;
  figures: Figure[];
  /** Where each one is now (world x, z) and faces (yaw), for walking between places. */
  at: { x: number; z: number; yaw: number }[];
  /** The rigged mechanics (made the first time the crew is near), and the garage's props. */
  rigged: Rigged[] | null;
  props: THREE.Object3D | null;
}

/** What a crew is doing this frame. */
export interface CrewWork {
  /** The car in the box (world pose, its geometry) and the stop's time (s) and events; null: waiting. */
  car: { pos: THREE.Vector3; quat: THREE.Quaternion; entry: CarEntry } | null;
  u: number;
  events: StopEvent[] | null;
}

const _m = new THREE.Matrix4();
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _c = new THREE.Color();

export class PitCrews {
  readonly object = new THREE.Group();
  private meshes = new Map<Part, THREE.InstancedMesh>();
  private crews: Crew[] = [];
  private time = 0;

  /**
   * @param boxes per crew: the box centre on the ground, the lane direction there and the direction towards the
   *   garage (unit, horizontal), and the team colour.
   */
  constructor(boxes: { centre: THREE.Vector3; along: THREE.Vector3; away: THREE.Vector3; colour: string }[]) {
    this.object.name = 'pit-crews';
    const n = boxes.length * ROLES;
    const suit = new THREE.MeshStandardMaterial({ roughness: 0.78, metalness: 0 });
    const helmet = new THREE.MeshStandardMaterial({ roughness: 0.25, metalness: 0.1 });
    const gun = new THREE.MeshStandardMaterial({ color: 0x1c1d20, roughness: 0.45, metalness: 0.6 });
    for (const p of PARTS) {
      const mat = p === 'head' ? helmet : p === 'gun' || p === 'visor' ? gun : suit;
      const m = new THREE.InstancedMesh(partGeometry(p), mat, n);
      m.count = 0;
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      if (p !== 'gun' && p !== 'visor') m.setColorAt(0, _c.set(0xffffff));
      this.meshes.set(p, m);
      this.object.add(m);
    }
    for (const b of boxes) {
      const home = b.centre.clone().addScaledVector(b.away, 4.6);
      const figures = Array.from({ length: ROLES }, () => new Figure());
      const at = figures.map((_, i) => {
        const side = (i - (ROLES - 1) / 2) * 0.9;
        return { x: home.x + b.along.x * side, z: home.z + b.along.z * side, yaw: Math.atan2(-b.away.x, -b.away.z) };
      });
      // the team's colour, but never darker than a dark suit still reads as coloured (a near-black livery's crew
      // looked like shadows)
      const colour = new THREE.Color(b.colour);
      const hsl = { h: 0, s: 0, l: 0 };
      colour.getHSL(hsl);
      colour.setHSL(hsl.h, hsl.s, Math.max(0.28, hsl.l));
      this.crews.push({ home, centre: b.centre.clone(), along: b.along.clone(), away: b.away.clone(), colour, figures, at, rigged: null, props: null });
    }
  }

  private models: CrewModels | null = null;

  /** The user's models, once loaded: rigged crews near the camera, trolleys and engineers at the garages. */
  setModels(m: CrewModels | null): void {
    this.models = m;
  }

  /** A rigged mechanic for a crew, its overalls in the team's colour. */
  private makeRigged(colour: THREE.Color, mats: Map<THREE.Material, THREE.Material>): Rigged {
    const object = cloneSkinned((this.models as CrewModels).rig.scene);
    object.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (!m.isMesh) return;
      m.castShadow = true;
      m.frustumCulled = false;
      const src = m.material as THREE.MeshStandardMaterial;
      // the overalls take the team's colour (a tint over their texture); skin, face and shoes stay
      if (/Outfit_(Top|Bottom)|Headwear/i.test(src.name)) {
        let c = mats.get(src);
        if (!c) {
          c = src.clone();
          (c as THREE.MeshStandardMaterial).color.copy(colour).lerp(_c.set(0xffffff), 0.35);
          mats.set(src, c);
        }
        m.material = c;
      }
    });
    object.updateMatrixWorld(true);
    const byName = new Map<string, THREE.Bone>();
    object.traverse((o) => (o as THREE.Bone).isBone && byName.set(o.name, o as THREE.Bone));
    const bones: Rigged['bones'] = [];
    for (const [name, joint, limb] of RIG_MAP) {
      const bone = byName.get(name);
      if (!bone) continue;
      const restWorld = bone.getWorldQuaternion(new THREE.Quaternion());
      const fix = new THREE.Quaternion();
      const child = limb ? byName.get(limb) : null;
      if (child) {
        const a = bone.getWorldPosition(new THREE.Vector3());
        const d = child.getWorldPosition(new THREE.Vector3()).sub(a).normalize();
        fix.setFromUnitVectors(d, _v.set(0, -1, 0));
      } else {
        // a hand or foot keeps its angle to the straightened forearm / shin
        const prev = bones.find((b) => b.joint === joint && byName.get(RIG_MAP.find(([n]) => n === b.bone.name)?.[2] ?? '') === bone);
        if (prev) fix.copy(prev.fix);
      }
      let parent = -1;
      for (let p = bone.parent; p && parent < 0; p = p.parent) parent = bones.findIndex((b) => b.bone === p);
      bones.push({ bone, joint, restWorld, fix, parent });
    }
    const hips = byName.get('n6') as THREE.Bone;
    const inv = new THREE.Matrix4().copy((hips.parent as THREE.Object3D).matrixWorld).invert();
    const hipsUp = new THREE.Vector3(0, 1, 0).transformDirection(inv).multiplyScalar(1 / (hips.parent as THREE.Object3D).getWorldScale(_v).y);
    // the wheel gun in the right hand, at its real size whatever the bone's scale
    const hand = byName.get('n50');
    if (hand) {
      const gun = new THREE.Mesh((this.meshes.get('gun') as THREE.InstancedMesh).geometry, (this.meshes.get('gun') as THREE.InstancedMesh).material);
      gun.name = 'gun';
      gun.scale.setScalar(1 / hand.getWorldScale(_v).x);
      gun.position.set(0, 0.08 * gun.scale.x, 0.03 * gun.scale.x);
      gun.rotation.set(Math.PI / 2, 0, 0);
      hand.add(gun);
    }
    const baseQ = (hips.parent as THREE.Object3D).getWorldQuaternion(new THREE.Quaternion());
    return { object, bones, hips, hipsRest: hips.position.clone(), hipsUp, baseQ };
  }

  /** Pose a rigged mechanic like the simple figure `f` (its joints' rotations, its hips' height). */
  private poseRigged(r: Rigged, f: Figure, gun: boolean): void {
    r.object.position.copy(f.root.position);
    r.object.quaternion.copy(f.root.quaternion);
    _qi.copy(f.root.quaternion).invert();
    for (let i = 0; i < r.bones.length; i++) {
      const b = r.bones[i];
      // the joint's rotation relative to the figure, the limb straightened, then the bone's own rest orientation
      f[b.joint].getWorldQuaternion(_qa);
      _qa.premultiply(_qi);
      W[i].copy(_qa).multiply(b.fix).multiply(b.restWorld);
      _qb.copy(b.parent >= 0 ? W[b.parent] : r.baseQ).invert();
      // bones between two mapped ones (spine 1 and 2) keep their rest pose: the parent's world includes them
      if (b.parent >= 0 && b.bone.parent !== r.bones[b.parent].bone) {
        _qp.identity();
        for (let p = b.bone.parent; p && p !== r.bones[b.parent].bone; p = p.parent) _qp.premultiply(p.quaternion);
        _qb.premultiply(_qt.copy(_qp).invert());
      }
      b.bone.quaternion.copy(_qb).multiply(W[i]);
    }
    r.hips.position.copy(r.hipsRest).addScaledVector(r.hipsUp, f.hips.position.y - 0.92);
    const g = r.object.getObjectByName('gun');
    if (g) g.visible = gun;
    r.object.updateMatrixWorld(true);
  }

  /** The garage's trolley and two engineers inside, once (clones of the user's models). */
  private makeProps(c: Crew): THREE.Object3D | null {
    const m = this.models;
    if (!m || (!m.cart && !m.engineer)) return null;
    const g = new THREE.Group();
    g.name = 'pit-props';
    const yaw = Math.atan2(-c.away.x, -c.away.z);
    const place = (src: THREE.Object3D, along: number, away: number, turn: number) => {
      const o = src.clone();
      o.position.copy(c.home).addScaledVector(c.along, along).addScaledVector(c.away, away);
      o.rotation.set(0, yaw + turn, 0);
      o.traverse((x) => ((x as THREE.Mesh).isMesh ? ((x.castShadow = true), (x.receiveShadow = true)) : null));
      g.add(o);
    };
    if (m.cart) place(m.cart.scene, 3.4, 0.2, 0.3);
    if (m.engineer) {
      place(m.engineer.scene, -1.8, 2.6, 0.15);
      place(m.engineer.scene, 2.2, 3.4, -0.4);
    }
    return g;
  }

  /** Pose and draw the crews within `range` m of the camera. `work[i]`: what crew i is doing. */
  update(dt: number, cam: THREE.Vector3, work: (CrewWork | null)[], range = 140): void {
    this.time += dt;
    let k = 0;
    this.crews.forEach((c, ci) => {
      const d2 = c.centre.distanceToSquared(cam);
      // the garage's props, once the models are in
      if (this.models && !c.props && (c.props = this.makeProps(c))) this.object.add(c.props);
      if (c.props) c.props.visible = d2 < 160 * 160;
      const rig = !!this.models && d2 < RIG_RANGE * RIG_RANGE;
      if (rig && !c.rigged) {
        const mats = new Map<THREE.Material, THREE.Material>();
        c.rigged = c.figures.map(() => this.makeRigged(c.colour, mats));
        for (const r of c.rigged) this.object.add(r.object);
      }
      if (c.rigged) for (const r of c.rigged) r.object.visible = rig;
      if (d2 > range * range) return;
      const w = work[ci] ?? null;
      for (let r = 0; r < ROLES; r++) {
        const f = c.figures[r];
        const goal = this.station(c, r, w);
        const at = c.at[r];
        const dx = goal.x - at.x;
        const dz = goal.z - at.z;
        const d = Math.hypot(dx, dz);
        // walk to the station (a quick 3.2 m/s jog when the car is in), then face the job
        const speed = w?.car ? 3.2 : 1.4;
        let kind: 'stand' | 'kneel' | 'walk' = 'stand';
        if (d > 0.08) {
          const step = Math.min(d, speed * dt);
          at.x += (dx / d) * step;
          at.z += (dz / d) * step;
          at.yaw = turn(at.yaw, Math.atan2(dx, dz), dt * 10);
          kind = 'walk';
        } else {
          at.yaw = turn(at.yaw, goal.yaw, dt * 8);
          kind = goal.kneel ? 'kneel' : 'stand';
        }
        f.root.position.set(at.x, goal.y, at.z);
        f.root.rotation.set(0, at.yaw, 0);
        f.pose(kind, this.time + r * 1.7 + ci, goal.work);
        f.hand.visible = r < 4;
        f.root.updateMatrixWorld(true);
        if (rig && c.rigged) {
          this.poseRigged(c.rigged[r], f, r < 4);
          continue;
        }
        // the suit in the team's colour, helmets white with the colour's tint
        for (const p of PARTS) {
          const m = this.meshes.get(p) as THREE.InstancedMesh;
          if (p === 'gun' && !f.hand.visible) _m.makeScale(0, 0, 0);
          else _m.copy(f.joints[p].matrixWorld);
          m.setMatrixAt(k, _m);
          if (p !== 'gun' && p !== 'visor')
            m.setColorAt(k, p === 'head' ? _c.set(0xf4f4f4).lerp(c.colour, 0.25) : _c.copy(c.colour).multiplyScalar(r === 5 ? 0.55 : 1));
        }
        k++;
      }
    });
    for (const m of this.meshes.values()) {
      m.count = k;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }

  /** Where crew member `r` should be and how: in line at the garage, or at the car (by the stop's timeline). */
  private station(c: Crew, r: number, w: CrewWork | null): { x: number; y: number; z: number; yaw: number; kneel: boolean; work: number } {
    const homeAt = (r - (ROLES - 1) / 2) * 0.9;
    const facingLane = Math.atan2(-c.away.x, -c.away.z);
    if (!w?.car) return { x: c.home.x + c.along.x * homeAt, y: c.home.y, z: c.home.z + c.along.z * homeAt, yaw: facingLane, kneel: false, work: 0 };
    const car = w.car;
    const e = car.entry;
    // the car's own frame: wheel men kneel just outside their wheel, facing it
    const toWorld = (x: number, z: number) => _w.set(x, 0, z).applyQuaternion(car.quat).add(car.pos);
    const ev = w.events ?? [];
    if (r < 4) {
      const key = (['FL', 'FR', 'RL', 'RR'] as const)[r];
      const wh = e.wheels[key];
      const side = wh.position[0] > 0 ? 1 : -1;
      // the wheel man waits by his wheel until it is his turn, then works at it (and holds it while it is off)
      let working = 0;
      for (const x of ev) if (x.wheel === r && (x.kind === 'gunOff' || x.kind === 'gunOn') && w.u >= x.at && w.u < x.at + GUN_S) working = 1;
      const p = toWorld(wh.position[0] + side * 0.85, wh.position[2]);
      const yaw = Math.atan2(_v.set(-side, 0, 0).applyQuaternion(car.quat).x, _v.z);
      return { x: p.x, y: car.pos.y, z: p.z, yaw, kneel: true, work: working };
    }
    if (r === 4) {
      // the refueller at the filler (right-hand side, behind the cabin) while the fuel flows, then clear of the car
      const fuelling = ev.some((x) => x.kind === 'fuelOn' && w.u >= x.at) && !ev.some((x) => x.kind === 'fuelOff' && w.u >= x.at + 0.6);
      const p = toWorld(fuelling ? -e.dims.width / 2 - 0.55 : -e.dims.width / 2 - 2.2, (e.wheels.FL.position[2] + e.wheels.RL.position[2]) / 2 - 0.4);
      const yaw = Math.atan2(_v.set(1, 0, 0).applyQuaternion(car.quat).x, _v.z);
      return { x: p.x, y: car.pos.y, z: p.z, yaw, kneel: false, work: 0 };
    }
    // the chief in front of the car, facing the driver
    const p = toWorld(0, e.dims.length / 2 + 1.4);
    const yaw = Math.atan2(_v.set(0, 0, -1).applyQuaternion(car.quat).x, _v.z);
    return { x: p.x, y: car.pos.y, z: p.z, yaw, kneel: false, work: 0 };
  }

  dispose(): void {
    for (const m of this.meshes.values()) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
  }
}

const W = Array.from({ length: RIG_MAP.length }, () => new THREE.Quaternion());
const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
const _qi = new THREE.Quaternion();
const _qp = new THREE.Quaternion();
const _qt = new THREE.Quaternion();

function turn(a: number, b: number, k: number): number {
  const d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + d * Math.min(1, k);
}
