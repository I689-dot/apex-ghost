import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { sunPosition, type WeatherPlan, type WeatherState } from '@apex/shared';
import type { QualityConfig } from '../settings';

const _sun = new THREE.Vector3();
const _c = new THREE.Color();
const _fc = new THREE.Color();
const DUSK = new THREE.Color(0.85, 0.55, 0.38);
const NIGHT = new THREE.Color(0.05, 0.06, 0.095);

/** Sky, sun/moon light, fog, clouds, stars and rain. Driven by the deterministic weather state. */
export class Environment {
  readonly sky = new Sky();
  readonly sun = new THREE.DirectionalLight(0xffffff, 3);
  readonly hemi = new THREE.HemisphereLight(0xbfd8ff, 0x4a4436, 0.6);
  readonly fog = new THREE.FogExp2(0xbfc8d0, 0.0002);
  /** < 1 thins the fog (the aerial shots of the pre-race cinematic would be a white-out in fog). */
  fogScale = 1;
  /** The camera-centred rain streaks look like blobs from an aerial camera: hidden during the flyover. */
  hideRain = false;
  private clouds: THREE.Mesh;
  private stars: THREE.Points;
  private moon: THREE.Sprite;
  private rain: THREE.LineSegments;
  private rainMat: THREE.ShaderMaterial;
  private cloudMat: THREE.ShaderMaterial;
  /** 0 day … 1 full night. */
  night = 0;
  sunElevation = 0;
  private envTarget: THREE.WebGLRenderTarget | null = null;
  /** Reflection environment; assigned per material (cars always, track on High/Ultra). */
  envMap: THREE.Texture | null = null;
  private envHour = -99;
  readonly sunDir = new THREE.Vector3(0, 1, 0);
  private time = 0;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly plan: WeatherPlan,
    private quality: QualityConfig,
  ) {
    this.sky.scale.setScalar(20000);
    this.sky.frustumCulled = false;
    scene.add(this.sky);
    scene.fog = this.fog;

    this.sun.castShadow = quality.shadows;
    this.sun.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
    const r = quality.shadowRange;
    const cam = this.sun.shadow.camera;
    cam.left = -r;
    cam.right = r;
    cam.top = r;
    cam.bottom = -r;
    cam.near = 1;
    cam.far = 600;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    scene.add(this.sun, this.sun.target, this.hemi);

    // procedural cloud dome
    this.cloudMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.BackSide,
      fog: false,
      uniforms: {
        uTime: { value: 0 },
        uCover: { value: 0.3 },
        uLight: { value: new THREE.Color(1, 1, 1) },
        uShade: { value: new THREE.Color(0.6, 0.62, 0.68) },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          vec4 p = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * p;
          gl_Position.z = gl_Position.w * 0.99999;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime; uniform float uCover; uniform vec3 uLight; uniform vec3 uShade; uniform vec3 uSunDir;
        varying vec3 vDir;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p) {
          vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
        }
        float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
        void main() {
          if (vDir.y < 0.0) discard;
          vec2 uv = vDir.xz / (vDir.y + 0.12) * 1.6 + vec2(uTime * 0.004, uTime * 0.0015);
          float n = fbm(uv);
          float d = smoothstep(1.0 - uCover, 1.05 - uCover * 0.35, n);
          float horizon = smoothstep(0.0, 0.18, vDir.y);
          float lit = clamp(dot(normalize(vDir), uSunDir) * 0.5 + 0.5, 0.0, 1.0);
          vec3 col = mix(uShade, uLight, lit * (1.0 - d * 0.6));
          gl_FragColor = vec4(col, d * horizon * 0.95);
        }`,
    });
    this.clouds = new THREE.Mesh(new THREE.SphereGeometry(8000, 32, 16), this.cloudMat);
    this.clouds.frustumCulled = false;
    this.clouds.renderOrder = -1;
    scene.add(this.clouds);

    // stars
    const n = 2500;
    const sp = new Float32Array(n * 3);
    let seed = 1;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < n; i++) {
      const u = rnd() * 2 - 1;
      const th = rnd() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      sp[i * 3] = s * Math.cos(th) * 9000;
      sp[i * 3 + 1] = Math.abs(u) * 9000;
      sp[i * 3 + 2] = s * Math.sin(th) * 9000;
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    this.stars = new THREE.Points(
      sg,
      new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }),
    );
    this.stars.frustumCulled = false;
    scene.add(this.stars);

    const mc = document.createElement('canvas');
    mc.width = mc.height = 64;
    const g = mc.getContext('2d') as CanvasRenderingContext2D;
    const grd = g.createRadialGradient(32, 32, 10, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,255,240,1)');
    grd.addColorStop(0.4, 'rgba(255,255,240,1)');
    grd.addColorStop(0.5, 'rgba(200,210,255,0.25)');
    grd.addColorStop(1, 'rgba(200,210,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    const mt = new THREE.CanvasTexture(mc);
    mt.colorSpace = THREE.SRGBColorSpace;
    this.moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: mt, fog: false, depthWrite: false, transparent: true }));
    this.moon.scale.setScalar(380);
    scene.add(this.moon);

    // rain: line streaks wrapped around the camera entirely on the GPU
    const drops = quality.rainParticles;
    const rp = new Float32Array(drops * 2 * 3);
    const re = new Float32Array(drops * 2);
    for (let i = 0; i < drops; i++) {
      const x = rnd() * 50 - 25;
      const y = rnd() * 30;
      const z = rnd() * 50 - 25;
      for (let k = 0; k < 2; k++) {
        rp.set([x, y, z], (i * 2 + k) * 3);
        re[i * 2 + k] = k;
      }
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(rp, 3));
    rg.setAttribute('aEnd', new THREE.BufferAttribute(re, 1));
    this.rainMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      fog: false,
      uniforms: {
        uTime: { value: 0 },
        uCam: { value: new THREE.Vector3() },
        uVel: { value: new THREE.Vector3() },
        uIntensity: { value: 0 },
        uColor: { value: new THREE.Color(0.7, 0.75, 0.8) },
      },
      vertexShader: /* glsl */ `
        attribute float aEnd;
        uniform float uTime; uniform vec3 uCam; uniform vec3 uVel; uniform float uIntensity;
        varying float vA;
        void main() {
          vec3 fall = vec3(1.5, -11.0, 0.6);
          vec3 p = position + fall * uTime;
          vec3 box = vec3(50.0, 30.0, 50.0);
          vec3 rel = mod(p - uCam + box * 0.5, box) - box * 0.5;
          rel.y += 6.0;
          // streak length follows the relative wind (car speed)
          vec3 rv = fall - uVel;
          rel += normalize(rv) * aEnd * clamp(length(rv) * 0.03, 0.25, 1.4);
          vA = (1.0 - aEnd * 0.6) * step(fract(position.x * 13.7 + position.z * 7.1), uIntensity);
          gl_Position = projectionMatrix * viewMatrix * vec4(uCam + rel, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; varying float vA;
        void main() { if (vA <= 0.0) discard; gl_FragColor = vec4(uColor, 0.32 * vA); }`,
    });
    this.rain = new THREE.LineSegments(rg, this.rainMat);
    this.rain.frustumCulled = false;
    this.rain.visible = false;
    scene.add(this.rain);
  }

  /** Update for the given weather state. Cheap; called every frame. */
  update(dt: number, w: WeatherState, camera: THREE.Camera, focus: THREE.Vector3, carVel: THREE.Vector3, renderer: THREE.WebGLRenderer): void {
    this.time += dt;
    const { elevation, azimuth } = sunPosition(this.plan.dayOfYear, w.hour);
    this.sunElevation = elevation;
    // world: +Z north-ish; azimuth measured from north towards east (+X)
    _sun.set(Math.sin(azimuth) * Math.cos(elevation), Math.sin(elevation), -Math.cos(azimuth) * Math.cos(elevation));
    this.sunDir.copy(_sun);
    const day = THREE.MathUtils.smoothstep(elevation, -0.1, 0.12);
    this.night = 1 - THREE.MathUtils.smoothstep(elevation, -0.2, 0.02);
    const overcast = w.clouds;

    const u = this.sky.material.uniforms;
    u.sunPosition.value.copy(_sun);
    u.turbidity.value = 2 + overcast * 10 + w.fog * 6;
    u.rayleigh.value = 1.2 + (1 - day) * 1.5 + overcast * 0.6;
    u.mieCoefficient.value = 0.004 + w.fog * 0.02;
    u.mieDirectionalG.value = 0.8;

    // sun or moon light
    const low = 1 - THREE.MathUtils.smoothstep(elevation, 0.02, 0.35); // warm when low
    const direct = (1 - overcast * 0.8) * (1 - w.fog * 0.6);
    if (elevation > -0.02) {
      this.sun.position.copy(_sun).multiplyScalar(300).add(focus);
      _c.setRGB(1, 0.92 - 0.25 * low, 0.85 - 0.45 * low);
      this.sun.color.copy(_c);
      this.sun.intensity = 3.4 * day * direct + 0.0001;
    } else {
      // moonlight from the opposite side of the sky
      this.sun.position.set(-_sun.x, Math.max(0.35, -_sun.y), -_sun.z).normalize().multiplyScalar(300).add(focus);
      this.sun.color.setRGB(0.55, 0.65, 1);
      this.sun.intensity = 0.45 * (1 - overcast * 0.6); // bright moonlight so the track stays readable
    }
    this.sun.target.position.copy(focus);
    // snap the shadow camera to texels to avoid shimmering
    const texel = (this.quality.shadowRange * 2) / this.quality.shadowMapSize;
    this.sun.target.position.x = Math.round(this.sun.target.position.x / texel) * texel;
    this.sun.target.position.z = Math.round(this.sun.target.position.z / texel) * texel;
    this.sun.position.x += this.sun.target.position.x - focus.x;
    this.sun.position.z += this.sun.target.position.z - focus.z;

    // generous sky ambient: by day it fills shadows and cockpits, at night it is a moonlit blue
    this.hemi.intensity = 0.38 + 1.05 * day * (0.8 + overcast * 0.4);
    this.hemi.color.setRGB(0.55 + 0.2 * overcast, 0.65 + 0.15 * overcast, 0.85 - 0.1 * overcast).multiplyScalar(0.4 + 0.6 * day);
    this.hemi.groundColor.setRGB(0.32, 0.29, 0.24).multiplyScalar(0.3 + 0.7 * day);

    // fog colour approximates the horizon colour
    const fc = _fc
      .setRGB(0.68 + overcast * 0.05, 0.74, 0.8 - overcast * 0.06)
      .lerp(DUSK, low * day * (1 - overcast))
      .lerp(NIGHT, this.night);
    this.fog.color.copy(fc);
    this.fog.density = (1.95 / Math.max(120, w.visibility)) * this.fogScale;
    const heavyFog = THREE.MathUtils.smoothstep(1 - w.visibility / 900, 0, 1);
    this.sky.visible = heavyFog < 0.98;
    (this.sky.material as THREE.ShaderMaterial).uniforms.up.value.set(0, 1, 0);
    renderer.setClearColor(fc);

    this.cloudMat.uniforms.uTime.value = this.time + (this.plan.seed % 1000);
    this.cloudMat.uniforms.uCover.value = Math.min(0.98, overcast * 0.9 + w.fog * 0.3);
    this.cloudMat.uniforms.uSunDir.value.copy(_sun);
    (this.cloudMat.uniforms.uLight.value as THREE.Color).setRGB(1, 0.95 - 0.2 * low, 0.9 - 0.35 * low).multiplyScalar(0.15 + 0.85 * day);
    (this.cloudMat.uniforms.uShade.value as THREE.Color)
      .setRGB(0.5, 0.52, 0.58)
      .multiplyScalar(0.08 + 0.9 * day)
      .lerp(fc, heavyFog);
    this.clouds.position.copy(camera.position);
    this.sky.position.copy(camera.position);

    (this.stars.material as THREE.PointsMaterial).opacity = this.night * (1 - overcast) * (1 - w.fog);
    this.stars.position.copy(camera.position);
    this.moon.position.copy(camera.position).addScaledVector(_sun, -6000);
    this.moon.position.y = camera.position.y + Math.abs(-_sun.y) * 6000 + 800;
    (this.moon.material as THREE.SpriteMaterial).opacity = this.night * (1 - overcast * 0.9);

    // rain
    this.rain.visible = w.rain > 0.01 && !this.hideRain;
    this.rainMat.uniforms.uTime.value = this.time;
    this.rainMat.uniforms.uCam.value.copy(camera.position);
    this.rainMat.uniforms.uVel.value.copy(carVel);
    this.rainMat.uniforms.uIntensity.value = w.rain;
    (this.rainMat.uniforms.uColor.value as THREE.Color).setRGB(0.7, 0.74, 0.8).multiplyScalar(0.15 + 0.85 * day);

    renderer.toneMappingExposure = 1.0 + this.night * 1.1 + overcast * 0.12;
  }

  /** Regenerates the reflection environment from the sky (call at load, then rarely). */
  /** Returns true when a new environment map was generated. */
  updateEnvMap(renderer: THREE.WebGLRenderer, hour: number, force = false): boolean {
    if (!force && Math.abs(hour - this.envHour) < 0.75) return false;
    this.envHour = hour;
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    const sky = new Sky();
    sky.scale.setScalar(1000);
    const su = sky.material.uniforms;
    const u = this.sky.material.uniforms;
    for (const k of ['turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG']) su[k].value = u[k].value;
    su.sunPosition.value.copy(u.sunPosition.value);
    envScene.add(sky);
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(900, 16).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: this.hemi.groundColor.clone().multiplyScalar(0.6) }),
    );
    ground.position.y = -5;
    envScene.add(ground);
    const rt = pmrem.fromScene(envScene, 0, 1, 2000);
    this.envTarget?.dispose();
    this.envTarget = rt;
    this.envMap = rt.texture;
    pmrem.dispose();
    sky.material.dispose();
    return true;
  }

  /** Reflection strength: dimmer at night. */
  get envIntensity(): number {
    return 0.25 + 0.75 * (1 - this.night);
  }

  setQuality(q: QualityConfig): void {
    this.quality = q;
    this.sun.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
    this.sun.shadow.map?.dispose();
    this.sun.shadow.map = null;
  }
}

/**
 * Screen-space rain droplets on the windshield (cockpit view only).
 * A full-screen quad drawn last with a cheap procedural shader.
 */
export class WindshieldFx {
  readonly mesh: THREE.Mesh;
  private mat: THREE.ShaderMaterial;
  private crackMat: THREE.MeshBasicMaterial;
  readonly crack: THREE.Mesh;

  constructor() {
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthTest: false,
      depthWrite: false,
      uniforms: { uTime: { value: 0 }, uRain: { value: 0 }, uSpeed: { value: 0 }, uAspect: { value: 1 }, uLight: { value: 1 } },
      vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      // Drops are tiny lenses: mostly clear, a bright lower crescent (they refract the sky upside down), a darker
      // rim and a pin-point highlight. They stay on the windscreen (upper part of the view), are pushed up and
      // stretched by the airflow at speed and leave faint streaks.
      fragmentShader: /* glsl */ `
        uniform float uTime; uniform float uRain; uniform float uSpeed; uniform float uAspect; uniform float uLight;
        varying vec2 vUv;
        float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        // xyz: lens normal (x, y) and coverage; w: streak
        vec4 drops(vec2 uv, float scale, float t, float seed) {
          uv *= scale;
          vec2 id = floor(uv); vec2 f = fract(uv) - 0.5;
          float r = h(id + seed);
          if (r > uRain) return vec4(0.0);
          float life = fract(t * (0.12 + r * 0.25) + r * 7.0);
          vec2 o = vec2(h(id + 3.1 + seed) - 0.5, h(id + 7.7 + seed) - 0.5) * 0.5;
          o.y += life * uSpeed * 0.8;
          float size = 0.05 + 0.09 * h(id + 1.3 + seed);
          vec2 q = (f - o) / vec2(size, size * (1.0 + uSpeed * 1.6));
          float d = length(q);
          // streak left behind a drop the airflow drags upwards
          float streak = uSpeed * smoothstep(0.012, 0.0, abs(f.x - o.x)) * step(f.y, o.y) * smoothstep(-0.5, o.y, f.y) * 0.5;
          float cov = (1.0 - smoothstep(0.82, 1.0, d)) * (1.0 - life * 0.6);
          return vec4(q * cov, cov, streak);
        }
        void main() {
          vec2 uv = vec2(vUv.x * uAspect, vUv.y);
          vec4 a = drops(uv, 11.0, uTime, 0.0);
          vec4 b = drops(uv + 0.37, 19.0, uTime * 1.3, 5.0);
          vec4 c = drops(uv + 0.71, 31.0, uTime * 1.7, 9.0);
          vec4 m = a.z >= b.z && a.z >= c.z ? a : (b.z >= c.z ? b : c);
          float cov = m.z;
          vec2 n = m.xy / max(cov, 1e-3);
          float rim = pow(clamp(length(n), 0.0, 1.0), 4.0);
          // refraction: the lower half of a drop shows the bright sky, the upper half the darker ground
          float lum = clamp(0.55 - 0.45 * n.y, 0.0, 1.0) * uLight;
          float spec = pow(max(0.0, 1.0 - length(n - vec2(-0.35, 0.45)) * 2.2), 6.0) * uLight;
          vec3 col = vec3(0.82, 0.88, 0.95) * lum + spec;
          float alpha = cov * (0.06 + 0.32 * rim) + spec * cov * 0.8 + (a.w + b.w + c.w) * 0.06;
          // only on the windscreen: fade out towards the dashboard (lower part of the view)
          alpha *= smoothstep(0.36, 0.52, vUv.y);
          gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.6));
        }`,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 999;
    this.mesh.visible = false;

    this.crackMat = new THREE.MeshBasicMaterial({ map: crackTexture(), transparent: true, depthTest: false, depthWrite: false, opacity: 0 });
    this.crack = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.crackMat);
    this.crack.frustumCulled = false;
    this.crack.renderOrder = 998;
    this.crack.visible = false;
    // full-screen: bypass the camera transform
    (this.crack.material as THREE.MeshBasicMaterial).onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace(
        '#include <project_vertex>',
        'vec4 mvPosition = vec4(transformed, 1.0); gl_Position = vec4(transformed.xy, 0.0, 1.0);',
      );
    };
  }

  update(dt: number, rain: number, speed: number, aspect: number, light: number, lookingForward: boolean): void {
    const u = this.mat.uniforms;
    u.uTime.value += dt;
    u.uRain.value = Math.min(0.85, rain * 0.9);
    u.uSpeed.value = Math.min(1, speed / 45);
    u.uAspect.value = aspect;
    u.uLight.value = light;
    this.mesh.visible = rain > 0.02 && lookingForward;
  }

  setCrack(frontDamage: number, lookingForward: boolean): void {
    const o = THREE.MathUtils.clamp((frontDamage - 0.25) * 1.6, 0, 0.85);
    this.crackMat.opacity = o;
    this.crack.visible = o > 0.01 && lookingForward;
  }
}

let crackTex: THREE.Texture | null = null;
function crackTexture(): THREE.Texture {
  if (crackTex) return crackTex;
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 512;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  g.strokeStyle = 'rgba(235,240,245,0.75)';
  g.lineCap = 'round';
  let seed = 42;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const cx = 700;
  const cy = 170;
  for (let i = 0; i < 26; i++) {
    let x = cx;
    let y = cy;
    let a = rnd() * Math.PI * 2;
    g.lineWidth = 1.6;
    g.beginPath();
    g.moveTo(x, y);
    const len = 8 + rnd() * 14;
    for (let s = 0; s < len; s++) {
      a += (rnd() - 0.5) * 0.6;
      x += Math.cos(a) * 18;
      y += Math.sin(a) * 18;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  for (let r = 18; r < 120; r += 26) {
    g.beginPath();
    g.lineWidth = 1;
    for (let k = 0; k <= 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      const rr = r * (0.8 + rnd() * 0.4);
      const px = cx + Math.cos(a) * rr;
      const py = cy + Math.sin(a) * rr;
      if (k === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    }
    g.stroke();
  }
  crackTex = new THREE.CanvasTexture(c);
  crackTex.colorSpace = THREE.SRGBColorSpace;
  return crackTex;
}
