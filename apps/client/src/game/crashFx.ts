import * as THREE from 'three';

const SPARKS = 320;
const DEBRIS = 90;
const G = 9.81;
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

/**
 * What a crash leaves, as the sims show it: a shower of sparks where bodywork scrapes a wall or another car
 * (additive, short-lived, flung with the car's speed and falling), and pieces of carbon and bodywork that tumble
 * off, bounce on the road and stay there for a while before they are cleared. Pools of fixed size: a big crash
 * recycles the oldest pieces.
 */
export class CrashFx {
  readonly object = new THREE.Group();
  private sparkPos = new Float32Array(SPARKS * 3);
  /** Two vertices a spark: its head and a tail behind it along its velocity (a streak, as a camera sees it). */
  private sparkLine = new Float32Array(SPARKS * 6);
  private sparkVel = new Float32Array(SPARKS * 3);
  private sparkLife = new Float32Array(SPARKS);
  private sparkGeo = new THREE.BufferGeometry();
  private sparkNext = 0;
  private debris: THREE.InstancedMesh;
  private dPos = new Float32Array(DEBRIS * 3);
  private dVel = new Float32Array(DEBRIS * 3);
  private dRot = new Float32Array(DEBRIS * 3);
  private dSpin = new Float32Array(DEBRIS * 3);
  private dScale = new Float32Array(DEBRIS * 3);
  private dGround = new Float32Array(DEBRIS);
  private dAge = new Float32Array(DEBRIS).fill(1e9);
  private dNext = 0;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();

  constructor() {
    this.sparkGeo.setAttribute('position', new THREE.BufferAttribute(this.sparkLine, 3).setUsage(THREE.DynamicDrawUsage));
    const sparks = new THREE.LineSegments(
      this.sparkGeo,
      new THREE.LineBasicMaterial({ color: 0xffc070, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }),
    );
    sparks.frustumCulled = false;
    this.debris = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: 0x1b1d21, roughness: 0.55, metalness: 0.2 }),
      DEBRIS,
    );
    this.debris.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.debris.frustumCulled = false;
    this.debris.castShadow = true;
    this.debris.count = 0;
    this.object.add(sparks, this.debris);
    this.sparkLife.fill(0);
  }

  /**
   * A hit at world point p: `severity` 0…1, the car's velocity (m/s), the direction the hit pushed it (unit), the
   * ground height under it, the car's paint (some debris is bodywork, the rest carbon).
   */
  hit(p: THREE.Vector3, severity: number, vel: THREE.Vector3, push: THREE.Vector3, groundY: number, paint: THREE.Color | null): void {
    const n = Math.round(30 + 160 * severity);
    for (let k = 0; k < n; k++) {
      const i = this.sparkNext;
      this.sparkNext = (i + 1) % SPARKS;
      this.sparkPos[i * 3] = p.x;
      this.sparkPos[i * 3 + 1] = p.y;
      this.sparkPos[i * 3 + 2] = p.z;
      // scraped along with the car, sprayed out sideways and up
      const sp = 3 + Math.random() * 9;
      this.sparkVel[i * 3] = vel.x * 0.7 + push.x * -sp + (Math.random() - 0.5) * 6;
      this.sparkVel[i * 3 + 1] = 1 + Math.random() * 4;
      this.sparkVel[i * 3 + 2] = vel.z * 0.7 + push.z * -sp + (Math.random() - 0.5) * 6;
      this.sparkLife[i] = 0.25 + Math.random() * 0.6;
    }
    // pieces only from real impacts
    const pieces = severity < 0.12 ? 0 : Math.round(3 + 18 * severity);
    for (let k = 0; k < pieces; k++) {
      const i = this.dNext;
      this.dNext = (i + 1) % DEBRIS;
      this.dPos.set([p.x + (Math.random() - 0.5) * 0.6, p.y + Math.random() * 0.3, p.z + (Math.random() - 0.5) * 0.6], i * 3);
      this.dVel.set(
        [
          vel.x * (0.5 + Math.random() * 0.4) - push.x * (2 + Math.random() * 4),
          1.5 + Math.random() * 3.5,
          vel.z * (0.5 + Math.random() * 0.4) - push.z * (2 + Math.random() * 4),
        ],
        i * 3,
      );
      this.dRot.set([Math.random() * 6, Math.random() * 6, Math.random() * 6], i * 3);
      this.dSpin.set([(Math.random() - 0.5) * 20, (Math.random() - 0.5) * 20, (Math.random() - 0.5) * 20], i * 3);
      // splinters of carbon and flakes of bodywork: long and thin
      const big = Math.random() < 0.1 ? 1.8 : 1;
      this.dScale.set([(0.04 + Math.random() * 0.12) * big, 0.008 + Math.random() * 0.012, (0.03 + Math.random() * 0.08) * big], i * 3);
      this.dGround[i] = groundY;
      this.dAge[i] = 0;
      if (paint) this.debris.setColorAt(i, Math.random() < 0.45 ? paint : new THREE.Color(0x1b1d21));
    }
    if (this.debris.instanceColor) this.debris.instanceColor.needsUpdate = true;
  }

  update(dt: number): void {
    // sparks: ballistic, dying out; dead ones parked far below
    for (let i = 0; i < SPARKS; i++) {
      if (this.sparkLife[i] <= 0) {
        this.sparkLine[i * 6 + 1] = this.sparkLine[i * 6 + 4] = -1e4;
        continue;
      }
      this.sparkLife[i] -= dt;
      this.sparkVel[i * 3 + 1] -= G * dt;
      for (let a = 0; a < 3; a++) {
        this.sparkPos[i * 3 + a] += this.sparkVel[i * 3 + a] * dt;
        // a 1/60 s exposure: the streak's length is its speed
        this.sparkLine[i * 6 + a] = this.sparkPos[i * 3 + a];
        this.sparkLine[i * 6 + 3 + a] = this.sparkPos[i * 3 + a] - this.sparkVel[i * 3 + a] * 0.016;
      }
    }
    (this.sparkGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    // debris: tumbles, bounces, slides to rest on the road; cleared after a minute
    let live = 0;
    for (let i = 0; i < DEBRIS; i++) {
      const age = (this.dAge[i] += dt);
      if (age > 60) {
        this.debris.setMatrixAt(i, ZERO);
        continue;
      }
      live = Math.max(live, i + 1);
      const y = this.dPos[i * 3 + 1];
      const onGround = y <= this.dGround[i] + 0.01;
      if (!onGround) this.dVel[i * 3 + 1] -= G * dt;
      for (let a = 0; a < 3; a++) this.dPos[i * 3 + a] += this.dVel[i * 3 + a] * dt;
      if (this.dPos[i * 3 + 1] < this.dGround[i] + 0.01) {
        this.dPos[i * 3 + 1] = this.dGround[i] + 0.01;
        // a bounce, then friction on the asphalt
        this.dVel[i * 3 + 1] = Math.abs(this.dVel[i * 3 + 1]) > 1.5 ? -this.dVel[i * 3 + 1] * 0.3 : 0;
        const f = Math.max(0, 1 - dt * 3.5);
        this.dVel[i * 3] *= f;
        this.dVel[i * 3 + 2] *= f;
        for (let a = 0; a < 3; a++) this.dSpin[i * 3 + a] *= f;
        // lying flat once it stops
        if (Math.hypot(this.dVel[i * 3], this.dVel[i * 3 + 2]) < 0.2) {
          this.dRot[i * 3] *= 1 - Math.min(1, dt * 4);
          this.dRot[i * 3 + 2] *= 1 - Math.min(1, dt * 4);
        }
      }
      for (let a = 0; a < 3; a++) this.dRot[i * 3 + a] += this.dSpin[i * 3 + a] * dt;
      const fade = age > 55 ? Math.max(0.001, (60 - age) / 5) : 1;
      this.q.setFromEuler(this.e.set(this.dRot[i * 3], this.dRot[i * 3 + 1], this.dRot[i * 3 + 2]));
      this.m.compose(
        this.v.set(this.dPos[i * 3], this.dPos[i * 3 + 1], this.dPos[i * 3 + 2]),
        this.q,
        this.s.set(this.dScale[i * 3] * fade, this.dScale[i * 3 + 1] * fade, this.dScale[i * 3 + 2] * fade),
      );
      this.debris.setMatrixAt(i, this.m);
    }
    this.debris.count = live;
    this.debris.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.sparkGeo.dispose();
    this.debris.geometry.dispose();
    (this.debris.material as THREE.Material).dispose();
  }
}
