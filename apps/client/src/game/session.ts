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
  RACE_CONTROL,
  RESET_FREEZE_MS,
  STATE_HZ,
  STATES_PER_PACKET,
  CLIENT_HEADER,
  STATE_BYTES,
  RaceTracker,
  decodeRelay,
  encodeBotStates,
  greenState,
  pitWindowLaps,
  safetyCarAt,
  safetyCarPath,
  wrapDelta,
  encodeClientStates,
  makeCarState,
  nearestCenterlineIndex,
  planWeather,
  temperatures,
  weatherAt,
  type CarEntry,
  type Temperatures,
  type CarState,
  type CarsFile,
  type PenaltyReason,
  type RaceControlState,
  type RaceEvent,
  type RaceSetup,
  type RoomSnapshot,
  type ServerMsg,
  type Standing,
  type TrackData,
  type WeatherState,
  type SafetyCarPath,
} from '@apex/shared';
import type { Connection } from '../net/connection';
import { RemoteCarBuffer } from '../net/remote';
import { DamageState } from '../physics/damage';
import { InputSmoother, Keyboard } from '../physics/input';
import { FUEL, Vehicle } from '../physics/vehicle';
import { CAMERA_MODES, QUALITY, saveSettings, settings } from '../settings';
import { Hud } from '../ui/hud';
import { loadCarModel, loadTrackFile, type Progress } from './assets';
import { AiDriver, BOT_ASSISTS } from './ai';
import { Cinematic, type Entrant } from './cinematic';
import type { GameAudio } from '../audio/audio';
import { SessionAudio, type OtherCar } from '../audio/sessionAudio';
import { LapDelta } from './lapDelta';
import { BestLapGhost, wakeStrength } from './ghost';
import { applySetup, vehicleSetup } from './carSetup';
import { PitLaneMonitor, type WallProbe } from './pitLane';
import { defaultPlan, serviceTime, type ServicePlan } from './pitService';
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
import { Forest } from './forest';
import { RoadWear } from './roadWear';
import { buildCrowd } from './crowd';
import { GrassTufts } from './grassTufts';
import { PerfOverlay } from './perf';
import { TrackEditor } from './trackEditor';
import { IS_DEV } from '../config';
import { t } from '../i18n';
import { rumble } from '../input/gamepad';

const FIXED_DT = 1 / PHYSICS_HZ;
const STEPS_PER_SAMPLE = PHYSICS_HZ / STATE_HZ;
const MAX_FRAME_DT = 0.1;
/** How far a bot moves over to pass a slower car (m). */
const PASS_OFFSET = 3.6;
/** AI cars leave the grid one at a time, this far apart (qualifying: no rolling start). 2.5 s kept the last of 11
 * bots waiting 27 s, which looked like bots that would not start. */
const BOT_RELEASE_MS = 1000;
/** Other cars' collision boxes with the contact rule: kinematic, they push us and only touch cars. */
const KINEMATIC_GROUPS = (0x0002 << 16) | 0x0002;
const FCY_MS = RACE_CONTROL.fcyKmh / 3.6;
/** Maps whose pit lane gets our own surface (pitLane.buildSurface): Zandvoort's model draws it near-white. */
const PIT_SURFACE_MAPS = new Set(['zandvoort']);
/** What race control's penalties are for (the drive-through announcements). */
const PENALTY_TEXT: Record<PenaltyReason, string> = {
  'track-limits': 'track limits',
  reset: 'reset',
  shortcut: 'shortcut',
  'overtake-sc': 'overtaking under the safety car',
  'overtake-fcy': 'overtaking under the full-course yellow',
  'overtake-yellow': 'overtaking under yellow flags',
  'passed-sc': 'overtaking the safety car',
  'blue-flags': 'ignoring blue flags',
  'missed-stop': 'no mandatory stop',
  unserved: 'drive-through not served',
};

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
  /** Contact rule: its collision box, moved to where the car is now. */
  body: RAPIER.RigidBody | null;
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
  /** Its own pit-lane monitor (enter / exit for the lap logic), the lap it makes its mandatory stop on, and the
   * service in progress (ends at, performance.now() ms; 0 = none). */
  pit: PitLaneMonitor | null;
  stopLap: number;
  serviceEnd: number;
  servicePlan: ServicePlan | null;
  /** Left the pit lane at (performance.now() ms): the standings take a moment to show the stop served. */
  exitAt: number;
  /** Told the server it is in the pit lane. */
  pitSent: boolean;
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
  private disposed = false;
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
  /** Air and track temperature and air density now (temperatures() in the shared weather code). */
  air: Temperatures = { airC: 20, trackC: 25, airDensity: 1.2 };
  private roadWear: RoadWear | null = null;
  private grass: GrassTufts | null = null;
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
  /** Race control's flags and course state (from the server). */
  private rc: RaceControlState = greenState(0);
  private greenUntil = 0;
  private scPath: SafetyCarPath | null = null;
  /** Where the safety car waits (the end of the pit lane, on the ground), found once. */
  private scPark: { x: number; y: number; z: number; yaw: number } | null = null;
  /** The safety car: its model, collision box (contact rule) and where it is now. */
  private sc: {
    visual: CarVisual;
    body: RAPIER.RigidBody | null;
    s: number;
    speed: number;
    /** World velocity on track (its body moves with it every physics step). */
    vel: THREE.Vector3;
    visible: boolean;
    /** Its body collides (on track, and placed where no car was). */
    solid: boolean;
  } | null = null;
  /** Colliders of other cars (contact rule), for damage. */
  private carColliders = new Set<number>();
  /** Fuel burnt per lap: an estimate until a lap has been measured. */
  private fuelPerLap = 0;
  private fuelAtLap: number | null = null;
  private readonly contact: boolean;

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
    /** Watching: no car of our own (a parked, hidden stand-in), a chase camera on any racer. */
    readonly spectator = false,
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
    this.contact = !!this.race.rules?.contact && !spectator;
  }

  /* ------------------------------------------------------------ loading --- */

  async load(progress: Progress): Promise<void> {
    progress(0, 1, t('Starting physics'));
    await initRapier();
    this.trackData = await loadTrackFile(this.race.trackId);
    const entries = new Map(this.cars.cars.map((c) => [c.id, c]));
    const racers = this.race.grid.map((id) => ({ id, player: this.room.players.find((p) => p.id === id) }));
    const myCarId = this.spectator
      ? (racers.map((r) => r.player?.carId).find((c) => c && entries.has(c)) ?? this.cars.cars[0]?.id)
      : this.room.players.find((p) => p.id === this.me)?.carId;
    const myEntry = myCarId ? entries.get(myCarId) : undefined;
    if (!myEntry) throw new Error(t('Your car is not available.'));

    // byte budget for the progress bar
    const remoteEntries = racers
      .filter((r) => r.id !== this.me && r.player?.carId && entries.has(r.player.carId))
      .map((r) => ({ id: r.id, entry: entries.get(r.player?.carId as string) as CarEntry }));
    const trackBytes = 22_000_000;
    const total = trackBytes + myEntry.bytes + remoteEntries.reduce((s, r) => s + r.entry.bytes * REMOTE_LIGHT_SHARE, 0);
    let loaded = 0;
    const onBytes = (n: number) => {
      loaded += n;
      progress(Math.min(loaded, total), total, t('Loading track and cars'));
    };

    const [trackRes, myModel, ...remoteModels] = await Promise.all([
      Track.load(this.trackData, onBytes),
      loadCarModel(myEntry, onBytes, 1, this.gfx.quality.cockpitDetail),
      // other cars: the light levels now, their full-detail level after loading (streamRemoteDetail)
      ...remoteEntries.map((r) => loadCarModel(r.entry, onBytes, 3, false, 1)),
    ]);
    progress(total, total, t('Building the world'));
    this.track = trackRes.track;
    this.scene.add(this.track.root);
    if (this.trackData.forest) {
      const forest = await Forest.load(this.trackData.forest, this.gfx.renderer, onBytes);
      if (forest) this.track.setForest(forest);
    }

    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = FIXED_DT;
    this.events = new RAPIER.EventQueue(true);
    this.track.buildColliders(RAPIER, this.world, trackRes.collision);
    // ray casts only see colliders once the query structure is built: placing the cars on the ground needs it
    this.world.updateSceneQueries();
    // spectators on the stands, grass tufts beside the track (found with the same ray casts as the wheels)
    const crowd = buildCrowd(this.track.root, this.trackData, this.gfx.quality.crowd);
    if (crowd) this.scene.add(crowd);
    this.grass = GrassTufts.build(this.trackData, this.track.groundQuery(this.world));
    if (this.grass) this.scene.add(this.grass.mesh);

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
    // pressures, ride height on the springs, dampers
    this.vehicle.applySetup(vehicleSetup(settings.carSetup));
    if (this.contact) this.vehicle.setContact(true);
    this.track.excludeBody = this.vehicle.body;
    this.vehicle.drivetrain.manual = settings.manualGearbox;
    this.vehicle.place(grid.p[0], grid.p[1], grid.p[2], grid.yaw);
    this.vehicle.frozen = true;
    // no tyre warmers: the tyres leave the pits a little above air temperature
    this.air = temperatures(this.race.weather, this.weather, this.trackData.map);
    this.vehicle.setAir(this.air.airC, this.air.trackC, this.air.airDensity);
    this.vehicle.fitTyres(COMPOUNDS[settings.carSetup.tyre] ?? COMPOUNDS[compoundForWeather(this.weather.wetness)], this.vehicle.ambientC + 12);
    this.fuelPerLap = (this.trackData.length / 1000) * FUEL.perKm;
    if (this.race.rules?.fuel) this.vehicle.setFuel(settings.carSetup.fuelL);
    this.myVisual = new CarVisual(myEntry, myModel, true);
    if (this.gfx.quality.ownHeadlightSpots) this.myVisual.addHeadlights(this.gfx.quality.ownHeadlightShadows);
    else this.myVisual.simplifyForCockpit();
    this.scene.add(this.myVisual.object);
    if (this.spectator) {
      this.myVisual.object.visible = false;
      this.specTarget = this.race.grid[0] ?? '';
      this.hud.el.classList.add('spectating');
      window.addEventListener('keydown', this.onSpectatorKey);
    }
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
        body: null,
      });
    });
    this.createLocalBots(entries);
    // contact rule: a collision box for every car not simulated here (the bots I simulate are real vehicles)
    if (this.contact) for (const r of this.remotes.values()) if (!r.bot) r.body = this.kinematicCar(r.entry);
    if (this.race.rules?.raceControl && this.race.kind === 'race') {
      this.scPath = safetyCarPath(this.trackData);
      void this.loadSafetyCar();
    }
    // ray casts only see colliders after the query structure is built (normally by the first step)
    this.world.updateSceneQueries();
    this.racingLine = new RacingLineFx(this.trackData, tuned.specs, this.track.groundQuery(this.world), this.air.airDensity);
    this.roadWear = new RoadWear(this.trackData, tuned.specs, this.track.groundQuery(this.world), this.air.airDensity);
    this.scene.add(this.roadWear.object);
    this.racingLine.setMode(this.spectator ? 'off' : settings.racingLine);
    this.scene.add(this.racingLine.object);
    if (this.trackData.pitLane) {
      this.pit = new PitLaneMonitor(this.trackData);
      this.pit.measureBoxes(this.wallProbe);
      // painted on the *visible* road: the collision under painted layers is flattened a few cm lower, so markings
      // placed on it disappeared under the asphalt
      const roadMeshes: THREE.Object3D[] = [];
      this.track.root.traverse((o) => {
        const m = o as THREE.Mesh;
        const mat = m.isMesh ? ([m.material].flat()[0] as THREE.Material) : null;
        if (mat && /^(asph|pits|conc_|pavement|tiles|lines|box_decal)/i.test(mat.name)) roadMeshes.push(m);
      });
      const rc = new THREE.Raycaster();
      const down = new THREE.Vector3(0, -1, 0);
      const gq = this.track.groundQuery(this.world);
      const hit = { dist: 0, px: 0, py: 0, pz: 0, nx: 0, ny: 1, nz: 0, surface: 'asphalt' as const };
      this.track.root.updateMatrixWorld(true);
      const paintGround = (x: number, z: number, y: number) => {
        rc.set(new THREE.Vector3(x, y + 2.5, z), down);
        rc.far = 6;
        const h = rc.intersectObjects(roadMeshes, false)[0];
        if (h) return h.point.y;
        return gq.cast(x, y + 2.5, z, 0, -1, 0, 6, hit) ? hit.py : y;
      };
      if (PIT_SURFACE_MAPS.has(this.trackData.map ?? '')) this.scene.add(this.pit.buildSurface(paintGround, this.wallProbe));
      this.scene.add(this.pit.buildMarkings(paintGround, this.spectator ? null : { slot: this.race.slots[this.me] ?? 0, name: this.names.get(this.me) ?? '' }));
    }

    this.localTracker = this.makeTracker(0);

    this.buildCinematic(entries);
    this.hud.setTrack(this.trackData);
    this.hud.raceLaps = this.race.kind === 'race' ? this.race.laps : 0;
    this.hud.el.append(this.timing.el);
    this.gfx.setScene(this.scene, this.spectator ? this.cockpit.camera : this.driveCamera());
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
      format:
        this.race.kind === 'race'
          ? t('Race · {n} laps · grid from qualifying', { n: this.race.laps })
          : t('{min}-minute qualifying · best valid lap wins · pit lane open', { min: Math.round(this.race.sessionMs / 60000) }),
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
      vehicle.setAir(this.air.airC, this.air.trackC, this.air.airDensity);
      vehicle.fitTyres(COMPOUNDS[compoundForWeather(this.weather.wetness)], vehicle.ambientC + 12);
      if (this.contact) {
        vehicle.setContact(true);
        this.carColliders.add(vehicle.collider.handle);
      }
      // fuel for the race and a little more (they refuel at a stop if a tank is not enough), 40 l for qualifying
      const perLap = (this.trackData.length / 1000) * FUEL.perKm;
      if (this.race.rules?.fuel) vehicle.setFuel(this.race.kind === 'race' ? Math.min(FUEL.tankL, this.race.laps * perLap * 1.05 + 2) : 40);
      const pit = this.trackData.pitLane ? new PitLaneMonitor(this.trackData) : null;
      const win = pitWindowLaps(this.race.laps);
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
        pit,
        // spread over the window so they don't all stop on the same lap
        stopLap: win.open + (r.slot % (win.close - win.open + 1)),
        serviceEnd: 0,
        servicePlan: null,
        exitAt: 0,
        pitSent: false,
      };
      if (pit) {
        pit.measureBoxes(this.wallProbe);
        const [a, b] = pit.boxes()[pit.boxOf(r.slot)];
        r.bot.ai.pitBox = Math.round((a + b) / 2);
        r.bot.ai.pitBoxShift = pit.shiftAt(r.bot.ai.pitBox);
      }
    }
  }

  /** Distance to the circuit's walls (collision), horizontally from 0.8 m above (x, y, z): where the garages are. */
  private wallRay: RAPIER.Ray | null = null;
  private wallProbe: WallProbe = (x, y, z, dx, dz, max) => {
    const ray = (this.wallRay ??= new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }));
    ray.origin = { x, y: y + 0.8, z };
    ray.dir = { x: dx, y: 0, z: dz };
    const h = this.world.castRay(ray, max, true, undefined, (0xffff << 16) | 0x0004);
    return h ? h.timeOfImpact : null;
  };

  /** A collision box for a car simulated elsewhere (contact rule): moved each step to where that car is now. */
  private kinematicCar(entry: CarEntry): RAPIER.RigidBody {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
    const H = Math.min(entry.dims.height, 1.3);
    const hy = Math.max(0.22, (H * 0.8 - 0.3) / 2);
    const zMid = (entry.wheels.FL.position[2] + entry.wheels.RL.position[2]) / 2;
    const c = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(entry.dims.width * 0.44, hy, entry.dims.length * 0.46)
        .setTranslation(0, 0.3 + hy, zMid)
        .setFriction(0.35)
        .setRestitution(0.05)
        .setCollisionGroups(KINEMATIC_GROUPS),
      body,
    );
    this.carColliders.add(c.handle);
    return body;
  }

  /** The safety car's model (race control, race only): loaded after the session, shown when it is deployed. */
  private async loadSafetyCar(): Promise<void> {
    const entry = this.cars.cars.find((c) => c.role === 'safety');
    if (!entry) return;
    try {
      const model = await loadCarModel(entry, () => {}, 3, false, 1);
      if (this.disposed) return;
      const visual = new CarVisual(entry, model, false);
      visual.object.visible = false;
      this.scene.add(visual.object);
      this.uploadTextures(visual.object);
      await this.gfx.renderer.compileAsync(visual.object, this.cockpit.camera, this.scene);
      const body = this.contact ? this.kinematicCar(entry) : null;
      body?.setEnabled(false); // solid only on track (moveKinematics)
      this.sc = { visual, body, s: 0, speed: 0, vel: new THREE.Vector3(), visible: false, solid: false };
    } catch (e) {
      console.warn('[assets] safety car not loaded', e);
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
    this.uploadTextures(this.scene);
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

  /** Upload every texture under `root` now (not on first sight during the race). */
  private uploadTextures(root: THREE.Object3D): void {
    const r = this.gfx.renderer;
    const textures = new Set<THREE.Texture>();
    root.traverse((o) => {
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
  }

  /**
   * Other cars' full-detail models (LOD0, drawn within 18 m) after loading, while the intro and the countdown
   * play: one car at a time, the nearest on the grid first. Loading them up front made a 9-car session download
   * a third more and keep everyone waiting; a car whose model fails just stays on its lighter level.
   */
  private async streamRemoteDetail(): Promise<void> {
    const mySlot = this.race.slots[this.me] ?? 0;
    const order = [...this.remotes.values()].sort((a, b) => Math.abs(a.slot - mySlot) - Math.abs(b.slot - mySlot));
    for (const r of order) {
      if (!this.running) return;
      try {
        const model = await loadCarModel(r.entry, () => {}, 1);
        if (!this.running) return;
        await r.visual.addDetailLevel(model.lods[0], async (level) => {
          this.uploadTextures(level);
          await this.gfx.renderer.compileAsync(level, this.cockpit.camera, this.scene);
        });
      } catch (e) {
        console.warn(`[assets] full-detail model of ${r.entry.id} not loaded`, e);
      }
    }
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
    if (this.gfx.quality.remoteDetail) void this.streamRemoteDetail();
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
    const tr = new RaceTracker(
      this.trackData,
      startMs,
      this.race.kind === 'race' ? { raceLaps: this.race.laps, pitWindow: !!this.race.rules?.pitWindow } : { sessionMs: this.race.sessionMs },
    );
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
    this.racingLine?.setMode(this.spectator ? 'off' : settings.racingLine);
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
          // fuel a lap burns, measured (a lap with a stop in it doesn't count: refuelled)
          const fuel = this.vehicle.fuelL;
          if (fuel !== null) {
            if (this.fuelAtLap !== null && this.fuelAtLap > fuel) this.fuelPerLap = this.fuelAtLap - fuel;
            this.fuelAtLap = fuel;
          }
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
      case 'penalty': {
        // track limits, resets and shortcuts are announced at once by the local mirror of the lap logic
        // (updateLapDelta); race control's penalties come from the server only
        if (m.reason === 'track-limits' || m.reason === 'reset' || m.reason === 'shortcut') break;
        const what = t(PENALTY_TEXT[m.reason]);
        const mine = m.playerId === this.me;
        const name = this.names.get(m.playerId) ?? t('A driver');
        if (m.driveThrough)
          this.flash(
            mine ? t('DRIVE-THROUGH: {what} · serve it within 3 laps', { what }) : t('{name}: drive-through, {what}', { name, what }),
            mine ? 6000 : 3000,
          );
        else
          this.flash(
            mine ? t('+{s} s: {what}', { s: (m.ms / 1000).toFixed(0), what }) : t('{name}: +{s} s, {what}', { name, s: (m.ms / 1000).toFixed(0), what }),
            4000,
          );
        if (mine) this.snd?.chime('invalid');
        break;
      }
      case 'served':
        if (m.playerId === this.me) this.flash(m.what === 'stop' ? t('Mandatory stop done') : t('Drive-through served'), 3000);
        break;
      case 'raceControl':
        if (m.raceId === this.race.raceId) this.onRaceControl(m.state);
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
          this.flash(`${this.race.kind === 'race' ? t('FINISHED') : t('SESSION COMPLETE')}${pos ? ` · P${pos}` : ''}`, 8000);
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

  /** Race control changed something: announce the new course state. */
  private onRaceControl(state: RaceControlState): void {
    const before = this.rc.course;
    this.rc = state;
    if (state.course === before) return;
    const text =
      state.course === 'fcy'
        ? t('FULL COURSE YELLOW · {kmh} km/h in 10 s · no overtaking', { kmh: RACE_CONTROL.fcyKmh })
        : state.course === 'sc'
          ? t('SAFETY CAR · no overtaking, close up behind it')
          : state.course === 'sc-in'
            ? t('SAFETY CAR IN THIS LAP · no overtaking until the line')
            : t('GREEN FLAG · racing resumes');
    this.flash(text, 5000);
    if (state.course === 'green') this.greenUntil = performance.now() + 4000;
    this.snd?.chime(state.course === 'green' ? 'lap' : 'invalid');
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
    } else if (!this.spectator && serverNow >= this.freezeUntil && this.vehicle.frozen && raceT >= 0 && !this.pitHold) {
      this.vehicle.frozen = false;
      this.updateCountdown(-1);
      if (this.myLaps === 0 && raceT < 2000)
        this.flash(
          this.race.kind === 'race'
            ? t('Race: {n} laps from a standing start. Go at the green light; penalties are added to your race time.', { n: this.race.laps })
            : t('Qualifying: {min} minutes to set your best lap (clock at the top). Out lap first: warm the tyres, timing starts at the line.', {
                min: Math.round(this.race.sessionMs / 60000),
              }),
          7000,
        );
    } else if (raceT < 1500) this.updateCountdown(-1);
    else this.clearCountdown();
    if (this.spectator) this.vehicle.frozen = true;

    // weather (deterministic from seed + race clock)
    this.weatherTimer -= dt;
    if (this.weatherTimer <= 0) {
      this.weatherTimer = 0.25;
      this.weather = weatherAt(this.race.weather, Math.max(0, raceT / 1000));
      this.applyWeather();
    }

    // contact rule: the other cars where they are now, so the collision boxes match what you see
    if (this.contact) for (const r of this.remotes.values()) this.updateRemote(r, serverNow, dt);
    this.updateSafetyCar(serverNow, dt);

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
      if (this.contact) this.moveKinematics();
      this.world.step(this.events);
      this.drainContacts();
      this.snapshotPose();
      this.snapshotBots();
      this.stepCount++;
      // stamp each sample with the time of its own physics step, not the frame time
      if (this.stepCount % STEPS_PER_SAMPLE === 0) {
        const t = serverNow - this.acc * 1000;
        if (!this.spectator) this.sampleState(t);
        this.sampleBots(t);
      }
    }
    const alpha = this.acc / FIXED_DT;
    this.applyPose(alpha);
    const tPhysEnd = performance.now();

    // visuals of my car
    const v = this.vehicle;
    const susp = SUSP;
    // relative to the model's own ride height (restLen0): a lowered car sits lower over its wheels
    for (let i = 0; i < 4; i++) susp[i] = v.wheels[i].contact ? -(v.wheels[i].springLen - (v.wheels[i].restLen0 - v.wheels[i].fz0 / v.wheels[i].k)) : -0.05;
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
    const outside = !this.spectator && settings.camera !== 'cockpit';
    this.cockpit.hidden = outside;
    if (outside) {
      this.updateChaseCam(dt, this.kb.held('lookBack'));
      _camPos.copy(this.chaseCam.position);
    }
    // pre-race cinematic owns the camera until shortly before the start lights
    let viewCam: THREE.Camera = outside ? this.chaseCam : this.cockpit.camera;
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
        this.gfx.setCamera(this.spectator ? this.specCam : this.driveCamera());
        this.hud.el.style.visibility = '';
        window.removeEventListener('keydown', this.onKeySkip, true);
      }
    }
    if (this.spectator && !this.cinematic) {
      this.updateSpectatorCam(dt);
      viewCam = this.specCam;
      _camPos.copy(this.specCam.position);
    }
    cockpitGlass.value = viewCam === this.cockpit.camera ? 1 : 0;

    // remote ghosts (with the contact rule they were placed before the physics)
    if (!this.contact) for (const r of this.remotes.values()) this.updateRemote(r, serverNow, dt);
    else for (const r of this.remotes.values()) if (r.bot) this.updateRemote(r, serverNow, dt);

    // environment
    const tEnv = performance.now();
    this.env.update(dt, this.weather, viewCam, this.currPos, _carVel, this.gfx.renderer);
    // aerial shots see the whole circuit: distance culling (meant for the cockpit) would leave holes
    if (this.cinematic?.aerial) {
      this.track.showAll();
      this.track.forest?.update(_camPos, this.gfx.quality);
    } else this.track.updateVisibility(_camPos, this.gfx.quality);
    this.grass?.update(_camPos, this.cinematic?.aerial ? 0 : this.gfx.quality.grassRadius);
    if (!this.spectator)
      this.windshield.update(
        dt,
        this.weather.rain,
        v.telemetry.speed,
        window.innerWidth / window.innerHeight,
        1 - this.env.night * 0.8,
        this.cockpit.lookingForward && !outside,
      );
    this.windshield.setCrack(this.spectator ? 0 : this.damage.zones[0], this.cockpit.lookingForward && !outside);
    this.updateAudio(dt, viewCam);
    this.updateWake();
    this.updateGhost(serverNow);

    this.updateRaceUi(serverNow, raceT, dt);
    this.updatePit(serverNow);
    this.updateLimiters(serverNow);
    this.updateBotPits(serverNow);
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

  /** Contact rule: every physics step, the other cars' boxes to where they are at that step's time. */
  private moveKinematics(): void {
    const ahead = -this.acc; // this step's time relative to the frame (s)
    const move = (body: RAPIER.RigidBody, o: THREE.Object3D, vel: THREE.Vector3) => {
      body.setNextKinematicTranslation({ x: o.position.x + vel.x * ahead, y: o.position.y + vel.y * ahead, z: o.position.z + vel.z * ahead });
      body.setNextKinematicRotation(o.quaternion);
    };
    for (const r of this.remotes.values()) if (r.body) move(r.body, r.visual.object, r.vel);
    const sc = this.sc;
    if (sc?.body) {
      // Solid only on track. It never travels to or from there as a body: a kinematic body moved in one step
      // carries that step's speed into whatever it touches (it came up from 500 m under the map and went back down
      // when it came in, throwing cars into the air or through the ground, and stood solid on the pit-lane line).
      if (!sc.visible) {
        if (sc.solid) sc.body.setEnabled(false);
        sc.solid = false;
      } else if (!sc.solid) {
        // placed where it joins, and solid once no car is inside its box there
        const p = sc.visual.object.position;
        const clear = this.carsClearOf(p.x, p.z, 6.5);
        if (clear) {
          sc.body.setTranslation({ x: p.x, y: p.y, z: p.z }, false);
          sc.body.setRotation(sc.visual.object.quaternion, false);
          sc.body.setEnabled(true);
          sc.solid = true;
        }
      } else move(sc.body, sc.visual.object, sc.vel);
    }
  }

  /** No car (mine, the bots, the others' boxes) within r (m) of (x, z). */
  private carsClearOf(x: number, z: number, r: number): boolean {
    const near = (px: number, pz: number) => (px - x) ** 2 + (pz - z) ** 2 < r * r;
    if (!this.spectator && near(this.currPos.x, this.currPos.z)) return false;
    for (const o of this.remotes.values()) {
      const p = o.bot ? o.bot.vehicle.body.translation() : o.visual.object.position;
      if (near(p.x, p.z)) return false;
    }
    return true;
  }

  /** The safety car: drawn where race control's deterministic path puts it (every client agrees). */
  private updateSafetyCar(serverNow: number, dt: number): void {
    const sc = this.sc;
    if (!sc || !this.scPath) return;
    const d = this.rc.sc;
    const on = !!d && serverNow >= d.t0 && (d.inAt === null || serverNow < d.inAt);
    sc.visible = on;
    sc.visual.object.visible = true;
    if (!on || !d) {
      // waiting at the end of the pit lane, as at a real race, lights off
      const lane = this.trackData.pitLane;
      if (!lane) {
        sc.visual.object.visible = false;
        return;
      }
      if (!this.scPark) {
        const i = Math.max(1, lane.points.length - 14);
        const p = lane.points[i];
        const q = lane.points[i + 1];
        // beside the lane line, not on it (the cars leaving the pits drive along it): towards the garages, clear of
        // the wall there, else the other way
        const [ax, az] = this.pit ? this.pit.awayAt(i) : [0, 0];
        const room = (sx: number) => this.wallProbe(p[0], p[1], p[2], ax * sx, az * sx, 12) ?? 12;
        const side = room(1) >= 5.5 ? 1 : room(-1) >= 5.5 ? -1 : room(1) >= room(-1) ? 1 : -1;
        const off = Math.max(0, Math.min(4.2, room(side) - 1.3));
        const x = p[0] + ax * side * off;
        const z = p[2] + az * side * off;
        const hit = { dist: 0, px: 0, py: 0, pz: 0, nx: 0, ny: 1, nz: 0, surface: 'asphalt' as const };
        const y = this.track.groundQuery(this.world).cast(x, p[1] + 2, z, 0, -1, 0, 5, hit) ? hit.py : p[1];
        this.scPark = { x, y, z, yaw: Math.atan2(q[0] - p[0], q[2] - p[2]) };
      }
      const o = sc.visual.object;
      o.position.set(this.scPark.x, this.scPark.y, this.scPark.z);
      o.rotation.set(0, this.scPark.yaw, 0);
      o.updateMatrixWorld();
      sc.vel.set(0, 0, 0);
      sc.visual.setLights(false, false, this.env.night);
      return;
    }
    const s = safetyCarAt(this.scPath, d.t0, d.s0, serverNow);
    const moved = wrapDelta(sc.s, s, this.trackData.length);
    sc.speed = dt > 0 && moved >= 0 && moved < 100 ? moved / dt : sc.speed;
    sc.s = s;
    const pt = SC_PT;
    this.track.pointAt(s, pt);
    const o = sc.visual.object;
    o.position.set(pt.x, pt.y, pt.z);
    o.rotation.set(0, pt.yaw, 0);
    o.updateMatrixWorld();
    sc.vel.set(Math.sin(pt.yaw) * sc.speed, 0, Math.cos(pt.yaw) * sc.speed);
    // the light bar flashes (it carries the brake and head light materials of the model)
    sc.visual.setLights(Math.floor(serverNow / 400) % 2 === 0, true, this.env.night);
  }

  /** Speed limiters: the pit lane's, and the full-course yellow's after its 10 s warning (my car and my bots). */
  private updateLimiters(serverNow: number): void {
    const fcy = this.rc.course === 'fcy' && this.rc.limitAt !== null && serverNow >= this.rc.limitAt;
    const lane = this.pit?.limitMs ?? null;
    this.vehicle.speedLimitMs = this.pit?.inLane ? lane : fcy ? FCY_MS : null;
    for (const r of this.remotes.values()) {
      const b = r.bot;
      if (b) b.vehicle.speedLimitMs = b.ai.inPitLane ? lane : fcy ? FCY_MS : null;
    }
  }

  /** A yellow flag waved at lap distance s. */
  private inYellow(s: number): boolean {
    const L = this.trackData.length;
    return this.rc.yellows.some(([from, to]) => wrapDelta(from, s, L) >= 0 && wrapDelta(s, to, L) >= 0);
  }

  /** Pit-window rule: is the mandatory stop (driver change) due now, done, or outside the window? */
  private driverChangeState(): 'due' | 'done' | 'closed' | null {
    if (!this.race.rules?.pitWindow || this.race.kind !== 'race') return null;
    if (this.standings.find((s) => s.id === this.me)?.stopDone) return 'done';
    const w = pitWindowLaps(this.race.laps);
    const lap = this.myLaps + 1;
    return lap >= w.open && lap <= w.close ? 'due' : 'closed';
  }

  /**
   * The bots' pit stops (the host simulates them): the mandatory stop on their lap of the window, a stop for
   * fuel when the tank won't reach the flag, a drive-through when race control gave one. They drive the pit lane
   * (AiDriver), stand while the crew works (serviceTime, as for a player), and their lap logic sees pit in / out.
   */
  private updateBotPits(serverNow: number): void {
    if (!this.startAt || serverNow < this.startAt) return;
    const now = performance.now();
    const rules = this.race.rules;
    const win = pitWindowLaps(this.race.laps);
    for (const r of this.remotes.values()) {
      const b = r.bot;
      const tr = this.localTracker?.players.get(r.id);
      if (!b || !b.pit || !tr) continue;
      const v = b.vehicle;
      const pos = v.body.translation();
      const lat = b.hint >= 0 ? lateralAt(this.trackData, b.hint, pos.x, pos.z) : 0;
      const off = b.hint >= 0 ? Math.abs(lat) - (lat >= 0 ? this.trackData.widthL[b.hint] : this.trackData.widthR[b.hint]) : 0;
      // in and out by the AI's own pit state (the monitor's 'exit' also fires when a bot is put back onto the lane's
      // line, which then read as a second pass through the pits)
      b.pit.update(pos.x, pos.z, off, v.telemetry.speed);
      if (!b.pitSent && b.ai.inPitLane && b.pit.inLane) {
        b.pitSent = true;
        this.conn.sendJson({ t: 'pit', in: true, id: r.id });
        this.localTracker?.pitIn(r.id, serverNow);
      } else if (b.pitSent && !b.ai.inPitLane) {
        b.pitSent = false;
        this.conn.sendJson({ t: 'pit', in: false, id: r.id });
        this.localTracker?.pitOut(r.id, this.trackData.pitLane?.exitS ?? 0, serverNow);
        b.exitAt = now;
      }
      if (this.race.kind !== 'race' || tr.finishedMs !== null || tr.dnf) continue;
      const lap = tr.laps + 1;
      const st = this.standings.find((s) => s.id === r.id);
      const lapsLeft = this.race.laps - tr.laps;
      const perLap = (this.trackData.length / 1000) * FUEL.perKm;
      const mustStop = !!rules?.pitWindow && !st?.stopDone && lap >= b.stopLap && lap <= win.close;
      const needFuel = v.fuelL !== null && v.fuelL < perLap * 1.3 && v.fuelL < lapsLeft * perLap;
      if (!b.ai.pitRequest && !b.ai.inPitLane && now - b.exitAt > 5000) {
        if (mustStop || needFuel) b.ai.pitRequest = 'stop';
        else if ((st?.driveThroughs ?? 0) > 0) b.ai.pitRequest = 'through';
      }
      // in the box: the crew's work, timed like a player's stop
      if (b.ai.atBox && b.serviceEnd === 0) {
        const wear = v.wheels.reduce((a, w) => a + w.wear, 0) / 4;
        const plan = defaultPlan(
          r.damage.zones,
          wear,
          v.compound.id,
          this.weather.wetness,
          v.fuelL === null ? 0 : Math.ceil(Math.min(FUEL.tankL - v.fuelL, Math.max(0, (lapsLeft + 1) * perLap - v.fuelL))),
          !!rules?.pitWindow && !st?.stopDone && lap >= win.open && lap <= win.close,
        );
        b.servicePlan = plan;
        b.serviceEnd = now + Math.max(1, serviceTime(plan, r.damage.zones).total) * 1000;
      } else if (b.serviceEnd > 0 && now >= b.serviceEnd) {
        const plan = b.servicePlan;
        if (plan?.tyres) {
          v.fitTyres(COMPOUNDS[plan.tyres], v.ambientC + 12);
          v.weatherGrip = compoundGrip(v.compound, this.weather.wetness, this.weather.rain);
        }
        if (plan && plan.fuelL > 0 && v.fuelL !== null) v.setFuel(v.fuelL + plan.fuelL);
        b.serviceEnd = 0;
        b.servicePlan = null;
        b.ai.pitServed();
      }
    }
  }

  /** Race control's flag for me (the light panel on the HUD) and the fuel readout. */
  private raceControlHud(serverNow: number): { flag: string; flagText: string; fuelText: string; fuelLow: boolean } {
    const rc = this.rc;
    const me = this.standings.find((s) => s.id === this.me);
    let flag = '';
    let flagText = '';
    if (rc.course === 'sc' || (rc.course === 'sc-in' && (rc.sc?.inAt ?? 0) > serverNow)) {
      flag = 'sc';
      flagText = rc.course === 'sc-in' ? t('SAFETY CAR IN THIS LAP') : t('SAFETY CAR · NO OVERTAKING');
    } else if (rc.course === 'sc-in') {
      flag = 'sc';
      flagText = t('RESTART AT THE LINE · NO OVERTAKING');
    } else if (rc.course === 'fcy') {
      flag = 'fcy';
      const left = (rc.limitAt ?? 0) - serverNow;
      flagText =
        left > 0 ? t('FCY · {kmh} KM/H IN {s}', { kmh: RACE_CONTROL.fcyKmh, s: Math.ceil(left / 1000) }) : t('FCY · {kmh} KM/H', { kmh: RACE_CONTROL.fcyKmh });
    } else if (rc.blue.includes(this.me)) {
      flag = 'blue';
      flagText = t('BLUE FLAG · LET THE LEADERS BY');
    } else if (this.inYellow(this.loc.s)) {
      flag = 'yellow';
      flagText = t('YELLOW FLAG · NO OVERTAKING');
    } else if (me && me.driveThroughs > 0) {
      flag = 'dt';
      flagText = t('DRIVE-THROUGH × {n} · THROUGH THE PIT LANE', { n: me.driveThroughs });
    } else if (performance.now() < this.greenUntil) {
      flag = 'green';
      flagText = t('GREEN FLAG');
    } else if (this.driverChangeState() === 'due') {
      flagText = t('PIT WINDOW OPEN · MANDATORY STOP');
    }
    const fuel = this.vehicle.fuelL;
    const laps = fuel === null ? 0 : fuel / Math.max(0.1, this.fuelPerLap);
    return {
      flag,
      flagText,
      fuelText: fuel === null ? '' : t('FUEL {l} L · {laps} LAPS', { l: fuel.toFixed(1), laps: laps.toFixed(1) }),
      fuelLow: fuel !== null && laps < 2,
    };
  }

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
    if (kb.tapped('camera') && !this.spectator) this.cycleCamera();
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
    // air and track temperature, air density: the tyres, brakes, aero and engines (shared, so all clients agree)
    const air = (this.air = temperatures(this.race.weather, w, this.trackData.map));
    this.vehicle.setAir(air.airC, air.trackC, air.airDensity);
    for (const r of this.remotes.values()) {
      if (!r.bot) continue;
      const bv = r.bot.vehicle;
      bv.weatherGrip = compoundGrip(bv.compound, w.wetness, w.rain);
      bv.wetness = w.wetness;
      bv.setAir(air.airC, air.trackC, air.airDensity);
    }
    this.track.setNight(this.env.night);
    this.headlightsOn = this.env.night > 0.3 || w.fog > 0.45 || w.rain > 0.4 || (this.env.sunElevation < 0.08 && w.clouds > 0.6);
    this.vehicle.drivetrain.powerScale = this.damage.powerScale;
    this.env.updateEnvMap(this.gfx.renderer, w.hour);
    this.applyEnv();
    this.track.applyWetness(w.wetness, this.env.envIntensity);
    this.roadWear?.setWetness(w.wetness);
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
      // qualifying: one at a time; the race: everyone at the green light
      const started = raceT >= (this.race.kind === 'race' ? 0 : order * BOT_RELEASE_MS);
      b.vehicle.frozen = !started || b.serviceEnd > 0;
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
    // the safety car: queue behind it, seen from far enough to stop behind it (the 40 m of a car ahead were too
    // short from 250 km/h to its 150, and the bots ran into it)
    const sc = this.sc;
    if (sc?.visible) {
      // the gap along the track (straight-line "ahead" picks up the other side of a hairpin)
      const prog = this.localTracker?.players.get(r.id)?.progressS;
      const gap = prog !== undefined ? wrapDelta(prog, sc.s, this.trackData.length) : -1;
      if (gap > 0 && gap < 220) cap = Math.min(cap, Math.sqrt(sc.speed ** 2 + 2 * 7 * Math.max(0, gap - 18)));
    }
    // no overtaking under a caution (FCY, safety car, a yellow flag here): follow instead
    const caution = this.rc.course !== 'green' || this.inYellow(this.localTracker?.players.get(r.id)?.progressS ?? -1e9);
    const found = caution ? null : (block as { along: number; lat: number } | null);
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
      // (with the contact rule, other cars too: a box that can't give way hits harder than a car that would, so less)
      const car = this.carColliders.has(other);
      if (!car && this.track.surfaceOf(other) !== 'wall') return;
      const impulse = e.totalForceMagnitude() * FIXED_DT * (car ? 0.6 : 1);
      const dir = e.maxForceDirection();
      // force on us points away from the obstacle: the hit came from the opposite side
      const sign = e.collider1() === myHandle ? -1 : 1;
      _v1.set(dir.x * sign, dir.y * sign, dir.z * sign);
      _q1.copy(this.currRot).invert();
      _v1.applyQuaternion(_q1);
      const res = this.damage.impact(impulse, -_v1.x, -_v1.z, this.vehicle.mass);
      if (res) {
        this.snd?.impact(Math.min(1, impulse / (this.vehicle.mass * 7)));
        rumble(impulse / (this.vehicle.mass * 5));
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
    const fade = this.cinematic || this.contact || (this.spectator && r.id === this.specTarget) ? 1 : THREE.MathUtils.clamp((d - 2.5) / 6, 0.15, 1);
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
    r.visual.setOpacity(this.cinematic || this.contact ? 1 : THREE.MathUtils.clamp((d - 2.5) / 6, 0.15, 1));
    o.updateMatrixWorld();
  }

  /** Session clock: time left until the chequered flag (the flag falls at start + session length). */
  private sessionText(serverNow: number): string {
    if (this.race.kind === 'race') {
      if (this.finishedMs !== null) return t('FINISHED');
      const flag = this.standings.some((x) => x.finishedMs !== null);
      return flag ? t('CHEQUERED FLAG · LAST LAP') : t('LAP {n}/{max}', { n: Math.min(this.myLaps + 1, this.race.laps), max: this.race.laps });
    }
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
      this.conn.sendJson({ t: 'pit', in: true });
      this.localTracker?.pitIn(this.me, serverNow);
      this.flash(t('Pit lane · limiter {n} km/h · stop in the yellow box for service', { n: pit.lane.speedLimitKmh }), 4000);
    } else if (ev === 'exit') {
      this.conn.sendJson({ t: 'pit', in: false });
      this.localTracker?.pitOut(this.me, this.trackData.pitLane?.exitS ?? 0, serverNow);
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
    // the race: fuel to the finish (and a lap more); the mandatory stop when the window is open
    const lapsLeft = this.race.kind === 'race' ? Math.max(0, this.race.laps - this.myLaps) : null;
    const fuelNeed = lapsLeft !== null ? (lapsLeft + 1) * this.fuelPerLap : null;
    const fuelAdd = v.fuelL !== null && fuelNeed !== null ? Math.ceil(Math.min(FUEL.tankL - v.fuelL, Math.max(0, fuelNeed - v.fuelL))) : 0;
    const driver = this.driverChangeState();
    this.pitMenu = new PitMenu(
      {
        current: v.compound.id,
        wear,
        temps: v.wheels.map((w) => w.temp),
        zones: this.damage.zones,
        wetness: this.weather.wetness,
        plan: defaultPlan(this.damage.zones, avgWear, v.compound.id, this.weather.wetness, fuelAdd, driver === 'due'),
        fuel: v.fuelL === null ? null : { litres: v.fuelL, tank: FUEL.tankL, perLap: this.fuelPerLap, need: fuelNeed },
        driverChange: driver,
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
    // dents are visual: reset them with any bodywork repair, even if the damage value had already reached zero
    if (plan.body) this.myVisual.resetDamage();
    if (plan.fuelL > 0 && v.fuelL !== null) v.setFuel(v.fuelL + plan.fuelL);
    if (this.damage.repair({ body: plan.body, suspension: plan.suspension, engine: plan.engine })) {
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
      inCockpit: !this.cinematic && !this.spectator,
      myPos: this.currPos,
      myVel: _carVel,
      vehicle: this.vehicle,
      others,
      rain: this.weather.rain,
      day: 1 - this.env.night,
    });
  }

  /* ---------------------------------------------------------- spectator --- */

  private specTarget = '';

  private remoteById(id: string): Remote | undefined {
    for (const r of this.remotes.values()) if (r.id === id) return r;
    return undefined;
  }
  private readonly specCam = new THREE.PerspectiveCamera(62, 1, 0.1, 6000);

  /* ------------------------------------------------- outside driving camera --- */
  private readonly chaseCam = new THREE.PerspectiveCamera(60, 1, 0.1, 9000);
  private chaseYaw = 0;
  private chaseY = 0;
  private chaseInit = false;

  /** The camera you drive with: the seat or a chase camera (V / L3 / D-pad → / CAM cycle them). */
  private driveCamera(): THREE.PerspectiveCamera {
    return settings.camera === 'cockpit' ? this.cockpit.camera : this.chaseCam;
  }

  private cycleCamera(): void {
    const i = CAMERA_MODES.indexOf(settings.camera);
    settings.camera = CAMERA_MODES[(i + 1) % CAMERA_MODES.length];
    saveSettings(settings);
    this.chaseInit = false;
    if (!this.cinematic) this.gfx.setCamera(this.driveCamera());
    this.flash(t({ cockpit: 'Cockpit camera', chase: 'Chase camera', far: 'Far chase camera' }[settings.camera]), 1200);
  }

  /**
   * Chase camera, as in GT / ACC: it trails the car's heading with a short lag (you see the car rotate into a
   * corner or step out in a slide), leans a little towards the direction of travel when sliding, pulls back and
   * widens slightly with speed, and smooths the height so kerbs and bumps don't shake the picture.
   * Look back puts it ahead of the car, looking back.
   */
  private updateChaseCam(dt: number, back: boolean): void {
    const o = this.myVisual.object;
    _v1.set(0, 0, 1).applyQuaternion(o.quaternion);
    const heading = Math.atan2(_v1.x, _v1.z);
    const speed = Math.hypot(_carVel.x, _carVel.z);
    let target = heading;
    if (speed > 8) {
      // in a slide, look partly along the path the car is really taking
      const travel = Math.atan2(_carVel.x, _carVel.z);
      const slip = Math.atan2(Math.sin(travel - heading), Math.cos(travel - heading));
      target = heading + THREE.MathUtils.clamp(slip, -0.6, 0.6) * 0.35;
    }
    const far = settings.camera === 'far';
    const cam = this.chaseCam;
    if (!this.chaseInit) {
      this.chaseYaw = target;
      this.chaseY = o.position.y;
      this.chaseInit = true;
    }
    const dYaw = Math.atan2(Math.sin(target - this.chaseYaw), Math.cos(target - this.chaseYaw));
    this.chaseYaw += dYaw * (1 - Math.exp(-dt * (far ? 4.5 : 6)));
    this.chaseY += (o.position.y - this.chaseY) * (1 - Math.exp(-dt * 7));
    const kmh = speed * 3.6;
    const dist = (far ? 8.2 : 5.4) + Math.min(1, kmh / 250) * (far ? 1.0 : 0.7);
    const height = far ? 2.7 : 1.85;
    const yaw = back ? this.chaseYaw + Math.PI : this.chaseYaw;
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    cam.position.set(o.position.x - fx * dist, this.chaseY + height, o.position.z - fz * dist);
    const ahead = far ? 3 : 4;
    cam.lookAt(o.position.x + fx * ahead, this.chaseY + (far ? 0.55 : 0.6), o.position.z + fz * ahead);
    const fov = (far ? 55 : 60) + Math.min(1, kmh / 250) * 7;
    if (Math.abs(cam.fov - fov) > 0.05 || cam.aspect !== window.innerWidth / window.innerHeight) {
      cam.fov = fov;
      cam.aspect = window.innerWidth / window.innerHeight;
      cam.updateProjectionMatrix();
    }
  }
  private specCamInit = false;

  /** ←/→ change car; 1–9 the car in that position. */
  private onSpectatorKey = (e: KeyboardEvent): void => {
    const have = new Set([...this.remotes.values()].map((r) => r.id));
    const ids = (this.standings.length ? this.standings.map((s) => s.id) : this.race.grid).filter((id) => have.has(id));
    if (!ids.length) return;
    let i = ids.indexOf(this.specTarget);
    if (e.key === 'ArrowRight') i = (i + 1) % ids.length;
    else if (e.key === 'ArrowLeft') i = (i - 1 + ids.length) % ids.length;
    else if (/^[1-9]$/.test(e.key)) i = Math.min(ids.length - 1, Number(e.key) - 1);
    else return;
    this.specTarget = ids[i];
    this.specCamInit = false;
  };

  /** Chase camera behind the watched car, smoothed. */
  private updateSpectatorCam(dt: number): void {
    const r = this.remoteById(this.specTarget) ?? [...this.remotes.values()][0];
    if (!r) return;
    const o = r.visual.object;
    _v1.set(0, 0, 1).applyQuaternion(o.quaternion);
    _v1.y = 0;
    _v1.normalize();
    _v2.copy(o.position).addScaledVector(_v1, -7.5);
    _v2.y += 2.6;
    const cam = this.specCam;
    cam.aspect = window.innerWidth / window.innerHeight;
    cam.updateProjectionMatrix();
    if (!this.specCamInit) {
      cam.position.copy(_v2);
      this.specCamInit = true;
    } else cam.position.lerp(_v2, 1 - Math.exp(-dt * 5));
    cam.lookAt(o.position.x + _v1.x * 4, o.position.y + 1, o.position.z + _v1.z * 4);
  }

  /** The HUD while watching: the session clock, the board around the watched car, its name and the minimap. */
  private updateSpectatorUi(serverNow: number, dt: number): void {
    const r = this.remoteById(this.specTarget);
    const st = this.standings.find((s) => s.id === this.specTarget);
    const name = this.names.get(this.specTarget) ?? '';
    if (this.standings.length) this.hud.setBoard(this.standings, this.specTarget, this.names);
    const nowMs = performance.now();
    if (nowMs > this.messageUntil) this.message = '';
    this.hud.update({
      speedMs: r ? r.vel.length() : 0,
      rpm: 0,
      redline: 1,
      limiter: 1,
      gear: 0,
      manual: false,
      lapLabel: st ? String(st.laps + 1) : '',
      lapPenaltyMs: st?.lapPenaltyMs ?? 0,
      liveDelta: null,
      position: st?.position ?? 0,
      total: this.race.grid.length,
      currentLapMs: 0,
      bestLapMs: st?.bestLapMs ?? null,
      lastLapMs: st?.lastLapMs ?? null,
      sectorDelta: null,
      damage: 0,
      wrongWay: false,
      abs: false,
      tc: false,
      message: this.message,
      sessionText: this.sessionText(serverNow),
      pitText: t('WATCHING · {name} · ←/→ change car', { name }),
      compound: 'medium',
      tyreWear: [0, 0, 0, 0],
      brakeTemps: [0, 0, 0, 0],
      slipstream: 0,
      resetHint: false,
      tyreTemps: [0, 0, 0, 0],
      damageZones: [0, 0, 0, 0, 0, 0],
      flag: this.rc.course === 'sc' || this.rc.course === 'sc-in' ? 'sc' : this.rc.course === 'fcy' ? 'fcy' : '',
      flagText:
        this.rc.course === 'sc' || this.rc.course === 'sc-in'
          ? t('SAFETY CAR · NO OVERTAKING')
          : this.rc.course === 'fcy'
            ? t('FCY · {kmh} KM/H', { kmh: RACE_CONTROL.fcyKmh })
            : '',
      fuelText: '',
      fuelLow: false,
    });
    this.mapTimer -= dt;
    if (this.mapTimer <= 0 && r) {
      this.mapTimer = 0.1;
      const dots = MAP_DOTS;
      dots.length = 0;
      for (const o of this.remotes.values()) {
        if (o === r || !o.visual.object.visible || (!o.bot && !o.buffer.hasData)) continue;
        dots.push({ x: o.visual.object.position.x, z: o.visual.object.position.z, me: false, color: o.entry.color });
      }
      _v1.set(0, 0, 1).applyQuaternion(r.visual.object.quaternion);
      this.hud.drawMap(dots, r.visual.object.position.x, r.visual.object.position.z, _v1.x, _v1.z);
    }
  }

  private updateRaceUi(serverNow: number, raceT: number, dt: number): void {
    if (this.spectator) {
      this.updateSpectatorUi(serverNow, dt);
      return;
    }
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
      ...this.raceControlHud(serverNow),
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
      if (this.sc?.visible) dots.push({ x: this.sc.visual.object.position.x, z: this.sc.visual.object.position.z, me: false, color: '#ffb000' });
      _v1.set(0, 0, 1).applyQuaternion(this.currRot);
      this.hud.drawMap(dots, p.x, p.z, _v1.x, _v1.z);
    }
  }
  private mapTimer = 0;

  /* ------------------------------------------------------------ teardown --- */

  dispose(): void {
    this.running = false;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    for (const off of this.offs) off();
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('keydown', this.onKeySkip, true);
    window.removeEventListener('keydown', this.onSpectatorKey);
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

/** Share of a car's download in its two light levels (LOD1 + LOD2 of the three; measured over the 18 cars: 0.29). */
const REMOTE_LIGHT_SHARE = 0.3;

const SUSP = new Float32Array(4);
const SC_PT = { x: 0, y: 0, z: 0, yaw: 0 };

function safeFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
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
  // a lowered car's wheels sit higher in the arches (ride height setup), as the others should see them
  for (let i = 0; i < 4; i++) s.susp[i] = Math.max(0, Math.min(0.25, v.wheels[i].compression - v.setup.ride[i < 2 ? 0 : 1]));
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
