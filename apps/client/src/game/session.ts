import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import {
  PENALTY,
  WEATHER_LABEL,
  FLAG_BRAKE,
  FLAG_HANDBRAKE,
  FLAG_HEADLIGHTS,
  FLAG_OFF_TRACK,
  FLAG_RESET,
  FLAG_REVERSE,
  FLAG_SMOKE,
  PHYSICS_HZ,
  RESET_FREEZE_MS,
  STATE_HZ,
  STATES_PER_PACKET,
  CLIENT_HEADER,
  STATE_BYTES,
  RaceTracker,
  decodeRelay,
  encodeBotStates,
  encodeClientStates,
  makeCarState,
  nearestCenterlineIndex,
  planWeather,
  weatherAt,
  type CarEntry,
  type CarState,
  type CarsFile,
  type RaceEvent,
  type RaceSetup,
  type RoomSnapshot,
  type ServerMsg,
  type Standing,
  type TrackData,
  type WeatherState,
} from '@apex/shared';
import type { Connection } from '../net/connection';
import { RemoteCarBuffer } from '../net/remote';
import { DamageState } from '../physics/damage';
import { InputSmoother, Keyboard } from '../physics/input';
import { Vehicle } from '../physics/vehicle';
import { QUALITY, settings } from '../settings';
import { Hud } from '../ui/hud';
import { loadCarModel, loadTrackFile, type Progress } from './assets';
import { AiDriver, BOT_ASSISTS } from './ai';
import { Cinematic, type Entrant } from './cinematic';
import type { GameAudio } from '../audio/audio';
import { SessionAudio, type OtherCar } from '../audio/sessionAudio';
import { LapDelta } from './lapDelta';
import { BestLapGhost, wakeStrength } from './ghost';
import { applySetup } from './carSetup';
import { PitLaneMonitor } from './pitLane';
import { defaultPlan, type ServicePlan } from './pitService';
import { PitMenu } from '../ui/pitMenu';
import { TimingScreen } from '../ui/timingScreen';
import { COMPOUNDS, compoundForWeather, compoundGrip } from '../physics/tyres';
import { RacingLineFx } from './racingLineFx';
import { TrackLimits, beyondLimitsNow } from './trackLimits';
import { CarVisual, cockpitGlass } from './carVisual';
import { CockpitCamera } from './cockpit';
import { Environment, WindshieldFx } from './environment';
import type { Graphics } from './graphics';
import { Track } from './track';
import { PerfOverlay } from './perf';
import { TrackEditor } from './trackEditor';
import { IS_DEV } from '../config';
import { t } from '../i18n';

const FIXED_DT = 1 / PHYSICS_HZ;
const STEPS_PER_SAMPLE = PHYSICS_HZ / STATE_HZ;
const MAX_FRAME_DT = 0.1;
/** How far a bot moves over to pass a slower car (m). */
const PASS_OFFSET = 3.6;
/** AI cars leave the grid one at a time, this far apart (qualifying: no rolling start). */
const BOT_RELEASE_MS = 2500;

interface Remote {
  id: string;
  slot: number;
  entry: CarEntry;
  visual: CarVisual;
  buffer: RemoteCarBuffer;
  damage: DamageState;
  lastDamageVersion: number;
  /** Last known velocity (for engine pitch and Doppler). */
  vel: THREE.Vector3;
  /** Set on the host for bots: simulated here and streamed to everyone else. */
  bot?: LocalBot;
}

interface LocalBot {
  vehicle: Vehicle;
  ai: AiDriver;
  prevPos: THREE.Vector3;
  currPos: THREE.Vector3;
  prevRot: THREE.Quaternion;
  currRot: THREE.Quaternion;
  pending: CarState[];
  pendingCount: number;
  seq: number;
  resetFlagSamples: number;
  limits: TrackLimits;
  hint: number;
  /** Seconds left before a pass manoeuvre is given up (traffic cleared). */
  passHold: number;
}

export interface SessionCallbacks {
  onCountdownText(text: string, sub: string): void;
  onPauseToggle(open: boolean): void;
  onResults(msg: Extract<ServerMsg, { t: 'results' }>): void;
  onFatal(message: string): void;
  /** The app's audio (null until the first user gesture, or when unavailable). */
  audio(): GameAudio | null;
}

let rapierReady: Promise<void> | null = null;
function initRapier(): Promise<void> {
  rapierReady ??= RAPIER.init();
  return rapierReady;
}

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _camPos = new THREE.Vector3();
const _carVel = new THREE.Vector3();
const _lis = new THREE.Vector3();
const _right = new THREE.Vector3();

/** One race: loads everything for it, runs physics/render/network until the results arrive. */
export class RaceSession {
  readonly scene = new THREE.Scene();
  private world!: RAPIER.World;
  private events!: RAPIER.EventQueue;
  private track!: Track;
  private trackData!: TrackData;
  private env!: Environment;
  private windshield = new WindshieldFx();
  private vehicle!: Vehicle;
  private myVisual!: CarVisual;
  private cockpit!: CockpitCamera;
  private remotes = new Map<number, Remote>();
  private kb: Keyboard;
  private smoother = new InputSmoother();
  private damage = new DamageState();
  private hud = new Hud();
  private perf: PerfOverlay | null = null;
  private editor: TrackEditor | null = null;
  private localTracker: RaceTracker | null = null;
  private names = new Map<string, string>();
  private standings: Standing[] = [];
  private finishDeadline: number | null = null;

  private running = false;
  private raf = 0;
  private lastFrame = 0;
  private acc = 0;
  private stepCount = 0;
  private startAt: number | null = null;
  private seq = 0;
  private sendBuf = new ArrayBuffer(CLIENT_HEADER + STATE_BYTES * 4);
  private pending: CarState[] = [makeCarState(), makeCarState()];
  private pendingCount = 0;
  private relayScratch: CarState[] = [makeCarState(), makeCarState(), makeCarState(), makeCarState()];
  private resetFlagSamples = 0;
  private freezeUntil = 0;
  private lastResetAt = -1e9;
  private wrongWayTime = 0;
  private stuckTime = 0;
  private weather!: WeatherState;
  private weatherTimer = 0;
  private headlightsOn = false;
  private lastDamageSent = 0;
  private damageVersionSent = 0;
  private paused = false;

  // my race progress (from server events)
  private myLaps = 0;
  private lapTimes: number[] = [];
  private bestLap: number | null = null;
  private bestSectors: number[] = [];
  private sectorDelta: number | null = null;
  private sectorDeltaUntil = 0;
  private finishedMs: number | null = null;
  /** All four wheels beyond the limits (held): reported to the lap logic, which adds a time penalty. */
  private limits = new TrackLimits();
  private lapDelta: LapDelta | null = null;
  private liveDelta: number | null = null;
  private trackerEvents: RaceEvent[] = [];
  private racingLine: RacingLineFx | null = null;
  private cinematic: Cinematic | null = null;
  private snd: SessionAudio | null = null;
  private pit: PitLaneMonitor | null = null;
  private pitMenu: PitMenu | null = null;
  /** Stopped in the pit box (menu open or service running): the car is held. */
  private pitHold = false;
  private service: { plan: ServicePlan; start: number; end: number } | null = null;
  private flagged = false;
  private timing = new TimingScreen();
  private ghost = new BestLapGhost();
  private ghostVisual: CarVisual | null = null;
  private ghostLoading = false;
  private wakeCars: { pos: THREE.Vector3; vel: THREE.Vector3 }[] = [];
  private otherCars: OtherCar[] = [];
  private message = '';
  private messageUntil = 0;

  // interpolation of my car between physics steps
  private prevPos = new THREE.Vector3();
  private currPos = new THREE.Vector3();
  private prevRot = new THREE.Quaternion();
  private currRot = new THREE.Quaternion();
  private offs: (() => void)[] = [];
  private loc = { s: 0, dot: 1, index: 0, lateral: 0 };
  /** Materials that get the reflection environment (cars always, track on High/Ultra). */
  private envMats: THREE.MeshStandardMaterial[] = [];

  constructor(
    private readonly gfx: Graphics,
    private readonly conn: Connection,
    public race: RaceSetup,
    private room: RoomSnapshot,
    readonly me: string,
    private readonly cars: CarsFile,
    private readonly cb: SessionCallbacks,
  ) {
    this.kb = new Keyboard(settings.bindings);
    // dev only: force the visual weather from a fixed seed (localStorage 'apexghost.devWeatherSeed') for A/B tests
    if (IS_DEV) {
      try {
        const forced = localStorage.getItem('apexghost.devWeatherSeed');
        if (forced) this.race = { ...race, weather: planWeather(Number(forced)) };
      } catch {
        /* ignore */
      }
    }
    for (const p of room.players) this.names.set(p.id, p.nick);
  }

  /* ------------------------------------------------------------ loading --- */

  async load(progress: Progress): Promise<void> {
    progress(0, 1, t('Starting physics'));
    await initRapier();
    this.trackData = await loadTrackFile(this.race.trackId);
    const entries = new Map(this.cars.cars.map((c) => [c.id, c]));
    const racers = this.race.grid.map((id) => ({ id, player: this.room.players.find((p) => p.id === id) }));
    const myCarId = this.room.players.find((p) => p.id === this.me)?.carId;
    const myEntry = myCarId ? entries.get(myCarId) : undefined;
    if (!myEntry) throw new Error(t('Your car is not available.'));

    // byte budget for the progress bar
    const remoteEntries = racers
      .filter((r) => r.id !== this.me && r.player?.carId && entries.has(r.player.carId))
      .map((r) => ({ id: r.id, entry: entries.get(r.player?.carId as string) as CarEntry }));
    const trackBytes = 22_000_000;
    const total = trackBytes + myEntry.bytes + remoteEntries.reduce((s, r) => s + r.entry.bytes, 0);
    let loaded = 0;
    const onBytes = (n: number) => {
      loaded += n;
      progress(Math.min(loaded, total), total, t('Loading track and cars'));
    };

    const [trackRes, myModel, ...remoteModels] = await Promise.all([
      Track.load(this.trackData, onBytes),
      loadCarModel(myEntry, onBytes, 1, this.gfx.quality.cockpitDetail),
      ...remoteEntries.map((r) => loadCarModel(r.entry, onBytes, 3)),
    ]);
    progress(total, total, t('Building the world'));
    this.track = trackRes.track;
    this.scene.add(this.track.root);

    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = FIXED_DT;
    this.events = new RAPIER.EventQueue(true);
    this.track.buildColliders(RAPIER, this.world, trackRes.collision);
    // ray casts only see colliders once the query structure is built: placing the cars on the ground needs it
    this.world.updateSceneQueries();

    // weather & environment
    this.weather = weatherAt(this.race.weather, 0);
    this.env = new Environment(this.scene, this.race.weather, this.gfx.quality);
    this.track.applyQuality(this.gfx.quality);

    // my car
    const slot = this.race.slots[this.me] ?? 0;
    const grid = this.trackData.grid[slot] ?? this.trackData.grid[0];
    // the setup chosen in the lobby (wing, brake balance) changes the car's specs for the physics
    const tuned = applySetup(myEntry, settings.carSetup);
    this.vehicle = new Vehicle(RAPIER, this.world, tuned, this.track.groundQuery(this.world), { ...settings.assists }, this.damage);
    this.track.excludeBody = this.vehicle.body;
    this.vehicle.drivetrain.manual = settings.manualGearbox;
    this.vehicle.place(grid.p[0], grid.p[1], grid.p[2], grid.yaw);
    this.vehicle.frozen = true;
    // no tyre warmers: the tyres leave the pits a little above air temperature
    this.vehicle.ambientC = ambientTemp(this.weather, this.race.weather.startHour);
    this.vehicle.fitTyres(COMPOUNDS[settings.carSetup.tyre] ?? COMPOUNDS[compoundForWeather(this.weather.wetness)], this.vehicle.ambientC + 12);
    this.myVisual = new CarVisual(myEntry, myModel, true);
    if (this.gfx.quality.ownHeadlightSpots) this.myVisual.addHeadlights(this.gfx.quality.ownHeadlightShadows);
    else this.myVisual.simplifyForCockpit();
    this.scene.add(this.myVisual.object);
    this.cockpit = new CockpitCamera(myEntry, this.myVisual.object, settings.fov);
    this.cockpit.autoSeat(this.myVisual.object);
    this.cockpit.camera.add(this.windshield.mesh, this.windshield.crack);
    this.snapshotPose();
    this.prevPos.copy(this.currPos);
    this.prevRot.copy(this.currRot);
    this.applyPose(1);

    // remote cars
    remoteEntries.forEach((r, i) => {
      const model = remoteModels[i];
      const visual = new CarVisual(r.entry, model, false);
      const rslot = this.race.slots[r.id];
      const g = this.trackData.grid[rslot] ?? this.trackData.grid[0];
      visual.object.position.set(g.p[0], g.p[1], g.p[2]);
      visual.object.rotation.set(0, g.yaw, 0);
      this.scene.add(visual.object);
      this.remotes.set(rslot, {
        id: r.id,
        slot: rslot,
        entry: r.entry,
        visual,
        buffer: new RemoteCarBuffer(),
        damage: new DamageState(),
        lastDamageVersion: 0,
        vel: new THREE.Vector3(),
      });
    });
    this.createLocalBots(entries);
    // ray casts only see colliders after the query structure is built (normally by the first step)
    this.world.updateSceneQueries();
    this.racingLine = new RacingLineFx(this.trackData, tuned.specs, this.track.groundQuery(this.world));
    this.racingLine.setMode(settings.racingLine);
    this.scene.add(this.racingLine.object);
    if (this.trackData.pitLane) {
      this.pit = new PitLaneMonitor(this.trackData);
      const gq = this.track.groundQuery(this.world);
      const hit = { dist: 0, px: 0, py: 0, pz: 0, nx: 0, ny: 1, nz: 0, surface: 'asphalt' as const };
      this.scene.add(this.pit.buildMarkings((x, z, y) => (gq.cast(x, y + 2.5, z, 0, -1, 0, 6, hit) ? hit.py : y)));
    }

    this.localTracker = this.makeTracker(0);

    this.buildCinematic(entries);
    this.hud.setTrack(this.trackData);
    this.hud.el.append(this.timing.el);
    this.gfx.setScene(this.scene, this.cockpit.camera);
    this.gfx.resize();
    this.env.update(0, this.weather, this.cockpit.camera, this.currPos, _carVel.set(0, 0, 0), this.gfx.renderer);
    this.env.updateEnvMap(this.gfx.renderer, this.weather.hour, true);
    this.collectEnvMaterials();
    this.applyWeather();

    progress(total, total, t('Compiling shaders'));
    await this.warmUp();
    if (IS_DEV || settings.showPerf) this.perf = new PerfOverlay();
    if (IS_DEV) this.editor = new TrackEditor(this.scene, this.trackData, trackRes.collision);

    this.offs.push(
      this.conn.on((m) => this.onMessage(m)),
      this.conn.onBinary((b) => this.onBinary(b)),
    );
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  private buildCinematic(entries: Map<string, CarEntry>): void {
    const entrants: Entrant[] = [];
    for (const id of this.race.grid) {
      const p = this.room.players.find((x) => x.id === id);
      const e = p?.carId ? entries.get(p.carId) : undefined;
      if (!p || !e) continue;
      entrants.push({ slot: this.race.slots[id] ?? 0, nick: p.nick, carName: e.name, color: e.color, me: id === this.me, bot: !!p.bot });
    }
    const w0 = this.weather;
    const hh = Math.floor(w0.hour);
    const mm = Math.floor((w0.hour - hh) * 60);
    this.cinematic = new Cinematic(this.trackData, entrants, {
      trackName: this.trackData.name,
      facts: [
        `${(this.trackData.length / 1000).toFixed(3)} km`,
        ...(this.trackData.turns ? [t('{n} turns', { n: this.trackData.turns })] : []),
        `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`,
        t(WEATHER_LABEL[this.race.weather.kind]),
        w0.wetness > 0.3 ? t('Wet track') : w0.wetness > 0.05 ? t('Damp track') : t('Dry track'),
        t('{n} drivers', { n: entrants.length }),
      ],
      format: t('{min}-minute qualifying · best valid lap wins · pit lane open', { min: Math.round(this.race.sessionMs / 60000) }),
    });
  }

  get cinematicElement(): HTMLElement | null {
    return this.cinematic?.el ?? null;
  }

  private onKeySkip = (e: KeyboardEvent): void => {
    if ((e.code === 'Enter' || e.code === 'Space' || e.code === 'Escape') && this.cinematic?.active) {
      e.preventDefault();
      e.stopImmediatePropagation();
      this.cinematic.skip();
    }
  };

  /** The host simulates every bot: a Vehicle + AiDriver in this physics world (bots never collide with cars). */
  private createLocalBots(entries: Map<string, CarEntry>): void {
    if (!this.room.players.find((p) => p.id === this.me)?.host) return;
    for (const r of this.remotes.values()) {
      const p = this.room.players.find((x) => x.id === r.id);
      if (!p?.bot || !p.carId) continue;
      const entry = entries.get(p.carId);
      if (!entry) continue;
      const g = this.trackData.grid[r.slot] ?? this.trackData.grid[0];
      const vehicle = new Vehicle(RAPIER, this.world, entry, this.track.groundQuery(this.world), { ...BOT_ASSISTS }, r.damage);
      vehicle.place(g.p[0], g.p[1], g.p[2], g.yaw);
      vehicle.frozen = true;
      vehicle.ambientC = this.vehicle.ambientC;
      vehicle.fitTyres(COMPOUNDS[compoundForWeather(this.weather.wetness)], vehicle.ambientC + 12);
      // skill and racing line differ per bot so they spread out (deterministic per slot)
      const skill = 0.88 + ((r.slot * 37) % 10) / 100;
      const lane = (((r.slot * 7) % 5) - 2) * 0.45;
      const t = vehicle.body.translation();
      const q = vehicle.body.rotation();
      const pos = new THREE.Vector3(t.x, t.y, t.z);
      const rot = new THREE.Quaternion(q.x, q.y, q.z, q.w);
      r.bot = {
        vehicle,
        ai: new AiDriver(this.trackData, vehicle, skill, lane),
        prevPos: pos.clone(),
        currPos: pos,
        prevRot: rot.clone(),
        currRot: rot,
        pending: [makeCarState(), makeCarState()],
        pendingCount: 0,
        seq: 0,
        resetFlagSamples: 0,
        limits: new TrackLimits(),
        hint: -1,
        passHold: 0,
      };
    }
  }

  /** Compile every shader and upload every texture now, so nothing hitches during the race. */
  private async warmUp(): Promise<void> {
    const r = this.gfx.renderer;
    const restore: { o: THREE.Object3D; v: boolean; f: boolean }[] = [];
    this.track.showAll();
    this.scene.traverse((o) => {
      restore.push({ o, v: o.visible, f: o.frustumCulled });
      o.visible = true;
      o.frustumCulled = false;
      if (o instanceof THREE.LOD) for (const l of o.levels) l.object.visible = true;
    });
    this.windshield.mesh.visible = true;
    this.windshield.crack.visible = true;
    for (const rm of this.remotes.values()) rm.visual.updateSmoke(0.5, 1, this.scene);
    this.myVisual.updateSmoke(0.5, 1, this.scene);
    const textures = new Set<THREE.Texture>();
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      if (!m) return;
      for (const mat of Array.isArray(m) ? m : [m]) {
        for (const v of Object.values(mat)) if (v instanceof THREE.Texture) textures.add(v);
      }
    });
    // anisotropic filtering keeps grazing surfaces (road ahead, hood from the cockpit) on sharp mips;
    // without it small atlas islands bleed their padding colour
    const aniso = Math.min(this.gfx.quality.anisotropy, r.capabilities.getMaxAnisotropy());
    for (const t of textures) {
      if (t.anisotropy !== aniso) {
        t.anisotropy = aniso;
        t.needsUpdate = true;
      }
      r.initTexture(t);
    }
    await r.compileAsync(this.scene, this.cockpit.camera);
    this.gfx.render();
    for (const { o, v, f } of restore) {
      o.visible = v;
      o.frustumCulled = f;
    }
    this.myVisual.updateSmoke(0, 0, this.scene);
    for (const rm of this.remotes.values()) rm.visual.updateSmoke(0, 0, this.scene);
    this.windshield.mesh.visible = false;
    this.windshield.crack.visible = false;
  }

  /* ------------------------------------------------------------ control --- */

  start(): void {
    this.conn.sendJson({ t: 'loaded', raceId: this.race.raceId });
    this.running = true;
    this.lastFrame = performance.now();
    if (this.cinematic) {
      this.gfx.setCamera(this.cinematic.camera);
      this.hud.el.style.visibility = 'hidden';
      window.addEventListener('keydown', this.onKeySkip, true);
    }
    this.raf = requestAnimationFrame(this.frame);
  }

  setStartAt(t: number): void {
    this.startAt = t;
    if (this.localTracker) this.localTracker = this.makeTracker(t);
  }

  updateRoom(room: RoomSnapshot): void {
    this.room = room;
    for (const p of room.players) this.names.set(p.id, p.nick);
    // hide cars of players who left the room
    for (const r of this.remotes.values()) if (!room.players.some((p) => p.id === r.id)) r.visual.object.visible = false;
  }

  /** Local mirror of the server's gate logic: my car, plus the bots when I simulate them. */
  private makeTracker(startMs: number): RaceTracker {
    const tr = new RaceTracker(this.trackData, startMs, { sessionMs: this.race.sessionMs });
    tr.addPlayer(this.me);
    for (const r of this.remotes.values()) if (r.bot) tr.addPlayer(r.id);
    return tr;
  }

  togglePause(open?: boolean): void {
    this.paused = open ?? !this.paused;
    this.cb.onPauseToggle(this.paused);
  }

  applySettings(): void {
    this.kb.setBindings(settings.bindings);
    this.vehicle.assists = { ...settings.assists };
    this.vehicle.drivetrain.manual = settings.manualGearbox;
    this.cockpit.setFov(settings.fov);
    this.cockpit.applySeat();
    this.racingLine?.setMode(settings.racingLine);
    this.gfx.quality = QUALITY[settings.quality];
    this.gfx.applyQuality();
    this.env.setQuality(this.gfx.quality);
    this.track.applyQuality(this.gfx.quality);
    if (!this.gfx.quality.envOnTrack) for (const m of this.track.materials()) m.envMap = null;
    this.collectEnvMaterials();
    this.applyEnv();
    if (settings.showPerf && !this.perf) this.perf = new PerfOverlay();
    if (!settings.showPerf && this.perf && !IS_DEV) {
      this.perf.dispose();
      this.perf = null;
    }
  }

  get hudElement(): HTMLElement {
    return this.hud.el;
  }

  /** Reset to the last checkpoint (pause menu or R). */
  requestReset(): void {
    const now = this.conn.serverNow();
    if (this.pit?.inLane) {
      this.flash(t('In the pit lane: stop in the service box or drive to the pit exit'));
      return;
    }
    if (!this.startAt || now < this.startAt) return;
    if (now - this.lastResetAt < 4000) {
      this.flash(t('Reset available again in a moment'));
      return;
    }
    const tr = this.localTracker?.players.get(this.me);
    const gates = this.trackData.gates;
    const n = gates.length;
    let x: number;
    let y: number;
    let z: number;
    let yaw: number;
    if (tr && tr.passed >= 0) {
      const g = gates[(tr.nextGate - 1 + n) % n];
      // a little before the gate, on the centreline
      const pt = { x: 0, y: 0, z: 0, yaw: 0 };
      this.track.pointAt(g.s + 2, pt);
      x = pt.x;
      y = pt.y;
      z = pt.z;
      yaw = pt.yaw;
    } else {
      const slot = this.race.slots[this.me] ?? 0;
      const gs = this.trackData.grid[slot];
      [x, y, z] = gs.p;
      yaw = gs.yaw;
    }
    this.vehicle.place(x, y + 0.3, z, yaw);
    this.smoother.reset();
    this.snapshotPose();
    this.prevPos.copy(this.currPos);
    this.prevRot.copy(this.currRot);
    this.lastResetAt = now;
    this.freezeUntil = now + RESET_FREEZE_MS;
    this.vehicle.frozen = true;
    this.resetFlagSamples = 2; // make sure at least one packet carries the reset flag
    this.track.resetHint();
    this.limits.reset();
    // the time penalty (if any) is announced by the lap logic's penalty event
    if (this.myLaps === 0) this.flash(t('Reset to the track'));
  }

  private flash(msg: string, ms = 2500): void {
    this.message = msg;
    this.messageUntil = performance.now() + ms;
  }

  /* ----------------------------------------------------------- networking --- */

  private onMessage(m: ServerMsg): void {
    switch (m.t) {
      case 'countdown':
        if (m.raceId === this.race.raceId) this.setStartAt(m.startAt);
        break;
      case 'standings':
        if (m.raceId !== this.race.raceId) break;
        this.standings = m.list;
        this.finishDeadline = m.finishDeadline;
        this.hud.setBoard(m.list, this.me, this.names);
        this.updateTiming();
        break;
      case 'lap':
        if (m.playerId === this.me) {
          this.myLaps = m.lap;
          if (m.outLap) {
            this.flash(t('Out lap {time} (not timed) · timed lap starts now · Tab: timing', { time: fmtLap(m.lapMs) }), 4000);
            break;
          }
          this.lapTimes.push(m.lapMs);
          if (m.best) {
            this.bestLap = m.lapMs;
            this.bestSectors = m.sectors.slice();
          }
          const sessionBest = this.standings.every((s) => s.id === this.me || s.bestLapMs === null || s.bestLapMs > m.lapMs);
          const tag = !m.valid ? t('  ·  INVALID') : m.best ? (sessionBest ? t('  ·  FASTEST LAP') : t('  ·  personal best')) : '';
          const pen = m.penaltyMs > 0 ? t('  ·  incl. +{s} s penalties', { s: (m.penaltyMs / 1000).toFixed(1) }) : '';
          this.flash(t('Lap {n}: {time}', { n: m.lap - 1, time: fmtLap(m.lapMs) }) + tag + pen, 3500);
          if (m.valid) this.snd?.chime(m.best ? (sessionBest ? 'session-best' : 'best') : 'lap');
        }
        break;
      case 'penalty':
        // announced at once by the local mirror of the lap logic (updateLapDelta); the server's copy is authoritative
        // for the standings, which carry each driver's lap penalty
        break;
      case 'flag':
        if (m.raceId !== this.race.raceId) break;
        this.flagged = true;
        this.flash(this.pit?.inLane ? t('CHEQUERED FLAG: session over') : t('CHEQUERED FLAG: finish your lap, it still counts'), 5000);
        this.snd?.chime('lap');
        break;
      case 'sector':
        if (m.playerId === this.me && this.bestSectors.length > m.sector) {
          let mine = 0;
          let ref = 0;
          for (let i = 0; i <= m.sector; i++) ref += this.bestSectors[i];
          // current lap sector sum = time since lap start
          mine = this.conn.serverNow() - this.lapStartMs();
          this.sectorDelta = mine - ref;
          this.sectorDeltaUntil = performance.now() + 4000;
        }
        break;
      case 'finished':
        if (m.playerId === this.me) {
          this.finishedMs = m.totalMs;
          const pos = this.standings.findIndex((s) => s.id === this.me) + 1;
          this.flash(`${t('SESSION COMPLETE')}${pos ? ` · P${pos}` : ''}`, 8000);
        } else {
          this.flash(t('{name} has completed the session', { name: this.names.get(m.playerId) ?? t('A driver') }), 3000);
        }
        break;
      case 'damage': {
        for (const r of this.remotes.values()) {
          if (r.id !== m.playerId) continue;
          const before = Float32Array.from(r.damage.zones);
          r.damage.setAll(m.zones);
          // visual dents where a zone increased
          for (let z = 0; z < 4; z++) {
            const inc = r.damage.zones[z] - before[z];
            if (inc > 0.02) r.visual.dent(zonePoint(z, r.entry, _v1), zoneDir(z, _v2), inc * 2);
          }
        }
        break;
      }
      case 'results':
        if (m.raceId === this.race.raceId) this.cb.onResults(m);
        break;
      case 'room':
        this.updateRoom(m.room);
        break;
      case 'error':
        if (m.fatal) this.cb.onFatal(m.message);
        break;
      default:
        break;
    }
  }

  private onBinary(buf: ArrayBuffer): void {
    const dec = decodeRelay(buf, this.relayScratch, this.conn.serverNow());
    if (!dec) return;
    const r = this.remotes.get(dec.slot);
    if (!r) return;
    for (let i = 0; i < dec.count; i++) r.buffer.push(this.relayScratch[i], (dec.seq * STATES_PER_PACKET + i) & 0xffff);
  }

  private onVisibility = (): void => {
    if (document.visibilityState === 'visible') {
      this.conn.resync();
      this.lastFrame = performance.now();
      this.acc = 0;
      for (const r of this.remotes.values()) r.buffer.reset();
    }
  };

  /** Start of my current lap (server clock), from the local mirror of the lap logic. */
  private lapStartMs(): number {
    return this.localTracker?.players.get(this.me)?.lapStartMs ?? this.startAt ?? 0;
  }

  /* --------------------------------------------------------------- frame --- */

  private frame = (now: number): void => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.frame);
    let dt = (now - this.lastFrame) / 1000;
    this.lastFrame = now;
    this.perf?.begin();
    this.gfx.trackFrame(dt * 1000, now);
    if (dt > MAX_FRAME_DT) dt = MAX_FRAME_DT; // tab hiccup: never spiral
    const serverNow = this.conn.serverNow();
    const raceT = this.startAt !== null ? serverNow - this.startAt : -Infinity;

    this.handleKeys(serverNow);

    // countdown & start lights
    if (this.startAt === null || raceT < 0) {
      this.vehicle.frozen = true;
      const left = this.startAt === null ? null : -raceT;
      this.updateCountdown(left);
    } else if (serverNow >= this.freezeUntil && this.vehicle.frozen && raceT >= 0 && !this.pitHold) {
      this.vehicle.frozen = false;
      this.updateCountdown(-1);
      if (this.myLaps === 0 && raceT < 2000)
        this.flash(
          t('Qualifying: {min} minutes to set your best lap (clock at the top). Out lap first: warm the tyres, timing starts at the line.', {
            min: Math.round(this.race.sessionMs / 60000),
          }),
          7000,
        );
    } else if (raceT < 1500) this.updateCountdown(-1);
    else this.clearCountdown();

    // weather (deterministic from seed + race clock)
    this.weatherTimer -= dt;
    if (this.weatherTimer <= 0) {
      this.weatherTimer = 0.25;
      this.weather = weatherAt(this.race.weather, Math.max(0, raceT / 1000));
      this.applyWeather();
    }

    // fixed-step physics
    this.acc += dt;
    const controls = this.smoother.update(dt, this.kb, this.vehicle.telemetry.forwardSpeed, this.vehicle.reverse);
    if (this.paused) {
      controls.throttle = 0;
      controls.steer = 0;
    }
    const tPhys = performance.now();
    while (this.acc >= FIXED_DT) {
      this.acc -= FIXED_DT;
      this.prevPos.copy(this.currPos);
      this.prevRot.copy(this.currRot);
      this.vehicle.step(FIXED_DT, controls);
      this.stepBots(raceT);
      this.world.step(this.events);
      this.drainContacts();
      this.snapshotPose();
      this.snapshotBots();
      this.stepCount++;
      // stamp each sample with the time of its own physics step, not the frame time
      if (this.stepCount % STEPS_PER_SAMPLE === 0) {
        const t = serverNow - this.acc * 1000;
        this.sampleState(t);
        this.sampleBots(t);
      }
    }
    const alpha = this.acc / FIXED_DT;
    this.applyPose(alpha);
    const tPhysEnd = performance.now();

    // visuals of my car
    const v = this.vehicle;
    const susp = SUSP;
    for (let i = 0; i < 4; i++) susp[i] = v.wheels[i].contact ? -(v.wheels[i].springLen - (v.wheels[i].restLen - v.wheels[i].fz0 / v.wheels[i].k)) : -0.05;
    this.myVisual.setPose(v.steerAngle, v.wheels[0].angle, v.wheels[2].angle, susp);
    const braking = v.pedals.brake > 0.1 && !v.reverse;
    this.myVisual.setLights(braking, this.headlightsOn, this.env.night);
    this.myVisual.updateSmoke(dt, this.damage.zones[4], this.scene);

    // camera
    const lin = v.body.linvel();
    _carVel.set(lin.x, lin.y, lin.z);
    const yawRate = v.body.angvel().y;
    this.cockpit.update(
      dt,
      v.telemetry,
      v.steerAngle,
      { left: this.kb.held('lookLeft'), right: this.kb.held('lookRight'), back: this.kb.held('lookBack') },
      yawRate,
    );
    this.cockpit.worldPosition(_camPos);
    // pre-race cinematic owns the camera until shortly before the start lights
    let viewCam: THREE.Camera = this.cockpit.camera;
    const cine = this.cinematic;
    if (cine) {
      if (cine.update(dt, this.startAt === null ? null : this.startAt - serverNow)) {
        viewCam = cine.camera;
        _camPos.copy(cine.camera.position);
        this.env.fogScale = 0.45;
        this.env.hideRain = cine.aerial;
      } else {
        this.cinematic = null;
        this.env.fogScale = 1;
        this.env.hideRain = false;
        this.gfx.setCamera(this.cockpit.camera);
        this.hud.el.style.visibility = '';
        window.removeEventListener('keydown', this.onKeySkip, true);
      }
    }
    cockpitGlass.value = viewCam === this.cockpit.camera ? 1 : 0;

    // remote ghosts
    for (const r of this.remotes.values()) this.updateRemote(r, serverNow, dt);

    // environment
    const tEnv = performance.now();
    this.env.update(dt, this.weather, viewCam, this.currPos, _carVel, this.gfx.renderer);
    // aerial shots see the whole circuit: distance culling (meant for the cockpit) would leave holes
    if (this.cinematic?.aerial) this.track.showAll();
    else this.track.updateVisibility(_camPos, this.gfx.quality);
    this.windshield.update(
      dt,
      this.weather.rain,
      v.telemetry.speed,
      window.innerWidth / window.innerHeight,
      1 - this.env.night * 0.8,
      this.cockpit.lookingForward,
    );
    this.windshield.setCrack(this.damage.zones[0], this.cockpit.lookingForward);
    this.updateAudio(dt, viewCam);
    this.updateWake();
    this.updateGhost(serverNow);

    this.updateRaceUi(serverNow, raceT, dt);
    this.updatePit(serverNow);
    this.editor?.update(this.kb);
    this.kb.endFrame();
    const tRender = performance.now();
    this.gfx.render();
    const tEnd = performance.now();
    if (IS_DEV) {
      const w = window as unknown as { __timings?: Record<string, number>; __apex?: unknown };
      w.__timings = { physics: tPhysEnd - tPhys, env: tRender - tEnv, other: tEnv - tPhysEnd, render: tEnd - tRender };
      w.__apex = { session: this, gfx: this.gfx, scene: this.scene, THREE };
    }
    this.perf?.end(this.gfx.renderer, this.conn, this.remotes.values());
  };

  private updateTiming(): void {
    if (!this.timing.visible) return;
    this.timing.update(this.standings, this.me, (id) => {
      const p = this.room.players.find((x) => x.id === id);
      const car = this.cars.cars.find((c) => c.id === p?.carId);
      return { nick: this.names.get(id) ?? '?', car: car?.name ?? '', colour: car?.color ?? '#888', bot: !!p?.bot };
    });
  }

  private handleKeys(serverNow: number): void {
    const kb = this.kb;
    const showTiming = kb.held('timing');
    if (showTiming !== this.timing.visible) {
      this.timing.visible = showTiming;
      if (showTiming) this.updateTiming();
    }
    if (kb.tapped('pause')) this.togglePause();
    if (this.paused) return;
    if (kb.tapped('shiftUp')) this.vehicle.shift(1);
    if (kb.tapped('shiftDown')) this.vehicle.shift(-1);
    if (kb.tapped('toggleGearbox')) {
      settings.manualGearbox = !settings.manualGearbox;
      this.vehicle.drivetrain.manual = settings.manualGearbox;
      this.flash(settings.manualGearbox ? t('Manual gearbox') : t('Automatic gearbox'), 1500);
    }
    if (kb.tapped('resetCar')) this.requestReset();
    if (this.freezeUntil > 0 && serverNow >= this.freezeUntil && this.startAt !== null && serverNow >= this.startAt && !this.pitHold) {
      this.vehicle.frozen = false;
      this.freezeUntil = 0;
    }
  }

  private countdownShown = '';
  private updateCountdown(msLeft: number | null): void {
    let text = '';
    let sub = '';
    if (msLeft === null) {
      // during the cinematic a quiet line is enough
      text = this.cinematic ? '' : t('Waiting for drivers');
      sub = t('Everyone is loading the race…');
      this.track.setStartLights(false, false);
    } else if (msLeft > 3000) {
      text = '';
      sub = '';
      this.track.setStartLights(false, false);
    } else if (msLeft > 0) {
      text = String(Math.ceil(msLeft / 1000));
      this.track.setStartLights(true, false);
    } else {
      text = 'GO';
      this.track.setStartLights(false, true);
    }
    const key = `${text}|${sub}`;
    if (key !== this.countdownShown) {
      this.countdownShown = key;
      this.cb.onCountdownText(text, sub);
      if (text === '3' || text === '2' || text === '1') this.snd?.beep(false);
      else if (text === 'GO') this.snd?.beep(true);
    }
  }

  private collectEnvMaterials(): void {
    const set = new Set<THREE.MeshStandardMaterial>();
    const add = (root: THREE.Object3D) =>
      root.traverse((o) => {
        const m = (o as THREE.Mesh).material;
        if (!m) return;
        for (const x of Array.isArray(m) ? m : [m])
          if ((x as THREE.MeshStandardMaterial).isMeshStandardMaterial && !x.userData.noEnv) set.add(x as THREE.MeshStandardMaterial);
      });
    add(this.myVisual.object);
    for (const r of this.remotes.values()) add(r.visual.object);
    if (this.gfx.quality.envOnTrack) for (const m of this.track.materials()) set.add(m);
    this.envMats = [...set];
    for (const m of this.envMats) m.userData.envBase ??= m.envMapIntensity * ((m.userData.envBoost as number | undefined) ?? 1);
  }

  /** Assign the current reflection environment (texture swap only: same shader program). */
  private applyEnv(): void {
    const tex = this.env.envMap;
    const k = this.env.envIntensity;
    for (const m of this.envMats) {
      m.envMap = tex;
      m.envMapIntensity = (m.userData.envBase as number) * k;
    }
  }

  private clearCountdown(): void {
    if (this.countdownShown === '|') return;
    this.countdownShown = '|';
    this.cb.onCountdownText('', '');
  }

  private applyWeather(): void {
    const w = this.weather;
    // grip of the fitted compound for the water on the track (slicks aquaplane, wets bite)
    this.vehicle.weatherGrip = compoundGrip(this.vehicle.compound, w.wetness, w.rain);
    this.vehicle.wetness = w.wetness;
    this.vehicle.ambientC = ambientTemp(w, w.hour);
    for (const r of this.remotes.values()) {
      if (!r.bot) continue;
      const bv = r.bot.vehicle;
      bv.weatherGrip = compoundGrip(bv.compound, w.wetness, w.rain);
      bv.wetness = w.wetness;
      bv.ambientC = this.vehicle.ambientC;
    }
    this.track.setNight(this.env.night);
    this.headlightsOn = this.env.night > 0.3 || w.fog > 0.45 || w.rain > 0.4 || (this.env.sunElevation < 0.08 && w.clouds > 0.6);
    this.vehicle.drivetrain.powerScale = this.damage.powerScale;
    this.env.updateEnvMap(this.gfx.renderer, w.hour);
    this.applyEnv();
    this.track.applyWetness(w.wetness, this.env.envIntensity);
  }

  /**
   * AI cars, simulated on the host. As in a real qualifying session they leave one at a time (BOT_RELEASE_MS
   * apart, in grid order) instead of all launching side by side onto the same line, and they keep their distance
   * behind a car directly ahead (cars pass through each other here, so without this they drove through it).
   */
  private stepBots(raceT: number): void {
    const bots = [...this.remotes.values()].filter((r) => r.bot).sort((a, b) => a.slot - b.slot);
    bots.forEach((r, order) => {
      const b = r.bot;
      if (!b) return;
      const started = raceT >= order * BOT_RELEASE_MS;
      b.vehicle.frozen = !started;
      const tr = this.localTracker?.players.get(r.id);
      const gates = this.trackData.gates;
      const cp = tr && tr.passed >= 0 ? gates[(tr.nextGate - 1 + gates.length) % gates.length].s : undefined;
      const c = b.ai.update(FIXED_DT, started, b.vehicle.weatherGrip * b.vehicle.tyreGripAvg, cp, started ? this.followCap(r) : Infinity);
      b.vehicle.step(FIXED_DT, c);
    });
  }

  /**
   * Traffic for a bot: a slower car ahead in its lane (a car still in its grid box, a player taking it easy, a car
   * that spun) makes it pull out and pass, keeping to that side until the car is behind it; it only lifts when it
   * is about to run into one before it has moved over. Returns the speed cap (cars are ghosts: before this the
   * bots queued 12 m behind a car parked on the grid, then reset themselves, or drove through it).
   */
  private followCap(r: Remote): number {
    const b = r.bot;
    if (!b) return Infinity;
    const v = b.vehicle;
    const p = v.body.translation();
    const q = v.body.rotation();
    const fx = 2 * (q.x * q.z + q.y * q.w);
    const fz = 1 - 2 * (q.x * q.x + q.y * q.y);
    const mySpeed = v.telemetry.speed;
    let cap = Infinity;
    let block: { along: number; lat: number } | null = null;
    let beside = false;
    const check = (ox: number, oz: number, speed: number) => {
      const dx = ox - p.x;
      const dz = oz - p.z;
      const along = dx * fx + dz * fz;
      const lat = dx * fz - dz * fx; // + = left of the bot
      // alongside on the side we moved to: hold that side until it is behind us
      if (along > -6 && along <= 3 && Math.abs(lat) < 3.4) beside = true;
      if (along <= 0 || along > 40 || Math.abs(lat) > 2.6) return;
      // in our path (narrower once we are pulling out): keep about 10 m, back off if closer
      if (Math.abs(lat) < (b.ai.passTarget !== 0 ? 1.6 : 2.2)) cap = Math.min(cap, Math.max(0, speed + (along - 10) * 0.7));
      if (along <= 3 || (speed > mySpeed - 1.5 && along > 14)) return; // as fast as us and not close: just follow
      if (!block || along < block.along) block = { along, lat };
    };
    for (const o of this.remotes.values()) {
      if (o === r) continue;
      const op = o.bot ? o.bot.vehicle.body.translation() : o.visual.object.position;
      check(op.x, op.z, o.vel.length());
    }
    const me = this.vehicle.body.translation();
    check(me.x, me.z, this.vehicle.telemetry.speed);
    const found = block as { along: number; lat: number } | null;
    if (found && (b.ai.passTarget !== 0 || b.ai.canPass())) {
      // pass on the side away from it (it is left of us → go right), else keep the side already chosen
      if (b.ai.passTarget === 0) b.ai.passTarget = found.lat > 0.3 ? -PASS_OFFSET : found.lat < -0.3 ? PASS_OFFSET : b.ai.roomySide() * PASS_OFFSET;
      b.passHold = 1;
    } else if (beside && b.ai.passTarget !== 0) b.passHold = 1;
    else if ((b.passHold -= FIXED_DT) <= 0) b.ai.passTarget = 0;
    return cap;
  }

  private snapshotBots(): void {
    for (const r of this.remotes.values()) {
      const b = r.bot;
      if (!b) continue;
      const t = b.vehicle.body.translation();
      const q = b.vehicle.body.rotation();
      b.prevPos.copy(b.currPos);
      b.prevRot.copy(b.currRot);
      b.currPos.set(t.x, t.y, t.z);
      b.currRot.set(q.x, q.y, q.z, q.w);
    }
  }

  private sampleBots(serverNow: number): void {
    for (const r of this.remotes.values()) {
      const b = r.bot;
      if (!b) continue;
      const s = b.pending[b.pendingCount];
      let f = fillState(s, b.vehicle, serverNow, this.headlightsOn);
      if (b.resetFlagSamples > 0) {
        f |= FLAG_RESET;
        b.resetFlagSamples--;
      }
      // track limits, judged here like a player's (the server only sees the flag)
      b.hint = nearestCenterlineIndex(this.trackData, s.px, s.py, s.pz, b.hint, 30);
      const lat = lateralAt(this.trackData, b.hint, s.px, s.pz);
      const wasOff = b.limits.offTrack;
      if (b.limits.update(1 / STATE_HZ, beyondLimitsNow(b.vehicle, this.trackData, b.hint, lat))) f |= FLAG_OFF_TRACK;
      if (import.meta.env.DEV && b.limits.offTrack && !wasOff) {
        const edge = lat >= 0 ? this.trackData.widthL[b.hint] : this.trackData.widthR[b.hint];
        const surf = b.vehicle.wheels.map((w) => (w.contact ? w.surface : '-')).join(',');
        console.debug(
          `[limits] ${this.names.get(r.id)} at ${this.trackData.cumS[b.hint].toFixed(0)} m (index ${b.hint}) lateral ${lat.toFixed(1)} edge ${edge.toFixed(1)} wheels ${surf}`,
        );
      }
      s.flags = f;
      this.localTracker?.ingest(r.id, s.t, s.px, s.py, s.pz, (f & FLAG_RESET) !== 0, undefined, (f & FLAG_OFF_TRACK) !== 0);
      if (++b.pendingCount >= STATES_PER_PACKET) {
        const len = encodeBotStates(this.sendBuf, r.slot, b.seq++, b.pending, b.pendingCount);
        this.conn.sendBinary(this.sendBuf, len);
        b.pendingCount = 0;
      }
    }
  }

  /** Store the body pose after a physics step (for render interpolation). */
  private snapshotPose(): void {
    const t = this.vehicle.body.translation();
    const r = this.vehicle.body.rotation();
    this.currPos.set(t.x, t.y, t.z);
    this.currRot.set(r.x, r.y, r.z, r.w);
  }

  private applyPose(alpha: number): void {
    const o = this.myVisual.object;
    o.position.lerpVectors(this.prevPos, this.currPos, alpha);
    o.quaternion.slerpQuaternions(this.prevRot, this.currRot, alpha);
    o.updateMatrixWorld();
  }

  /** Contact force events → damage on my car. */
  private drainContacts(): void {
    const myHandle = this.vehicle.collider.handle;
    this.events.drainContactForceEvents((e) => {
      if (e.collider1() !== myHandle && e.collider2() !== myHandle) return;
      // only walls and barriers damage the car; touching the road or grass never does
      const other = e.collider1() === myHandle ? e.collider2() : e.collider1();
      if (this.track.surfaceOf(other) !== 'wall') return;
      const impulse = e.totalForceMagnitude() * FIXED_DT;
      const dir = e.maxForceDirection();
      // force on us points away from the obstacle: the hit came from the opposite side
      const sign = e.collider1() === myHandle ? -1 : 1;
      _v1.set(dir.x * sign, dir.y * sign, dir.z * sign);
      _q1.copy(this.currRot).invert();
      _v1.applyQuaternion(_q1);
      const res = this.damage.impact(impulse, -_v1.x, -_v1.z, this.vehicle.mass);
      if (res) {
        this.snd?.impact(Math.min(1, impulse / (this.vehicle.mass * 7)));
        const local = _v2.set(-_v1.x, 0, -_v1.z).normalize();
        const p = boxPoint(local, this.vehicle.car, _v1);
        this.myVisual.dent(p, local.clone().negate(), res.amount * 2);
        this.vehicle.drivetrain.powerScale = this.damage.powerScale;
      }
    });
  }

  private sampleState(serverNow: number): void {
    const v = this.vehicle;
    const s = this.pending[this.pendingCount];
    let f = fillState(s, v, serverNow, this.headlightsOn);
    if (this.damage.zones[4] > 0.55) f |= FLAG_SMOKE;
    if (this.resetFlagSamples > 0) {
      f |= FLAG_RESET;
      this.resetFlagSamples--;
    }
    // track limits: all four wheels off, or well past the edge line
    _v1.set(0, 0, 1).applyQuaternion(this.currRot);
    this.track.locate(s.px, s.py, s.pz, _v1.x, _v1.z, this.loc);
    if (this.limits.update(1 / STATE_HZ, beyondLimitsNow(v, this.trackData, this.loc.index, this.loc.lateral))) f |= FLAG_OFF_TRACK;
    s.flags = f;
    // mirror the server's gate logic locally (resets, the live delta and instant track-limit warnings)
    const ev = this.trackerEvents;
    ev.length = 0;
    this.localTracker?.ingest(this.me, s.t, s.px, s.py, s.pz, (f & FLAG_RESET) !== 0, ev, (f & FLAG_OFF_TRACK) !== 0);
    this.updateLapDelta(s.t, ev);
    this.pendingCount++;
    if (this.pendingCount >= STATES_PER_PACKET) {
      const len = encodeClientStates(this.sendBuf, this.seq++, this.pending, this.pendingCount);
      this.conn.sendBinary(this.sendBuf, len);
      this.pendingCount = 0;
    }
    // low-frequency visual damage sync
    if (this.damage.version !== this.damageVersionSent && serverNow - this.lastDamageSent > 1000) {
      this.damageVersionSent = this.damage.version;
      this.lastDamageSent = serverNow;
      this.conn.sendJson({ t: 'damage', zones: Array.from(this.damage.zones, (z) => Math.round(z * 100) / 100) });
    }
  }

  /** Live delta to my best valid lap, driven by the local mirror of the lap logic (no network delay). */
  private updateLapDelta(nowMs: number, ev: RaceEvent[]): void {
    const tr = this.localTracker?.players.get(this.me);
    if (!tr) return;
    this.lapDelta ??= new LapDelta(this.trackData.length);
    const d = this.lapDelta;
    for (const e of ev) {
      if (e.type === 'lap') {
        if (e.valid && e.best) d.commitBest();
        this.ghost.lapEnded(e.valid && e.best);
        if (e.valid && e.best) this.ensureGhostVisual();
        d.start();
      } else if (e.type === 'penalty' && e.playerId === this.me && e.ms === 0) {
        // a warning, or off without gaining anything
        this.flash(
          e.warning ? t('Track limits: warning {n} of {max}', { n: e.warning, max: PENALTY.limitsWarnings }) : t('Off track: no advantage, no penalty'),
          2200,
        );
        if (e.warning) this.snd?.chime('invalid');
      } else if (e.type === 'penalty' && e.playerId === this.me) {
        const s = (e.ms / 1000).toFixed(1);
        this.flash(
          e.reason === 'track-limits'
            ? t('Track limits: +{s} s', { s })
            : e.reason === 'reset'
              ? t('Reset: +{s} s penalty', { s })
              : t('Shortcut: +{s} s penalty', { s }),
          2500,
        );
        this.snd?.chime('invalid');
      }
    }
    if (tr.passed < 0 || tr.laps === 0) {
      this.liveDelta = null;
      return;
    }
    const lapDist = tr.raceDist - tr.laps * this.trackData.length;
    const lapMs = nowMs - tr.lapStartMs;
    if (!tr.outLap && !tr.inPit) this.ghost.record(lapMs, this.currPos, this.currRot);
    else this.ghost.abortLap();
    d.record(lapDist, lapMs);
    this.liveDelta = d.delta(lapDist, lapMs);
  }

  private updateRemote(r: Remote, serverNow: number, dt: number): void {
    if (r.bot) {
      this.updateLocalBot(r, r.bot, dt);
      return;
    }
    const s = r.buffer.sample(serverNow, dt);
    if (!s) return;
    const o = r.visual.object;
    o.position.set(s.px, s.py, s.pz);
    r.vel.set(s.vx, s.vy, s.vz);
    o.quaternion.set(s.qx, s.qy, s.qz, s.qw);
    for (let i = 0; i < 4; i++) SUSP[i] = s.susp[i] - 0.02;
    r.visual.setPose(s.steer, s.rotF, s.rotR, SUSP);
    r.visual.setLights((s.flags & FLAG_BRAKE) !== 0, (s.flags & FLAG_HEADLIGHTS) !== 0, this.env.night);
    r.visual.updateSmoke(dt, (s.flags & FLAG_SMOKE) !== 0 ? Math.max(0.6, r.damage.zones[4]) : 0, this.scene);
    // ghost: fade out when very close to the camera so it never blocks the cockpit view
    const d = o.position.distanceTo(_camPos);
    const fade = this.cinematic ? 1 : THREE.MathUtils.clamp((d - 2.5) / 6, 0.15, 1);
    r.visual.setOpacity(s.staleMs > 5000 ? 0.35 : fade);
    o.updateMatrixWorld();
  }

  private updateLocalBot(r: Remote, b: LocalBot, dt: number): void {
    const v = b.vehicle;
    const o = r.visual.object;
    const alpha = this.acc / FIXED_DT;
    o.position.lerpVectors(b.prevPos, b.currPos, alpha);
    const lv = v.body.linvel();
    r.vel.set(lv.x, lv.y, lv.z);
    o.quaternion.slerpQuaternions(b.prevRot, b.currRot, alpha);
    for (let i = 0; i < 4; i++) SUSP[i] = Math.max(0, Math.min(0.25, v.wheels[i].compression)) - 0.02;
    r.visual.setPose(v.steerAngle, v.wheels[0].angle, v.wheels[2].angle, SUSP);
    r.visual.setLights(v.pedals.brake > 0.1 && !v.reverse, this.headlightsOn, this.env.night);
    r.visual.updateSmoke(dt, 0, this.scene);
    const d = o.position.distanceTo(_camPos);
    r.visual.setOpacity(this.cinematic ? 1 : THREE.MathUtils.clamp((d - 2.5) / 6, 0.15, 1));
    o.updateMatrixWorld();
  }

  /** Session clock: time left until the chequered flag (the flag falls at start + session length). */
  private sessionText(serverNow: number): string {
    if (this.finishedMs !== null) return t('SESSION COMPLETE');
    if (this.startAt === null) return t('TIME LEFT {clock}', { clock: fmtClock(this.race.sessionMs) });
    const left = this.startAt + this.race.sessionMs - Math.max(serverNow, this.startAt);
    return this.flagged || left <= 0 ? t('CHEQUERED FLAG · LAST LAP') : t('TIME LEFT {clock}', { clock: fmtClock(left) });
  }

  /** Pit lane: limiter, pit-in/out for the lap logic, the service box. */
  private updatePit(serverNow: number): void {
    const pit = this.pit;
    if (!pit || this.startAt === null || serverNow < this.startAt) return;
    const v = this.vehicle;
    const edge = this.loc.lateral >= 0 ? this.trackData.widthL[this.loc.index] : this.trackData.widthR[this.loc.index];
    const ev = pit.update(this.currPos.x, this.currPos.z, Math.abs(this.loc.lateral) - (edge ?? 6), v.telemetry.speed);
    if (ev === 'enter') {
      v.speedLimitMs = pit.limitMs;
      this.conn.sendJson({ t: 'pit', in: true });
      this.localTracker?.pitIn(this.me, serverNow);
      this.flash(t('Pit lane · limiter {n} km/h · stop in the yellow box for service', { n: pit.lane.speedLimitKmh }), 4000);
    } else if (ev === 'exit') {
      v.speedLimitMs = null;
      this.conn.sendJson({ t: 'pit', in: false });
      this.localTracker?.pitOut(this.me, this.trackData.pitLane?.exitS ?? 0);
      this.closePitMenu();
      this.flash(this.flagged ? t('Session over') : t('Out lap: bring the tyres up to temperature'), 3000);
    } else if (ev === 'box' && !this.pitHold && this.finishedMs === null) {
      this.openPitMenu();
    }
    // service running
    const sv = this.service;
    if (sv && this.pitMenu) {
      const now = performance.now();
      const u = (now - sv.start) / (sv.end - sv.start);
      this.pitMenu.setProgress(u, Math.max(0, (sv.end - now) / 1000));
      if (u >= 1) this.finishService(sv.plan);
    }
    this.pitMenu?.setClock(this.sessionText(serverNow));
  }

  private openPitMenu(): void {
    const v = this.vehicle;
    this.pitHold = true;
    v.frozen = true;
    const wear = v.wheels.map((w) => w.wear);
    const avgWear = wear.reduce((a, b) => a + b, 0) / 4;
    this.pitMenu = new PitMenu(
      {
        current: v.compound.id,
        wear,
        temps: v.wheels.map((w) => w.temp),
        zones: this.damage.zones,
        wetness: this.weather.wetness,
        plan: defaultPlan(this.damage.zones, avgWear, v.compound.id, this.weather.wetness),
      },
      (plan, seconds) => {
        const now = performance.now();
        this.service = { plan, start: now, end: now + seconds * 1000 };
        this.snd?.pitService(!!plan.tyres);
      },
      () => this.releaseFromBox(),
    );
    this.hud.el.append(this.pitMenu.el);
  }

  private finishService(plan: ServicePlan): void {
    const v = this.vehicle;
    if (plan.tyres) {
      v.fitTyres(COMPOUNDS[plan.tyres], v.ambientC + 12);
      v.weatherGrip = compoundGrip(v.compound, this.weather.wetness, this.weather.rain);
    }
    if (this.damage.repair({ body: plan.body, suspension: plan.suspension, engine: plan.engine })) {
      if (plan.body) this.myVisual.resetDamage();
      v.drivetrain.powerScale = this.damage.powerScale;
      this.conn.sendJson({ t: 'damage', zones: Array.from(this.damage.zones, (z) => Math.round(z * 100) / 100) });
      this.damageVersionSent = this.damage.version;
    }
    this.flash(t('Service complete · GO!'), 2500);
    this.releaseFromBox();
  }

  private releaseFromBox(): void {
    this.service = null;
    this.closePitMenu();
    this.pitHold = false;
    if (this.startAt !== null && this.conn.serverNow() >= this.freezeUntil) this.vehicle.frozen = false;
  }

  private closePitMenu(): void {
    this.pitMenu?.dispose();
    this.pitMenu = null;
  }

  /** Slipstream for my car and the bots I simulate, from every car's position and velocity. */
  private updateWake(): void {
    const cars = this.wakeCars;
    cars.length = 0;
    for (const r of this.remotes.values()) if (r.visual.object.visible) cars.push({ pos: r.visual.object.position, vel: r.vel });
    cars.push({ pos: this.currPos, vel: _carVel });
    const apply = (v: Vehicle, pos: THREE.Vector3, vel: THREE.Vector3) => {
      const s = wakeStrength(
        pos,
        vel,
        cars.filter((c) => c.pos !== pos),
      );
      v.wake.strength += (s - v.wake.strength) * 0.2;
      // research: the follower loses drag in the wake and, right behind, some downforce (dirty air)
      v.wake.drag = 1 - 0.25 * v.wake.strength;
      v.wake.downforce = 1 - 0.15 * v.wake.strength;
    };
    apply(this.vehicle, this.currPos, _carVel);
    for (const r of this.remotes.values()) if (r.bot) apply(r.bot.vehicle, r.visual.object.position, r.vel);
  }

  /** Load the ghost car's model the first time there is a best lap to show (not part of the loading screen). */
  private ensureGhostVisual(): void {
    if (this.ghostVisual || this.ghostLoading || !settings.ghost) return;
    this.ghostLoading = true;
    const entry = this.vehicle.car;
    void loadCarModel(this.cars.cars.find((c) => c.id === entry.id) ?? entry, () => {}, 3).then((model) => {
      const v = new CarVisual(entry, model, false);
      v.setOpacity(0.3);
      v.object.visible = false;
      this.scene.add(v.object);
      this.ghostVisual = v;
    });
  }

  private updateGhost(serverNow: number): void {
    const gv = this.ghostVisual;
    if (!gv) return;
    const tr = this.localTracker?.players.get(this.me);
    const on = settings.ghost && !!tr && !tr.outLap && !tr.inPit && this.finishedMs === null;
    if (!on || !tr || !this.ghost.pose(serverNow - tr.lapStartMs, gv.object.position, gv.object.quaternion)) {
      gv.object.visible = false;
      return;
    }
    gv.object.visible = true;
    // fade out when it overlaps your car, like the other ghosts
    gv.setOpacity(THREE.MathUtils.clamp((gv.object.position.distanceTo(_camPos) - 2.5) / 8, 0.05, 0.3));
    gv.object.updateMatrixWorld();
  }

  /** Engines, chassis noises and ambience, heard from the active camera (cockpit or cinematic). */
  private updateAudio(dt: number, viewCam: THREE.Camera): void {
    if (!this.snd) {
      if (IS_DEV && safeFlag('apexghost.noAudio')) return; // A/B performance tests
      const a = this.cb.audio();
      if (!a?.settled) return;
      this.snd = new SessionAudio(a, this.vehicle.car, this.trackData);
    }
    viewCam.getWorldPosition(_lis);
    viewCam.getWorldQuaternion(_q1);
    _right.set(1, 0, 0).applyQuaternion(_q1);
    const others = this.otherCars;
    others.length = 0;
    for (const r of this.remotes.values()) {
      if (!r.visual.object.visible || (!r.bot && !r.buffer.hasData)) continue;
      const b = r.bot?.vehicle;
      others.push({
        key: r.id,
        entry: r.entry,
        pos: r.visual.object.position,
        vel: r.vel,
        rpm: b?.telemetry.rpm,
        load: b?.pedals.throttle,
        gearRatio: b ? Math.abs(b.drivetrain.ratio()) : undefined,
      });
    }
    this.snd.update(dt, {
      listener: _lis,
      right: _right,
      inCockpit: !this.cinematic,
      myPos: this.currPos,
      myVel: _carVel,
      vehicle: this.vehicle,
      others,
      rain: this.weather.rain,
      day: 1 - this.env.night,
    });
  }

  private updateRaceUi(serverNow: number, raceT: number, dt: number): void {
    const v = this.vehicle;
    const tel = v.telemetry;
    const p = this.currPos;
    // forward direction of the car on the ground plane
    _v1.set(0, 0, 1).applyQuaternion(this.currRot);
    this.track.locate(p.x, p.y, p.z, _v1.x, _v1.z, this.loc);
    const movingWrong = this.loc.dot < -0.45 && Math.abs(tel.forwardSpeed) > 4 && !v.reverse;
    this.wrongWayTime = movingWrong ? this.wrongWayTime + dt : 0;
    // stuck / upside-down hint
    _v2.set(0, 1, 0).applyQuaternion(this.currRot);
    const stuck = (tel.speed < 1 && raceT > 2000 && !v.frozen) || _v2.y < 0.3 || tel.airborne > 2;
    this.stuckTime = stuck ? this.stuckTime + dt : 0;

    const me = this.standings.find((s) => s.id === this.me);
    const position = me?.position ?? (this.race.slots[this.me] ?? 0) + 1;
    const nowMs = performance.now();
    if (nowMs > this.messageUntil) this.message = '';
    if (nowMs > this.sectorDeltaUntil) this.sectorDelta = null;
    const curLap = raceT < 0 ? 0 : this.finishedMs !== null ? 0 : serverNow - this.lapStartMs();
    this.hud.update({
      speedMs: tel.speed,
      rpm: tel.rpm,
      redline: this.vehicle.specs.redlineRpm,
      limiter: this.vehicle.specs.limiterRpm,
      gear: tel.gear,
      manual: v.drivetrain.manual,
      lapLabel: this.finishedMs !== null ? t('FIN') : this.localTracker?.players.get(this.me)?.outLap !== false ? t('OUT') : String(this.myLaps + 1),
      lapPenaltyMs: this.myLaps > 0 && this.finishedMs === null ? (this.localTracker?.players.get(this.me)?.lapPenaltyMs ?? 0) : 0,
      liveDelta:
        this.myLaps > 0 && this.finishedMs === null && this.liveDelta !== null
          ? this.liveDelta + (this.localTracker?.players.get(this.me)?.lapPenaltyMs ?? 0)
          : null,
      position,
      total: this.race.grid.length,
      currentLapMs: curLap,
      bestLapMs: this.bestLap,
      lastLapMs: this.lapTimes.length ? this.lapTimes[this.lapTimes.length - 1] : null,
      sectorDelta: this.sectorDelta,
      damage: this.damage.total,
      wrongWay: this.wrongWayTime > 1.2,
      abs: tel.absActive,
      tc: tel.tcActive,
      message: this.message,
      sessionText: this.sessionText(serverNow),
      pitText: this.pitHold ? t('PIT BOX') : this.pit?.inLane ? t('PIT LANE · LIMITER {n}', { n: this.pit.lane.speedLimitKmh }) : '',
      compound: this.vehicle.compound.id,
      tyreWear: v.wheels.map((w) => w.wear),
      brakeTemps: v.wheels.map((w) => w.brakeTemp),
      slipstream: v.wake.strength,
      resetHint: this.stuckTime > 3,
      tyreTemps: v.wheels.map((w) => w.temp),
      damageZones: this.damage.zones,
    });
    // minimap at ~10 Hz
    this.mapTimer -= dt;
    if (this.mapTimer <= 0) {
      this.mapTimer = 0.1;
      const dots = MAP_DOTS;
      dots.length = 0;
      for (const r of this.remotes.values()) {
        if (!r.visual.object.visible || (!r.bot && !r.buffer.hasData)) continue;
        dots.push({ x: r.visual.object.position.x, z: r.visual.object.position.z, me: false, color: r.entry.color });
      }
      _v1.set(0, 0, 1).applyQuaternion(this.currRot);
      this.hud.drawMap(dots, p.x, p.z, _v1.x, _v1.z);
    }
  }
  private mapTimer = 0;

  /* ------------------------------------------------------------ teardown --- */

  dispose(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    for (const off of this.offs) off();
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('keydown', this.onKeySkip, true);
    this.snd?.dispose();
    this.closePitMenu();
    this.kb.dispose();
    this.perf?.dispose();
    this.editor?.dispose();
    this.hud.el.remove();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.geometry && !m.geometry.userData.shared) m.geometry.dispose();
    });
    this.world?.free();
    this.events?.free();
  }
}

const SUSP = new Float32Array(4);

function safeFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

/** Air temperature (°C) for the tyre model: a summer day at the Eifel, cooler at night, in cloud and rain. */
function ambientTemp(w: WeatherState, hour: number): number {
  const day = Math.max(0, Math.sin(((hour - 7) / 14) * Math.PI));
  return 13 + 11 * day - 3 * w.clouds - 5 * w.rain;
}

/** Signed distance from the centreline at index i (+ = left). */
function lateralAt(t: TrackData, i: number, x: number, z: number): number {
  const cl = t.centerline;
  const j = (i + 1) % (cl.length / 3);
  const tx = cl[j * 3] - cl[i * 3];
  const tz = cl[j * 3 + 2] - cl[i * 3 + 2];
  const l = Math.hypot(tx, tz) || 1;
  return ((x - cl[i * 3]) * tz - (z - cl[i * 3 + 2]) * tx) / l;
}

function fmtClock(ms: number): string {
  const t = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

function fmtLap(ms: number): string {
  const m = Math.floor(ms / 60000);
  const s = (ms - m * 60000) / 1000;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
}

/** Copy a vehicle's state into a network sample. Returns the flags (without reset/smoke). */
function fillState(s: CarState, v: Vehicle, serverNow: number, headlights: boolean): number {
  const t = v.body.translation();
  const r = v.body.rotation();
  const lv = v.body.linvel();
  const av = v.body.angvel();
  s.t = Math.round(serverNow);
  s.px = t.x;
  s.py = t.y;
  s.pz = t.z;
  s.qx = r.x;
  s.qy = r.y;
  s.qz = r.z;
  s.qw = r.w;
  s.vx = lv.x;
  s.vy = lv.y;
  s.vz = lv.z;
  s.wx = av.x;
  s.wy = av.y;
  s.wz = av.z;
  s.steer = v.steerAngle;
  s.rotF = v.wheels[0].angle;
  s.rotR = v.wheels[2].angle;
  for (let i = 0; i < 4; i++) s.susp[i] = Math.max(0, Math.min(0.25, v.wheels[i].compression));
  let f = 0;
  if (v.pedals.brake > 0.1 && !v.reverse) f |= FLAG_BRAKE;
  if (headlights) f |= FLAG_HEADLIGHTS;
  if (v.reverse) f |= FLAG_REVERSE;
  if (v.kbd.handbrake > 0.5) f |= FLAG_HANDBRAKE;
  return f;
}
const MAP_DOTS: { x: number; z: number; me: boolean; color: string }[] = [];

/** Point on the car's bounding box in direction `dir` (car-local, horizontal). */
function boxPoint(dir: THREE.Vector3, car: CarEntry, out: THREE.Vector3): THREE.Vector3 {
  const hx = car.dims.width / 2;
  const hz = car.dims.length / 2;
  const kx = Math.abs(dir.x) > 1e-6 ? hx / Math.abs(dir.x) : Infinity;
  const kz = Math.abs(dir.z) > 1e-6 ? hz / Math.abs(dir.z) : Infinity;
  const k = Math.min(kx, kz) * 0.95;
  return out.set(dir.x * k, 0.55, dir.z * k);
}

function zonePoint(zone: number, car: CarEntry, out: THREE.Vector3): THREE.Vector3 {
  const hz = car.dims.length / 2;
  const hx = car.dims.width / 2;
  if (zone === 0) return out.set(0, 0.55, hz * 0.95);
  if (zone === 1) return out.set(0, 0.6, -hz * 0.95);
  if (zone === 2) return out.set(hx * 0.95, 0.6, 0);
  return out.set(-hx * 0.95, 0.6, 0);
}

function zoneDir(zone: number, out: THREE.Vector3): THREE.Vector3 {
  if (zone === 0) return out.set(0, 0, -1);
  if (zone === 1) return out.set(0, 0, 1);
  if (zone === 2) return out.set(-1, 0, 0);
  return out.set(1, 0, 0);
}
