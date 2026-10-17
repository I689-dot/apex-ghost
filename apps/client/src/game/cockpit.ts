import * as THREE from 'three';
import type { CarEntry } from '@apex/shared';
import type { VehicleTelemetry } from '../physics/vehicle';
import { settings } from '../settings';

const PITCH = -0.07; // ≈4° down, like a driver looking at the road ahead

/**
 * Cockpit camera with subtle, motion-sickness-friendly head movement:
 * g-force sway (damped spring), curb vibration, a little look-into-corner, and look left/right/back.
 */
export class CockpitCamera {
  readonly camera: THREE.PerspectiveCamera;
  private readonly anchor = new THREE.Object3D();
  private readonly eye: THREE.Vector3;
  private offset = new THREE.Vector3();
  private offVel = new THREE.Vector3();
  private lookYaw = 0;
  private cornerYaw = 0;
  private shakeT = 0;
  private dash: THREE.Group | null = null;
  private dashWheel: THREE.Object3D | null = null;
  lookingForward = true;

  constructor(
    private readonly entry: CarEntry,
    carObject: THREE.Object3D,
    fov: number,
  ) {
    this.camera = new THREE.PerspectiveCamera(fov, window.innerWidth / window.innerHeight, 0.04, 9000);
    this.eye = new THREE.Vector3(...entry.cockpitCamera.position);
    this.anchor.position.copy(this.eye);
    carObject.add(this.anchor);
    this.anchor.add(this.camera);
    // camera looks along +Z (car forward): three cameras look down −Z, so turn around; slight downward pitch
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.set(PITCH, Math.PI, 0);
    this.applySeat();
    if (!entry.hasInterior) this.buildDash();
  }

  /** Minimal dashboard + wheel for models without an interior. */
  private buildDash(): void {
    const g = new THREE.Group();
    const dark = new THREE.MeshStandardMaterial({ color: 0x121316, roughness: 0.85 });
    const carbon = new THREE.MeshStandardMaterial({ color: 0x1d1f22, roughness: 0.45, metalness: 0.3 });
    const dash = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.16, 0.5), dark);
    dash.position.set(-this.eye.x, -0.32, 0.7);
    const hood = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.04, 0.6), dark);
    hood.position.set(-this.eye.x, -0.24, 0.95);
    hood.rotation.x = -0.12;
    const wheel = new THREE.Group();
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.018, 10, 36), carbon);
    const hub = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.08, 0.04), carbon);
    wheel.add(rim, hub);
    wheel.position.set(0, -0.3, 0.48);
    wheel.rotation.x = -0.35;
    g.add(dash, hood, wheel);
    g.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = false;
    });
    this.anchor.add(g);
    this.dash = g;
    this.dashWheel = wheel;
  }

  /** Base eye position plus the player's seat adjustment (Settings → Seat height / position). */
  private eyeX = 0;
  private eyeY = 0;
  private eyeZ = 0;
  /** Automatic raise (m) found by `autoSeat`, so the road is visible over the dash. */
  private autoRaise = 0;

  applySeat(): void {
    this.eyeX = this.eye.x;
    this.eyeY = this.eye.y + this.autoRaise + settings.seatHeight;
    this.eyeZ = this.eye.z + settings.seatForward;
  }

  /**
   * Measures, against the real car model, how far below the horizon the dash/hood blocks the view,
   * and raises the eye (up to 14 cm, keeping headroom) until the road is visible from ~10 m ahead.
   * Runs once while loading.
   */
  autoSeat(car: THREE.Object3D): void {
    car.updateMatrixWorld(true);
    const meshes: THREE.Object3D[] = [];
    car.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !m.visible) return;
      for (let a: THREE.Object3D | null = m; a; a = a.parent) if (a === this.anchor) return; // our own dash/overlays
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      if (mats.every((x) => x.transparent)) return; // glass does not block the view
      meshes.push(m);
    });
    const ray = new THREE.Raycaster();
    const origin = new THREE.Vector3();
    const dir = new THREE.Vector3();
    const toWorld = (x: number, y: number, z: number, out: THREE.Vector3) => out.set(x, y, z).applyMatrix4(car.matrixWorld);
    const blocked = (y: number, pitchDeg: number, yawDeg: number): boolean => {
      toWorld(this.eye.x, y, this.eye.z, origin);
      const p = THREE.MathUtils.degToRad(pitchDeg);
      const yw = THREE.MathUtils.degToRad(yawDeg);
      dir.set(Math.sin(yw) * Math.cos(p), Math.sin(p), Math.cos(yw) * Math.cos(p)).transformDirection(car.matrixWorld);
      ray.set(origin, dir);
      ray.far = 3.5;
      return ray.intersectObjects(meshes, false).length > 0;
    };
    const headroom = (y: number): number => {
      toWorld(this.eye.x, y, this.eye.z, origin);
      ray.set(origin, dir.set(0, 1, 0).transformDirection(car.matrixWorld));
      ray.far = 1;
      const hit = ray.intersectObjects(meshes, false)[0];
      return hit ? hit.distance : 1;
    };
    // road visible from ~10 m: the view at -5.5° (straight ahead and slightly left/right) must be clear
    const clear = (y: number) => !blocked(y, -5.5, 0) && !blocked(y, -5.5, -8) && !blocked(y, -5.5, 8);
    let raise = 0;
    for (let dy = 0; dy <= 0.14 + 1e-6; dy += 0.02) {
      if (headroom(this.eye.y + dy) < 0.08) break;
      raise = dy;
      if (clear(this.eye.y + dy)) break;
    }
    this.autoRaise = raise;
    this.applySeat();
  }

  setFov(fov: number): void {
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
  }

  update(dt: number, t: VehicleTelemetry, steer: number, look: { left: boolean; right: boolean; back: boolean }, yawRate: number): void {
    // head sway: a damped spring driven by accelerations (clamped, a few centimetres)
    const ax = THREE.MathUtils.clamp(-t.latAccel * 0.0028, -0.045, 0.045);
    const az = THREE.MathUtils.clamp(-t.longAccel * 0.0022, -0.035, 0.035);
    const ay = 0;
    const k = 60;
    const c = 13;
    this.offVel.x += ((ax - this.offset.x) * k - this.offVel.x * c) * dt;
    this.offVel.y += ((ay - this.offset.y) * k - this.offVel.y * c) * dt;
    this.offVel.z += ((az - this.offset.z) * k - this.offVel.z * c) * dt;
    this.offset.addScaledVector(this.offVel, dt);

    // curb / rough-surface vibration
    this.shakeT += dt;
    const shake = t.surfaceRumble * Math.min(1, t.speed / 25) * 0.004;
    const sx = Math.sin(this.shakeT * 71) * shake;
    const sy = Math.sin(this.shakeT * 53 + 1.3) * shake;

    this.anchor.position.set(this.eyeX + this.offset.x + sx, this.eyeY + this.offset.y + sy, this.eyeZ + this.offset.z);

    // look left/right/back (hold keys) and a little look-into-corner
    const target = look.back ? Math.PI : look.left ? 1.25 : look.right ? -1.25 : 0;
    this.lookYaw += (target - this.lookYaw) * Math.min(1, dt * 12);
    const corner = THREE.MathUtils.clamp(steer * 0.35 + yawRate * 0.06, -0.18, 0.18);
    this.cornerYaw += (corner - this.cornerYaw) * Math.min(1, dt * 4);
    this.camera.rotation.set(PITCH, Math.PI + this.lookYaw + this.cornerYaw, 0);
    this.lookingForward = Math.abs(this.lookYaw) < 0.4;
    if (this.dashWheel) this.dashWheel.rotation.z = steer * 11;
    if (this.dash) this.dash.visible = this.lookingForward;
  }

  /** World position of the camera (for culling, ghosts and audio-less effects). */
  worldPosition(out: THREE.Vector3): THREE.Vector3 {
    return this.camera.getWorldPosition(out);
  }

  get carEntry(): CarEntry {
    return this.entry;
  }
}
