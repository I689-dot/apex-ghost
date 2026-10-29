import * as THREE from 'three';
import { sunPosition, type WeatherPlan, type WeatherState } from '@apex/shared';
import type { QualityConfig } from '../settings';
import { FOG_SHARED, installAtmosphereChunks, skyRadiance, sunTransmittance } from './atmosphere';
import { SkyDome } from './sky';
import { SHADOW_LAYER } from './carVisual';

const _sun = new THREE.Vector3();
const _c = new THREE.Color();
const _v = new THREE.Vector3();
const _grey = new THREE.Color();
const _fogAway = new THREE.Color();
const _fogSun = new THREE.Color();
const _disc = new THREE.Color();
const _cloudSun = new THREE.Color();
const _cloudAmb = new THREE.Color();
const _white = new THREE.Color(1, 1, 1);
const _dusk = new THREE.Color(0.42, 0.5, 0.75);
const NIGHT = new THREE.Color(0.012, 0.016, 0.03);
const OVERCAST = new THREE.Color(0.62, 0.66, 0.7);

/**
 * Sky, sun/moon light, fog, clouds, stars and rain. Driven by the deterministic weather state.
 * The sky (sky.ts) and every colour derived from it (sunlight, sky ambient, fog) come from one atmosphere model
 * (atmosphere.ts), so the light on the track always matches the sky behind it.
 */
export class Environment {
  readonly skyDome: SkyDome;
  readonly sun = new THREE.DirectionalLight(0xffffff, 3);
  readonly hemi = new THREE.HemisphereLight(0xbfd8ff, 0x4a4436, 0.6);
  readonly fog = new THREE.FogExp2(0xbfc8d0, 0.0002);
  /** < 1 thins the fog (the aerial shots of the pre-race cinematic would be a white-out in fog). */
  fogScale = 1;
  /** The camera-centred rain streaks look like blobs from an aerial camera: hidden during the flyover. */
  hideRain = false;
  private stars: THREE.Points;
  private moon: THREE.Sprite;
  private rain: THREE.LineSegments;
  private rainMat: THREE.ShaderMaterial;
  /** 0 day … 1 full night. */
  night = 0;
  sunElevation = 0;
  private envTarget: THREE.WebGLRenderTarget | null = null;
  /** Reflection environment; assigned per material (cars always, track on High/Ultra). */
  envMap: THREE.Texture | null = null;
  private envHour = -99;
  readonly sunDir = new THREE.Vector3(0, 1, 0);
  private time = 0;
  /** Atmosphere colours, recomputed when the sun or the haze moves (see refreshColours). */
  private sunT = new THREE.Color(1, 1, 1);
  private zenith = new THREE.Color();
  private horizonSun = new THREE.Color();
  private horizonAway = new THREE.Color();
  private colourSun = new THREE.Vector3(0, -2, 0);
  private colourHaze = -1;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly plan: WeatherPlan,
    private quality: QualityConfig,
    renderer: THREE.WebGLRenderer,
  ) {
    installAtmosphereChunks();
    this.skyDome = new SkyDome(renderer, quality.cloudDetail);
    scene.add(this.skyDome.mesh);
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
    // shadow-only stand-ins (your car's LOD0 while you sit in its detailed cockpit model)
    this.sun.shadow.camera.layers.enable(SHADOW_LAYER);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    scene.add(this.sun, this.sun.target, this.hemi);

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

  /** Sunlight colour, zenith and horizon colours from the atmosphere model (cheap enough per change, not per frame). */
  private refreshColours(haze: number): void {
    const s = this.sunDir;
    if (s.distanceToSquared(this.colourSun) < 1e-6 && Math.abs(haze - this.colourHaze) < 0.01) return;
    this.colourSun.copy(s);
    this.colourHaze = haze;
    sunTransmittance(s, haze, this.sunT);
    skyRadiance(_v.set(0, 1, 0), s, haze, this.zenith);
    const az = Math.hypot(s.x, s.z) > 1e-4 ? Math.atan2(s.z, s.x) : 0;
    skyRadiance(_v.set(Math.cos(az), 0.035, Math.sin(az)).normalize(), s, haze, this.horizonSun);
    skyRadiance(_v.set(-Math.cos(az), 0.035, -Math.sin(az)).normalize(), s, haze, this.horizonAway);
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
    // crisp blue on clear days, milky in haze and fog
    const haze = 0.55 + overcast * 0.9 + w.fog * 4;
    this.skyDome.updateLut(renderer, _sun, haze);
    this.refreshColours(haze);

    // sun or moon light
    const direct = (1 - overcast * 0.8) * (1 - w.fog * 0.6);
    const sunT = this.sunT;
    const tMax = Math.max(sunT.r, sunT.g, sunT.b, 1e-4);
    if (elevation > -0.02) {
      this.sun.position.copy(_sun).multiplyScalar(300).add(focus);
      // hue from the atmosphere (white-yellow at noon, orange near the horizon); brightness falls with the air mass
      this.sun.color.setRGB(sunT.r / tMax, sunT.g / tMax, sunT.b / tMax).lerp(_white, overcast * 0.6);
      const airMass = THREE.MathUtils.clamp(Math.sqrt((0.2126 * sunT.r + 0.7152 * sunT.g + 0.0722 * sunT.b) / 0.86), 0.35, 1.05);
      this.sun.intensity = 3.6 * day * direct * airMass + 0.0001;
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

    // sky ambient: the zenith's colour (deep blue at noon, violet at dusk), greyer under cloud; at night moonlit blue
    const zm = Math.max(this.zenith.r, this.zenith.g, this.zenith.b, 1e-4);
    _c.setRGB(this.zenith.r / zm, this.zenith.g / zm, this.zenith.b / zm)
      .lerp(_white, 0.45)
      .lerp(OVERCAST, overcast * 0.8);
    this.hemi.intensity = 0.38 + 1.05 * day * (0.8 + overcast * 0.4);
    this.hemi.color
      .copy(_c)
      .multiplyScalar(0.4 + 0.6 * day)
      .lerp(_dusk, this.night * 0.8);
    this.hemi.groundColor.setRGB(0.3, 0.28, 0.22).multiplyScalar(0.3 + 0.7 * day);

    // fog: the horizon colours of the sky in the same direction (towards / away from the sun), grey under cloud
    const heavyFog = THREE.MathUtils.smoothstep(1 - w.visibility / 900, 0, 1);
    const grey = _grey.copy(OVERCAST).multiplyScalar(0.25 + 1.25 * day);
    const greyMix = Math.min(1, overcast * 0.85 + w.fog * 0.8);
    const fogAway = _fogAway
      .copy(this.horizonAway)
      .lerp(grey, greyMix)
      .lerp(NIGHT, this.night * 0.9);
    const fogSun = _fogSun
      .copy(this.horizonSun)
      .lerp(grey, greyMix)
      .lerp(NIGHT, this.night * 0.9);
    this.fog.color.copy(fogAway);
    FOG_SHARED.sunColor.r = fogSun.r - fogAway.r;
    FOG_SHARED.sunColor.g = fogSun.g - fogAway.g;
    FOG_SHARED.sunColor.b = fogSun.b - fogAway.b;
    FOG_SHARED.sunDir.x = _sun.x;
    FOG_SHARED.sunDir.y = _sun.y;
    FOG_SHARED.sunDir.z = _sun.z;
    // aerial perspective: ~25 km half-way haze on a clear day, a 1.4 km scale height
    FOG_SHARED.params.x = (1 / 26000) * (0.6 + haze * 0.7) * this.fogScale;
    FOG_SHARED.params.y = 1 / 1400;
    this.fog.density = (1.95 / Math.max(120, w.visibility)) * this.fogScale;
    renderer.setClearColor(fogAway);

    // sky dome: clouds lit by the sun's transmitted colour and the sky's ambient
    const sunIllum = THREE.MathUtils.smoothstep(elevation, -0.04, 0.06);
    this.skyDome.update({
      sunDir: _sun,
      sunDisc: _disc.copy(sunT).multiplyScalar(60 * sunIllum * (1 - overcast * 0.95) * (1 - w.fog)),
      cloudSun: _cloudSun.copy(sunT).multiplyScalar(2.6 * sunIllum * (1 - overcast * 0.55)),
      cloudAmbient: _cloudAmb
        .copy(this.zenith)
        .multiplyScalar(0.9)
        .add(_c.copy(this.horizonAway).multiplyScalar(0.55))
        .lerp(_c.copy(grey).multiplyScalar(0.95), overcast * 0.7)
        .add(_c.setRGB(0.006, 0.008, 0.014).multiplyScalar(this.night)),
      cover: Math.min(0.97, 0.12 + overcast * 0.85 + w.fog * 0.2),
      cirrus: (1 - overcast) * 0.8,
      fogMix: heavyFog,
      fogColor: fogAway,
      night: this.night,
      time: this.time + (this.plan.seed % 1000) * 7,
    });
    this.skyDome.mesh.position.copy(camera.position);

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
    // the same dome (atmosphere and clouds), centred on the cube camera
    const dome = new THREE.Mesh(this.skyDome.mesh.geometry, this.skyDome.material);
    dome.scale.setScalar(500);
    dome.frustumCulled = false;
    envScene.add(dome);
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
    ground.geometry.dispose();
    (ground.material as THREE.Material).dispose();
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
    this.skyDome.setDetail(q.cloudDetail);
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
