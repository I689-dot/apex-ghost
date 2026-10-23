import type { Vec3 } from './track';

export type Drivetrain = 'RWD' | 'AWD' | 'FWD';
export type CarCategory = 'GT3' | 'GT3 Evo' | 'Cup' | 'Hypercar' | 'Touring';

/** Hand-editable physical specification of a car (cars.json → specs). */
export interface CarSpecs {
  massKg: number;
  powerKw: number;
  /** Torque curve: [rpm, Nm] pairs, ascending rpm. */
  torqueCurve: [number, number][];
  idleRpm: number;
  redlineRpm: number;
  limiterRpm: number;
  /** Forward gear ratios. */
  gears: number[];
  reverseRatio: number;
  finalDrive: number;
  shiftTimeMs: number;
  drivetrain: Drivetrain;
  /** AWD: fraction of torque to the front axle. */
  frontTorqueSplit: number;
  /** Static weight on the front axle (0..1). */
  weightFront: number;
  comHeightM: number;
  /** Peak tyre friction coefficient (dry asphalt). */
  tyreGrip: number;
  /** Total brake torque (Nm) at full pedal, both axles. */
  brakeTorqueNm: number;
  brakeBiasFront: number;
  /** Aerodynamic: drag area Cd·A (m²) and lift area ClA (m², positive = downforce). */
  dragArea: number;
  downforceArea: number;
  /** Fraction of downforce on the front axle. */
  aeroBalanceFront: number;
  /** Limited-slip locking coefficient (0 open … 1 locked). */
  diffLock: number;
  maxSteerDeg: number;
  springRateFront: number;
  springRateRear: number;
  antiRollFront: number;
  antiRollRear: number;
  suspTravelM: number;
  /** Rough top speed for UI (km/h). */
  topSpeedKmh: number;
  /** How the engine breathes: power in thin or hot air (altitude, summer) falls fully when naturally aspirated,
   * partly with a turbo or a hybrid (absent: turbo). */
  aspiration?: 'na' | 'turbo' | 'hybrid';
  /** Carbon-ceramic brake discs: they fade far hotter (~1,000 °C) than the steel discs GT3 cars race on. */
  carbonBrakes?: boolean;
}

export interface CarWheelGeom {
  position: Vec3;
  radius: number;
  width: number;
}

/** One entry of the generated cars.json. */
export interface CarEntry {
  id: string;
  name: string;
  manufacturer: string;
  year: number | null;
  category: CarCategory;
  color: string;
  thumbnail: string;
  lods: string[];
  /** High-detail model for your own car's cockpit (null: use lods[0]). */
  cockpit?: string | null;
  cockpitBytes?: number;
  /** Approx download size of LOD files (bytes) for the loading screen. */
  bytes: number;
  dims: { length: number; width: number; height: number };
  wheels: { FL: CarWheelGeom; FR: CarWheelGeom; RL: CarWheelGeom; RR: CarWheelGeom };
  wheelbase: number;
  trackFront: number;
  trackRear: number;
  /** Steering wheel pivot and rotation axis (null when the model has none: generic one is drawn). */
  steering: { position: Vec3; axis: Vec3; diameter: number } | null;
  /** tuned: the eye was set by hand per car (no automatic raise at load). */
  cockpitCamera: { position: Vec3; driverSide: 'left' | 'right'; tuned?: boolean };
  hasInterior: boolean;
  lights: { head: string[]; tail: string[] };
  /** The real car: engine, gearbox and the team or livery (shown in the lobby; translated where shown). */
  info?: { engine: string; gearbox: string; team: string } | null;
  /** Wheels that use the generic fallback model. */
  genericWheels: string[];
  specs: CarSpecs;
}

export interface CarsFile {
  version: number;
  forward: '+Z';
  up: '+Y';
  units: 'm';
  cars: CarEntry[];
}
