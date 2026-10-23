import { COMPOUNDS, WEAR_PER_J, wearGrip, wearRate, type Compound } from './tyres';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { CarEntry, CarSpecs, Surface } from '@apex/shared';
import type { Assists } from '../settings';
import { Drivetrain, RPM_TO_RADS } from './drivetrain';
import type { Controls } from './input';
import { SLICK, TireModel } from './tire';
import { KeyboardDriver, type MotionState } from './keyboardDriver';
import type { DamageState } from './damage';

type R = typeof RAPIER;

export interface SurfaceProps {
  grip: number;
  /** Rolling resistance coefficient. */
  rolling: number;
  /** Extra speed-proportional drag per wheel (N per m/s per kN load) for deep surfaces. */
  drag: number;
  /** Visual/camera vibration amount. */
  bumpy: number;
}

export const SURFACE_PROPS: Record<Surface, SurfaceProps> = {
  asphalt: { grip: 1, rolling: 0.013, drag: 0, bumpy: 0 },
  curb: { grip: 0.9, rolling: 0.02, drag: 0, bumpy: 1 },
  grass: { grip: 0.55, rolling: 0.06, drag: 1.2, bumpy: 0.35 },
  gravel: { grip: 0.5, rolling: 0.15, drag: 6, bumpy: 0.8 },
  sand: { grip: 0.42, rolling: 0.22, drag: 9, bumpy: 0.6 },
  wall: { grip: 0.4, rolling: 0.05, drag: 0, bumpy: 0.2 },
};

export interface GroundHit {
  dist: number;
  px: number;
  py: number;
  pz: number;
  nx: number;
  ny: number;
  nz: number;
  surface: Surface;
}

export interface GroundQuery {
  /** Cast a ray; returns null when nothing is hit within maxDist. Must exclude the car itself. */
  cast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number, out: GroundHit): GroundHit | null;
}

const KEYS = ['FL', 'FR', 'RL', 'RR'] as const;
export type WheelKey = (typeof KEYS)[number];
const G = 9.81;
/** Rapier interaction groups: (membership << 16) | filter. Track = bit 0, cars = bit 1. */
export const TRACK_GROUPS = (0x0001 << 16) | 0xffff;
export const CAR_GROUPS = (0x0002 << 16) | 0x0001;
/** Wheel rays only see the track. */
export const RAY_GROUPS = (0xffff << 16) | 0x0001;
/** Standard air (15 °C, sea level): the reference for drag, downforce and engine power. */
export const RHO = 1.225;

/**
 * Tyre temperature, a single lumped value per tyre (as a driver's display shows it).
 * Heat comes from sliding (force × slip speed), from the carcass flexing under load (force × speed: what warms
 * the front tyres in the corners, not only the driven rears) and rolling; the airflow cools it, and the track
 * surface heats it on a sunny day or chills it on a cold one. Slicks have a working window: within a few degrees
 * of the optimum there is no loss; a cold slick (out of the garage, after a safety car) slides clearly more, an
 * overheated one loses grip again and wears faster. Constants tuned with tools/sim/ailap.ts (DECISIONS.md,
 * "Tyre and air temperature").
 */
export const TYRE_TEMP = {
  optimumC: 85,
  /** No loss within ± this many °C of the optimum. */
  windowC: 6,
  /** Grip lost when this far (°C) below / above the window, and how far that is. */
  coldPenalty: 0.12,
  coldSpanC: 30,
  hotPenalty: 0.1,
  hotSpanC: 25,
  heatCapacity: 6000, // J/K
  coolBase: 13, // W/K
  coolPerMs: 1.2, // W/K per m/s
  rolling: 0.0075, // × Fz × speed
  /** Carcass flex: × (|Fx| + |Fy|) × speed. */
  flex: 0.006,
  /** Conduction with the track surface while in contact (W/K). */
  road: 50,
  /** Front cornering heat (×): GT3 fronts run −3.5…−4° of camber and scrub as they steer, which heats them more
   * than the same slip at the rear. */
  frontScrub: 1.7,
  /** Extra cooling on a fully wet track (×). */
  wetCool: 1.5,
};

/** Engine power in air of this density, against standard air: a naturally aspirated engine loses it all; a turbo
 * (GT3 boost limits are ratios of the ambient pressure, SRO BoP) or a hybrid about half. */
export function engineAirScale(s: CarSpecs, rho: number): number {
  const r = rho / RHO;
  return s.aspiration === 'na' ? r : Math.sqrt(r);
}

/**
 * Brake discs (GT3 steel discs, ~8 kg front): braking power heats them, airflow cools them.
 * Their friction is best between ~250 and ~700 °C: cold brakes bite a little less, and above ~700 °C they
 * fade (down to −30 %). Tuned so a hard stop from 250 km/h adds ~150–200 °C and a straight cools them again.
 */
export const BRAKE_TEMP = {
  heatCapacity: 3000, // J/K per disc
  coolBase: 8, // W/K
  coolPerMs: 0.95, // W/K per m/s
  coldC: 200,
  fadeC: 700,
  fadeCarbonC: 1000,
};

export function brakeTempFactor(t: number, carbon = false): number {
  // carbon-ceramic discs (Ferrari Challenge, the AMG ONE) work far hotter than GT3 steel before they fade
  const fade = carbon ? BRAKE_TEMP.fadeCarbonC : BRAKE_TEMP.fadeC;
  if (t < BRAKE_TEMP.coldC) return 0.86 + 0.14 * (t / BRAKE_TEMP.coldC);
  if (t <= fade) return 1;
  return Math.max(0.7, 1 - (t - fade) / 600);
}

export function tyreTempGrip(t: number, optimumC = TYRE_TEMP.optimumC): number {
  const d = t - optimumC;
  const T = TYRE_TEMP;
  if (Math.abs(d) <= T.windowC) return 1;
  if (d < 0) {
    const x = (-d - T.windowC) / T.coldSpanC;
    return 1 - T.coldPenalty * Math.min(1, x * x);
  }
  const x = (d - T.windowC) / T.hotSpanC;
  return 1 - T.hotPenalty * Math.min(1, x * x);
}

export class Wheel {
  readonly front: boolean;
  readonly left: boolean;
  /** Hardpoint in car-local space (top of suspension travel). */
  readonly hx: number;
  readonly hy: number;
  readonly hz: number;
  readonly radius: number;
  readonly restLen: number;
  readonly travel: number;
  readonly k: number;
  readonly cBump: number;
  readonly cRebound: number;
  readonly inertia: number;
  readonly fz0: number;
  driven = false;

  compression = 0;
  prevCompression = 0;
  contact = false;
  surface: Surface = 'asphalt';
  /** World-space contact point & normal. */
  cpx = 0;
  cpy = 0;
  cpz = 0;
  nx = 0;
  ny = 1;
  nz = 0;
  omega = 0;
  angle = 0;
  steer = 0;
  fz = 0;
  slipRatio = 0;
  slipAngle = 0;
  alphaRelax = 0;
  fx = 0;
  fy = 0;
  driveTorque = 0;
  brakeTorque = 0;
  /** Wheel centre offset below the hardpoint (m), for visuals. */
  springLen = 0;
  /** Tyre temperature (°C): see TYRE_TEMP. */
  temp = 35;
  /** Tread worn away, 0 (new) … 1 (down to the cords). */
  wear = 0;
  /** Brake disc temperature (°C): see BRAKE_TEMP. */
  brakeTemp = 60;

  constructor(
    readonly key: WheelKey,
    geom: { position: [number, number, number]; radius: number },
    s: CarSpecs,
    staticLoad: number,
  ) {
    this.front = key[0] === 'F';
    this.left = key[1] === 'L';
    this.radius = geom.radius;
    this.travel = s.suspTravelM;
    this.k = this.front ? s.springRateFront : s.springRateRear;
    const quarterMass = staticLoad / G;
    const crit = 2 * Math.sqrt(this.k * quarterMass);
    this.cBump = crit * 0.32;
    this.cRebound = crit * 0.55;
    this.fz0 = staticLoad;
    const staticComp = staticLoad / this.k;
    this.restLen = this.travel * 0.55 + staticComp;
    // hardpoint so that at static compression the wheel sits where the model has it
    this.hx = geom.position[0];
    this.hy = geom.position[1] + (this.restLen - staticComp);
    this.hz = geom.position[2];
    this.inertia = 1.1 + 2.2 * this.radius * this.radius; // tyre + rim ≈ 1.35 kg·m²
    this.springLen = this.restLen - staticComp;
  }
}

export interface VehicleTelemetry {
  speed: number;
  forwardSpeed: number;
  rpm: number;
  gear: number;
  slipBody: number;
  absActive: boolean;
  tcActive: boolean;
  airborne: number;
  surfaceRumble: number;
  longAccel: number;
  latAccel: number;
}

const tmpF = new Float64Array(2);

export class Vehicle {
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  readonly wheels: Wheel[];
  readonly drivetrain: Drivetrain;
  readonly tire = new TireModel(SLICK);
  readonly specs: CarSpecs;
  readonly mass: number;
  readonly comY: number;
  readonly comZ: number;
  readonly wheelbase: number;
  readonly trackWidth: number;
  readonly maxSteer: number;
  steerAngle = 0;
  /** Keyboard filters (rate limiters, slip-based steering limit, self-steer, ramped pedals). */
  readonly kbd = new KeyboardDriver();
  /** Effective pedal values after filtering (for brake lights and HUD). */
  readonly pedals = { throttle: 0, brake: 0 };
  private motion: MotionState = { vx: 0, vy: 0, r: 0, a: 1.3, b: 1.3, wheelbase: 2.6, maxLockRad: 0.4, alphaPeak: 0.115 };
  /** Grip of the fitted compound for the current water on the track (set from the weather). */
  weatherGrip = 1;
  /** Fitted tyre compound. */
  compound: Compound = COMPOUNDS.medium;
  /** Track water 0..1 (for tyre wear). */
  wetness = 0;
  /** Aerodynamic wake of a car ahead: drag and downforce multipliers (1 = clean air). */
  readonly wake = { drag: 1, downforce: 1, strength: 0 };
  /** Pit lane speed limiter (m/s), null when off. */
  speedLimitMs: number | null = null;
  /** Air temperature (°C), for the tyres and brakes. */
  ambientC = 20;
  /** Track surface temperature (°C): tyres in contact take heat from it or give heat to it. */
  trackC = 25;
  /** Air density (kg/m³): drag, downforce and engine power follow it (setAir). */
  airDensity = RHO;
  assists: Assists;
  frozen = false;
  readonly telemetry: VehicleTelemetry = {
    speed: 0,
    forwardSpeed: 0,
    rpm: 0,
    gear: 1,
    slipBody: 0,
    absActive: false,
    tcActive: false,
    airborne: 0,
    surfaceRumble: 0,
    longAccel: 0,
    latAccel: 0,
  };
  private hit: GroundHit = { dist: 0, px: 0, py: 0, pz: 0, nx: 0, ny: 1, nz: 0, surface: 'asphalt' };
  private reverseTimer = 0;
  private tcCut = 0;
  private prevVel = { x: 0, y: 0, z: 0 };
  // cached basis (world) of the chassis
  private fx = 0;
  private fy = 0;
  private fz = 1;
  private ux = 0;
  private uy = 1;
  private uz = 0;
  private lx = 1;
  private ly = 0;
  private lz = 0;

  constructor(
    private readonly R: R,
    private readonly world: RAPIER.World,
    readonly car: CarEntry,
    private readonly ground: GroundQuery,
    assists: Assists,
    private readonly damage: DamageState,
  ) {
    const s = car.specs;
    this.specs = s;
    this.assists = assists;
    this.mass = s.massKg;
    this.wheelbase = car.wheelbase;
    this.trackWidth = (car.trackFront + car.trackRear) / 2;
    this.maxSteer = (s.maxSteerDeg * Math.PI) / 180;
    // centre of mass: weight distribution between the axles, at the given height
    const zf = car.wheels.FL.position[2];
    const zr = car.wheels.RL.position[2];
    this.comZ = zr + (zf - zr) * s.weightFront;
    this.comY = s.comHeightM;
    this.drivetrain = new Drivetrain(s);

    const desc = R.RigidBodyDesc.dynamic().setCanSleep(false).setLinearDamping(0.0).setAngularDamping(0.05);
    // No continuous collision detection: against the track trimeshes Rapier's CCD clamped the car's motion
    // to a predicted "impact" with the road at speed (the car covered ~half the distance its velocity said),
    // and cost ~30× a normal step. At 120 Hz a car moves at most ~0.7 m per step, far less than its own size,
    // so it cannot tunnel through a wall.
    this.body = world.createRigidBody(desc);
    const L = car.dims.length;
    const W = car.dims.width;
    const H = Math.min(car.dims.height, 1.3);
    // The body only needs to hit walls and barriers (the wheels carry the car), so it starts 30 cm up:
    // a low box scraped the road over crests and kerbs ("crashing with nothing").
    // (A rounded cuboid would be nicer, but it produced NaNs against trimesh walls in Rapier 0.14.)
    const bottom = 0.3;
    const hx = W * 0.44;
    const hy = Math.max(0.22, (H * 0.8 - bottom) / 2);
    const hz = L * 0.46;
    const cdesc = R.ColliderDesc.cuboid(hx, hy, hz)
      .setTranslation(0, bottom + hy, (zf + zr) / 2)
      .setDensity(0)
      .setFriction(0.35)
      .setRestitution(0.05)
      // ghost cars: a car collides with the track only, never with another car
      .setCollisionGroups(CAR_GROUPS)
      .setActiveEvents(R.ActiveEvents.CONTACT_FORCE_EVENTS)
      .setContactForceEventThreshold(this.mass * 4);
    this.collider = world.createCollider(cdesc, this.body);
    const m = this.mass;
    const ix = (m / 12) * (H * H + L * L) * 0.75;
    const iy = (m / 12) * (W * W + L * L) * 0.8;
    const iz = (m / 12) * (W * W + H * H) * 0.7;
    this.body.setAdditionalMassProperties(m, { x: 0, y: this.comY, z: this.comZ }, { x: ix, y: iy, z: iz }, { x: 0, y: 0, z: 0, w: 1 }, true);

    const frontLoad = (m * G * s.weightFront) / 2;
    const rearLoad = (m * G * (1 - s.weightFront)) / 2;
    // symmetric axles for the physics (source models are a few millimetres lopsided, which would pull)
    const sym = (a: 'FL' | 'RL', b: 'FR' | 'RR', left: boolean) => {
      const wa = car.wheels[a];
      const wb = car.wheels[b];
      const x = (Math.abs(wa.position[0]) + Math.abs(wb.position[0])) / 2;
      return {
        position: [left ? x : -x, (wa.position[1] + wb.position[1]) / 2, (wa.position[2] + wb.position[2]) / 2] as [number, number, number],
        radius: (wa.radius + wb.radius) / 2,
      };
    };
    const geom = { FL: sym('FL', 'FR', true), FR: sym('FL', 'FR', false), RL: sym('RL', 'RR', true), RR: sym('RL', 'RR', false) };
    this.wheels = KEYS.map((k) => new Wheel(k, geom[k], s, k[0] === 'F' ? frontLoad : rearLoad));
    for (const w of this.wheels) {
      w.driven = s.drivetrain === 'AWD' || (s.drivetrain === 'RWD' ? !w.front : w.front);
    }
  }

  /** Place the car (chassis origin at ground level) with a heading. */
  /** The air of the session (temperatures() in the shared weather code). */
  setAir(airC: number, trackC: number, density: number): void {
    this.ambientC = airC;
    this.trackC = trackC;
    this.airDensity = density;
    this.drivetrain.airScale = engineAirScale(this.specs, density);
  }

  /** Tyres straight out of the garage: a little above air temperature. */
  setTyreTemps(c: number): void {
    for (const w of this.wheels) w.temp = c;
  }

  /** A new set of tyres (pit stop): new tread, garage temperature. */
  fitTyres(compound: Compound, tempC: number): void {
    this.compound = compound;
    for (const w of this.wheels) {
      w.wear = 0;
      w.temp = tempC;
    }
  }

  /** Average grip factor left from wear (for the AI's speed profile). */
  /**
   * Grip left in the tyres from wear and temperature, of the weaker axle (for the AI's speed profile: wets
   * overheating on a drying track, or a worn rear, would otherwise send the bots in too fast and spin them).
   */
  get tyreGripAvg(): number {
    let f = 0;
    let r = 0;
    for (const w of this.wheels) {
      const g = wearGrip(w.wear) * tyreTempGrip(w.temp, this.compound.optimumC);
      if (w.front) f += g;
      else r += g;
    }
    return Math.min(f, r) / 2;
  }

  place(x: number, y: number, z: number, yaw: number): void {
    const h = yaw / 2;
    // On the ground under (x, z) when it can be found (grid slots, resets): dropped from a few centimetres the
    // car landed and bounced on its springs in front of everyone during the countdown.
    const gh = this.ground.cast(x, y + 1.2, z, 0, -1, 0, 3, this.hit);
    const gy = gh ? gh.py + 0.005 : y + 0.05;
    this.body.setTranslation({ x, y: gy, z }, true);
    this.body.setRotation({ x: 0, y: Math.sin(h), z: 0, w: Math.cos(h) }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    for (const w of this.wheels) {
      w.omega = 0;
      w.compression = w.prevCompression = w.fz0 / w.k;
      w.alphaRelax = 0;
    }
    this.kbd.reset();
    this.drivetrain.setGear(1);
    this.drivetrain.rpm = this.specs.idleRpm;
    this.steerAngle = 0;
  }

  get reverse(): boolean {
    return this.drivetrain.gear < 0;
  }

  private basis(q: { x: number; y: number; z: number; w: number }): void {
    const { x, y, z, w } = q;
    // columns of the rotation matrix: local X (left), Y (up), Z (forward)
    this.lx = 1 - 2 * (y * y + z * z);
    this.ly = 2 * (x * y + z * w);
    this.lz = 2 * (x * z - y * w);
    this.ux = 2 * (x * y - z * w);
    this.uy = 1 - 2 * (x * x + z * z);
    this.uz = 2 * (y * z + x * w);
    this.fx = 2 * (x * z + y * w);
    this.fy = 2 * (y * z - x * w);
    this.fz = 1 - 2 * (x * x + y * y);
  }

  /** One fixed physics step (before world.step). */
  private lastGood = { x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1 };

  step(dt: number, c: Controls): void {
    const body = this.body;
    body.resetForces(true);
    body.resetTorques(true);
    // safety net: a solver blow-up must never lose the car
    const tp = body.translation();
    if (!Number.isFinite(tp.x) || !Number.isFinite(tp.y) || !Number.isFinite(tp.z)) {
      const g = this.lastGood;
      body.setTranslation({ x: g.x, y: g.y + 0.3, z: g.z }, true);
      body.setRotation({ x: g.qx, y: g.qy, z: g.qz, w: g.qw }, true);
      body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      for (const w of this.wheels) w.omega = 0;
    } else {
      const rq = body.rotation();
      const g = this.lastGood;
      g.x = tp.x;
      g.y = tp.y;
      g.z = tp.z;
      g.qx = rq.x;
      g.qy = rq.y;
      g.qz = rq.z;
      g.qw = rq.w;
    }
    const q = body.rotation();
    this.basis(q);
    const p = body.translation();
    const v = body.linvel();
    const av = body.angvel();
    const com = body.worldCom();
    const s = this.specs;
    const dmg = this.damage;

    const vF = v.x * this.fx + v.y * this.fy + v.z * this.fz;
    const vL = v.x * this.lx + v.y * this.ly + v.z * this.lz;
    const speed = Math.hypot(v.x, v.y, v.z);
    const tel = this.telemetry;
    tel.speed = speed;
    tel.forwardSpeed = vF;
    tel.slipBody = Math.abs(vF) > 3 ? Math.atan2(vL, Math.abs(vF)) : 0;
    tel.longAccel = ((v.x - this.prevVel.x) * this.fx + (v.y - this.prevVel.y) * this.fy + (v.z - this.prevVel.z) * this.fz) / dt;
    tel.latAccel = ((v.x - this.prevVel.x) * this.lx + (v.y - this.prevVel.y) * this.ly + (v.z - this.prevVel.z) * this.lz) / dt;
    this.prevVel.x = v.x;
    this.prevVel.y = v.y;
    this.prevVel.z = v.z;

    if (this.frozen) {
      body.setLinvel({ x: v.x * 0.8, y: v.y, z: v.z * 0.8 }, true);
    }

    /* ---------------------------------------------------- gear logic --- */
    const dt2 = this.drivetrain;
    // keyboard: filters run here, every physics step (frame-rate independent, uses the car's motion)
    let throttleIn = c.throttle;
    let brakeIn = c.brake;
    let hbTorque = c.handbrake * 700;
    if (c.digital) {
      const m = this.motion;
      m.vx = vF;
      m.vy = vL;
      m.r = av.x * this.ux + av.y * this.uy + av.z * this.uz;
      m.a = this.car.wheels.FL.position[2] - this.comZ;
      m.b = this.comZ - this.car.wheels.RL.position[2];
      m.wheelbase = this.wheelbase;
      m.maxLockRad = this.maxSteer;
      m.alphaPeak = this.tire.p.alphaPeak;
      this.kbd.step(dt, c, m);
      throttleIn = this.kbd.throttle;
      brakeIn = this.kbd.brake;
      hbTorque = this.kbd.handbrakeTorque(speed);
    }
    // pit lane speed limiter: no throttle above the limit, and the brakes bring an over-speed car down to it
    if (this.speedLimitMs !== null && vF > this.speedLimitMs) {
      throttleIn = 0;
      brakeIn = Math.max(brakeIn, Math.min(0.7, (vF - this.speedLimitMs) * 0.25));
    }
    this.pedals.throttle = throttleIn;
    this.pedals.brake = brakeIn;
    let throttle = this.frozen ? 0 : throttleIn;
    const brake = brakeIn;
    if (!dt2.manual || dt2.gear <= 0) {
      // reverse engagement: hold brake while (almost) stopped
      if (dt2.gear >= 1 && Math.abs(vF) < 0.8 && c.brake > 0.9 && c.throttle < 0.05) {
        this.reverseTimer += dt;
        if (this.reverseTimer > 0.35) dt2.setGear(-1);
      } else if (dt2.gear === -1 && Math.abs(vF) < 0.8 && c.brake > 0.9) {
        // in reverse the smoother swaps keys: "brake" here means the forward key → back to first
        this.reverseTimer += dt;
        if (this.reverseTimer > 0.2) dt2.setGear(1);
      } else this.reverseTimer = 0;
    }

    /* ---------------------------------------------------- assists ----- */
    // traction control: trim throttle when driven wheels spin
    tel.tcActive = false;
    if (this.assists.tc > 0 && throttle > 0) {
      const thr = this.assists.tc === 2 ? 0.07 : 0.13;
      let worst = 0;
      for (const w of this.wheels) if (w.driven && w.contact) worst = Math.max(worst, Math.abs(w.slipRatio));
      const target = Math.min(0.85, Math.max(0, (worst - thr) / 0.12));
      this.tcCut += (target - this.tcCut) * Math.min(1, dt * 25);
      if (this.tcCut > 0.05) tel.tcActive = true;
      throttle *= 1 - this.tcCut;
    } else this.tcCut = 0;
    // stability control: limit oversteer by cutting throttle and braking the outer front wheel
    let escBrake = 0;
    let escWheel = -1;
    if (this.assists.stability && Math.abs(vF) > 8) {
      const beta = tel.slipBody;
      if (Math.abs(beta) > 0.09) {
        throttle *= 0.4;
        escBrake = Math.min(2500, (Math.abs(beta) - 0.09) * 20000);
        escWheel = beta > 0 ? 1 : 0; // sliding left (rear out to the right) → brake front-right
      }
    }

    /* ---------------------------------------------------- steering ---- */
    // keyboard: angle from the slip-limited filter; analog (bots): fraction of the mechanical lock
    let steer = c.digital ? this.kbd.steerAngle : Math.max(-1, Math.min(1, c.steer)) * this.maxSteer;
    if (this.assists.steering && Math.abs(vF) > 6) {
      // optional extra counter-steer proportional to the body slip angle
      steer += Math.max(-0.15, Math.min(0.15, -tel.slipBody * 0.8));
    }
    const pull = dmg.alignment; // radians, damage-induced pull (0 without damage)
    this.steerAngle = Math.max(-this.maxSteer, Math.min(this.maxSteer, steer)) + pull;
    const ack = 0.12 * Math.sign(this.steerAngle);
    this.wheels[0].steer = this.steerAngle * (1 + ack); // FL (inner when turning left)
    this.wheels[1].steer = this.steerAngle * (1 - ack); // FR
    this.wheels[2].steer = 0;
    this.wheels[3].steer = 0;

    /* ---------------------------------------------------- suspension -- */
    const g = this.ground;
    const hit = this.hit;
    let contacts = 0;
    let rumble = 0;
    for (const w of this.wheels) {
      const hpx = p.x + w.hx * this.lx + w.hy * this.ux + w.hz * this.fx;
      const hpy = p.y + w.hx * this.ly + w.hy * this.uy + w.hz * this.fy;
      const hpz = p.z + w.hx * this.lz + w.hy * this.uz + w.hz * this.fz;
      const maxD = w.restLen + w.radius + dmg.rideDrop(w.key);
      const h = g.cast(hpx, hpy, hpz, -this.ux, -this.uy, -this.uz, maxD, hit);
      w.prevCompression = w.compression;
      if (h) {
        w.contact = true;
        contacts++;
        w.springLen = h.dist - w.radius;
        w.compression = Math.max(0, w.restLen - w.springLen);
        w.cpx = h.px;
        w.cpy = h.py;
        w.cpz = h.pz;
        w.nx = h.nx;
        w.ny = h.ny;
        w.nz = h.nz;
        w.surface = h.surface;
        rumble = Math.max(rumble, SURFACE_PROPS[h.surface].bumpy);
      } else {
        w.contact = false;
        w.springLen = w.restLen;
        w.compression = 0;
      }
    }
    tel.airborne = contacts === 0 ? tel.airborne + dt : 0;
    tel.surfaceRumble = rumble;

    // spring + damper + anti-roll
    const arbF = s.antiRollFront;
    const arbR = s.antiRollRear;
    for (let i = 0; i < 4; i++) {
      const w = this.wheels[i];
      if (!w.contact) {
        w.fz = 0;
        continue;
      }
      const vel = (w.compression - w.prevCompression) / dt;
      const damp = (vel > 0 ? w.cBump : w.cRebound) * vel * dmg.damperScale(w.key);
      let f = w.k * w.compression + damp;
      const other = this.wheels[i ^ 1];
      const arb = w.front ? arbF : arbR;
      f += arb * (w.compression - other.compression);
      if (w.compression > w.travel) f += 350000 * (w.compression - w.travel); // bump stop
      w.fz = Math.max(0, f);
    }

    /* ---------------------------------------------------- drivetrain -- */
    let drivenOmega = 0;
    let nDriven = 0;
    for (const w of this.wheels)
      if (w.driven) {
        drivenOmega += w.omega;
        nDriven++;
      }
    drivenOmega /= Math.max(1, nDriven);
    const axleTorque = dt2.update(dt, throttle, drivenOmega, speed);
    tel.rpm = dt2.rpm;
    tel.gear = dt2.gear;
    const front = s.drivetrain === 'AWD' ? s.frontTorqueSplit : s.drivetrain === 'FWD' ? 1 : 0;
    this.splitAxle(0, 1, axleTorque * front);
    this.splitAxle(2, 3, axleTorque * (1 - front));

    /* ---------------------------------------------------- brakes ------ */
    tel.absActive = false;
    const brakeTotal = s.brakeTorqueNm * brake;
    for (let i = 0; i < 4; i++) {
      const w = this.wheels[i];
      let bt = ((brakeTotal * (w.front ? s.brakeBiasFront : 1 - s.brakeBiasFront)) / 2) * brakeTempFactor(w.brakeTemp, s.carbonBrakes);
      if (this.assists.abs && bt > 0 && w.contact && Math.abs(vF) > 3 && w.slipRatio < -0.13) {
        bt *= 0.25;
        tel.absActive = true;
      }
      if (!w.front) bt += hbTorque;
      if (i === escWheel) bt += escBrake;
      w.brakeTorque = bt;
      // disc temperature: friction power in, airflow out
      const heat = Math.abs(bt * w.omega) * (w.front ? 1 : 0.85);
      const cool = (BRAKE_TEMP.coolBase + BRAKE_TEMP.coolPerMs * speed) * (w.brakeTemp - this.ambientC);
      w.brakeTemp += ((heat - cool) / BRAKE_TEMP.heatCapacity) * dt;
    }

    /* ---------------------------------------------------- tyres ------- */
    const SUB = 4;
    const h = dt / SUB;
    const muBase = s.tyreGrip * this.weatherGrip;
    for (const w of this.wheels) {
      // contact frame
      const sinS = Math.sin(w.steer);
      const cosS = Math.cos(w.steer);
      let wfx = this.fx * cosS + this.lx * sinS;
      let wfy = this.fy * cosS + this.ly * sinS;
      let wfz = this.fz * cosS + this.lz * sinS;
      const nx = w.contact ? w.nx : this.ux;
      const ny = w.contact ? w.ny : this.uy;
      const nz = w.contact ? w.nz : this.uz;
      const dn = wfx * nx + wfy * ny + wfz * nz;
      wfx -= nx * dn;
      wfy -= ny * dn;
      wfz -= nz * dn;
      const fl = Math.hypot(wfx, wfy, wfz) || 1;
      wfx /= fl;
      wfy /= fl;
      wfz /= fl;
      // lateral = n × forward (points to the car's left)
      const wlx = ny * wfz - nz * wfy;
      const wly = nz * wfx - nx * wfz;
      const wlz = nx * wfy - ny * wfx;

      if (!w.contact) {
        // free wheel: driven torque spins it, brakes stop it
        w.omega += (w.driveTorque / w.inertia) * dt;
        const bd = (w.brakeTorque / w.inertia) * dt;
        w.omega = Math.abs(w.omega) <= bd ? 0 : w.omega - Math.sign(w.omega) * bd;
        w.omega *= 0.998;
        w.fx = w.fy = 0;
        w.angle += w.omega * dt;
        continue;
      }
      // velocity of the contact patch
      const rx = w.cpx - com.x;
      const ry = w.cpy - com.y;
      const rz = w.cpz - com.z;
      const cvx = v.x + av.y * rz - av.z * ry;
      const cvy = v.y + av.z * rx - av.x * rz;
      const cvz = v.z + av.x * ry - av.y * rx;
      const vx = cvx * wfx + cvy * wfy + cvz * wfz;
      const vy = cvx * wlx + cvy * wly + cvz * wlz;
      const surf = SURFACE_PROPS[w.surface];
      const mu = muBase * surf.grip * dmg.gripScale(w.key) * tyreTempGrip(w.temp, this.compound.optimumC) * wearGrip(w.wear);
      const fz = w.fz;
      const R = w.radius;
      const den = Math.max(Math.abs(vx), 2.5);
      // lateral slip with a short relaxation length (stable at parking speeds)
      const alpha = Math.atan2(-vy, Math.max(Math.abs(vx), 2.5));
      w.alphaRelax += (alpha - w.alphaRelax) * Math.min(1, ((Math.abs(vx) + 2) * dt) / 0.25);
      w.slipAngle = w.alphaRelax;
      // initial slope of the longitudinal curve (N per unit slip ratio)
      const kx = (mu * fz * this.tire.bx * this.tire.cx) / this.tire.p.kappaPeak;
      let fxSum = 0;
      let fySum = 0;
      for (let sub = 0; sub < SUB; sub++) {
        // implicit linear step for wheel spin, then evaluate the non-linear tyre at the new slip
        const tq = w.driveTorque;
        let om = (w.omega + (h / w.inertia) * (tq + (kx * R * vx) / den)) / (1 + (h * kx * R * R) / (w.inertia * den));
        let kappa = (om * R - vx) / den;
        if (Math.abs(kappa) > this.tire.p.kappaPeak * 0.7) {
          // saturated: explicit step with the actual (flat) force
          this.tire.force(kappa, w.slipAngle, fz, w.fz0, mu, tmpF);
          om = w.omega + ((tq - tmpF[0] * R) / w.inertia) * h;
          kappa = (om * R - vx) / den;
        }
        // brakes: friction torque that can stop but never reverse the wheel
        const bd = (w.brakeTorque / w.inertia) * h;
        if (Math.abs(om) <= bd) om = 0;
        else om -= Math.sign(om) * bd;
        w.omega = om;
        kappa = (om * R - vx) / den;
        this.tire.force(kappa, w.slipAngle, fz, w.fz0, mu, tmpF);
        fxSum += tmpF[0];
        fySum += tmpF[1];
        w.slipRatio = kappa;
      }
      let fxT = fxSum / SUB;
      const fyT = fySum / SUB;
      // rolling resistance & deep-surface drag
      const roll = Math.min(1, Math.abs(vx) / 0.5);
      fxT -= Math.sign(vx) * roll * fz * (surf.rolling + (surf.drag * Math.abs(vx)) / 1000);
      w.fx = fxT;
      w.fy = fyT;
      w.angle += w.omega * dt;
      // tyre temperature
      const slipPower = Math.abs((fxSum / SUB) * (w.omega * R - vx)) + Math.abs(fyT * vy) * (w.front ? TYRE_TEMP.frontScrub : 1);
      const heat = slipPower + (TYRE_TEMP.rolling * fz + TYRE_TEMP.flex * (Math.abs(fxT) + Math.abs(fyT))) * Math.abs(vx);
      // water on the track carries heat away (why slicks never reach their window in the rain, and why wets on
      // a wet track stay near their 65 °C instead of cooking: bots' rear wets ran away past 200 °C and spun)
      const cool =
        (TYRE_TEMP.coolBase + TYRE_TEMP.coolPerMs * Math.abs(vx)) * (1 + TYRE_TEMP.wetCool * this.wetness) * (w.temp - this.ambientC) +
        (w.contact ? TYRE_TEMP.road : 0) * (w.temp - this.trackC);
      w.temp += ((heat - cool) / (TYRE_TEMP.heatCapacity * this.compound.heatCap)) * dt;
      // tread wear from sliding energy, faster when overheated
      const over = Math.max(0, w.temp - this.compound.optimumC - 15) / 30;
      w.wear = Math.min(1, w.wear + slipPower * dt * WEAR_PER_J * wearRate(this.compound, this.wetness) * (1 + over));
      // force at the contact patch, raised towards a roll centre to tame roll-over
      const fwx = wfx * fxT + wlx * fyT + nx * fz;
      const fwy = wfy * fxT + wly * fyT + ny * fz;
      const fwz = wfz * fxT + wlz * fyT + nz * fz;
      const lift = 0.12;
      body.addForceAtPoint({ x: fwx, y: fwy, z: fwz }, { x: w.cpx + this.ux * lift, y: w.cpy + this.uy * lift, z: w.cpz + this.uz * lift }, true);
    }

    /* ---------------------------------------------------- aero -------- */
    // slipstream: the wake of a car ahead lowers drag (and some downforce): set by the session each frame
    const dragArea = s.dragArea * dmg.dragScale() * this.wake.drag;
    const fd = 0.5 * this.airDensity * dragArea * speed;
    body.addForce({ x: -fd * v.x, y: -fd * v.y, z: -fd * v.z }, true);
    const df = 0.5 * this.airDensity * s.downforceArea * dmg.downforceScale() * this.wake.downforce * vF * vF;
    const dfF = df * s.aeroBalanceFront;
    const dfR = df - dfF;
    const zf = this.car.wheels.FL.position[2];
    const zr = this.car.wheels.RL.position[2];
    body.addForceAtPoint(
      { x: -this.ux * dfF, y: -this.uy * dfF, z: -this.uz * dfF },
      { x: p.x + this.fx * zf, y: p.y + this.fy * zf, z: p.z + this.fz * zf },
      true,
    );
    body.addForceAtPoint(
      { x: -this.ux * dfR, y: -this.uy * dfR, z: -this.uz * dfR },
      { x: p.x + this.fx * zr, y: p.y + this.fy * zr, z: p.z + this.fz * zr },
      true,
    );

    // parking brake when stopped with nothing pressed keeps the car from creeping on slopes
    if (speed < 0.25 && throttleIn < 0.02 && contacts >= 3) {
      body.setLinvel({ x: v.x * 0.9, y: v.y, z: v.z * 0.9 }, true);
    }
  }

  /** Limited-slip differential: open split plus a speed-difference locking torque. */
  private splitAxle(a: number, b: number, torque: number): void {
    const wa = this.wheels[a];
    const wb = this.wheels[b];
    if (torque === 0 && !wa.driven) {
      wa.driveTorque = wb.driveTorque = 0;
      return;
    }
    const lock = this.specs.diffLock;
    const d = wa.omega - wb.omega;
    const limit = lock * Math.max(Math.abs(torque), 250) * 0.5;
    const bias = Math.max(-limit, Math.min(limit, d * 90));
    wa.driveTorque = torque / 2 - bias;
    wb.driveTorque = torque / 2 + bias;
  }

  shift(dir: 1 | -1): void {
    this.drivetrain.requestShift(dir);
  }

  get rpmRatio(): number {
    return this.drivetrain.rpm / this.specs.redlineRpm;
  }

  /** Angular speed (rad/s) at the wheels in the current gear at a given rpm (debug/UI). */
  wheelOmegaAt(rpm: number): number {
    const r = this.drivetrain.ratio();
    return r === 0 ? 0 : (rpm * RPM_TO_RADS) / r;
  }

  dispose(): void {
    this.world.removeRigidBody(this.body);
  }
}
