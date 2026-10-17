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
  cockpitCamera: { position: Vec3; driverSide: 'left' | 'right' };
  hasInterior: boolean;
  lights: { head: string[]; tail: string[] };
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
