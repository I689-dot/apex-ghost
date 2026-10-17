import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { CarEntry } from '@apex/shared';
import { fetchWithProgress, parseGltf } from './assets';
import type { Graphics } from './graphics';

/** Turntable showroom rendered behind the menu/lobby UI (full-detail LOD0, as close-ups show every flaw). */
export class Showroom {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(32, 1, 0.1, 200);
  private turntable = new THREE.Group();
  private current: THREE.Object3D | null = null;
  private currentId = '';
  private cache = new Map<string, Promise<THREE.Group>>();
  private running = false;
  private raf = 0;
  private last = 0;
  private angle = 0.6;
  private loadToken = 0;

  constructor(private readonly gfx: Graphics) {
    const pm = new THREE.PMREMGenerator(gfx.renderer);
    this.scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    pm.dispose();
    this.scene.background = new THREE.Color(0x0d0e11);
    this.scene.fog = new THREE.Fog(0x0d0e11, 14, 30);
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(30, 64).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x15171b, roughness: 0.35, metalness: 0.1 }),
    );
    floor.receiveShadow = true;
    const ring = new THREE.Mesh(new THREE.RingGeometry(3.3, 3.36, 96).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xff2d3d }));
    ring.position.y = 0.005;
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(4, 7, 5);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = key.shadow.camera.bottom = -4;
    key.shadow.camera.right = key.shadow.camera.top = 4;
    const rim = new THREE.DirectionalLight(0xff6070, 1.4);
    rim.position.set(-5, 3, -6);
    this.scene.add(floor, ring, key, rim, this.turntable, new THREE.AmbientLight(0xffffff, 0.15));
    this.camera.position.set(6.5, 1.9, 6.5);
    this.camera.lookAt(0, 0.55, 0);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.gfx.setScene(this.scene, this.camera);
    this.gfx.resize();
    this.last = performance.now();
    const loop = (t: number) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(loop);
      const dt = Math.min(0.1, (t - this.last) / 1000);
      this.last = t;
      this.angle += dt * 0.25;
      this.turntable.rotation.y = this.angle;
      this.gfx.render();
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  async show(entry: CarEntry | null): Promise<void> {
    if (!entry || entry.id === this.currentId) return;
    this.currentId = entry.id;
    const token = ++this.loadToken;
    let p = this.cache.get(entry.id);
    if (!p) {
      p = (async () => (await parseGltf(await fetchWithProgress(entry.lods[0], () => {}))).scene)();
      this.cache.set(entry.id, p);
    }
    let model: THREE.Group;
    try {
      model = await p;
    } catch {
      this.cache.delete(entry.id);
      return;
    }
    if (token !== this.loadToken) return;
    if (this.current) this.turntable.remove(this.current);
    model.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    this.current = model;
    this.turntable.add(model);
  }
}
