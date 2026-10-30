import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { N8AOPass } from 'n8ao';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

/**
 * The physical sky produces HDR values large enough to overflow the half-float bloom blur,
 * and the resulting Inf/NaN turns the whole frame black. Clamp and scrub before bloom.
 */
const HdrClampShader = {
  uniforms: { tDiffuse: { value: null }, uMax: { value: 48.0 } },
  vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uMax; varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      if (any(isnan(c.rgb)) || any(isinf(c.rgb))) c.rgb = vec3(0.0);
      gl_FragColor = vec4(clamp(c.rgb, 0.0, uMax), c.a);
    }`,
};
import { detectQuality, qualityConfig, saveSettings, settings, type QualityConfig } from '../settings';
import { TaaPass } from './taa';

/**
 * A light filmic grade after tone mapping (High/Ultra), as a broadcast camera's look: a little more contrast
 * around mid-grey, a little more saturation, a soft vignette. The straight ACES output read flat and hazy.
 */
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uContrast: { value: 1.07 }, uSaturation: { value: 1.05 }, uVignette: { value: 0.22 } },
  vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uContrast; uniform float uSaturation; uniform float uVignette; varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 col = (c.rgb - 0.5) * uContrast + 0.5;
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, uSaturation);
      vec2 d = vUv - 0.5;
      col *= 1.0 - uVignette * smoothstep(0.25, 0.75, dot(d, d) * 2.0);
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), c.a);
    }`,
};
import { t } from '../i18n';

const _size = new THREE.Vector2();

/** Owns the WebGL renderer and the (cheap) post-processing chain. */
export class Graphics {
  readonly renderer: THREE.WebGLRenderer;
  readonly canvas: HTMLCanvasElement;
  quality: QualityConfig;
  private composer: EffectComposer | null = null;
  private renderPass: RenderPass | N8AOPass | null = null;
  private bloom: UnrealBloomPass | null = null;
  private taa: TaaPass | null = null;
  private scene: THREE.Scene | null = null;
  private camera: THREE.Camera | null = null;
  /** Dynamic resolution multiplier (0.6..1) on top of the user's resolution scale. */
  private dynScale = 1;
  private frameTimes = new Float32Array(45);
  private frameIdx = 0;
  private lastDynChange = 0;
  contextLost = false;
  onContextLost: (() => void) | null = null;
  onContextRestored: (() => void) | null = null;

  constructor(container: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'game-canvas';
    container.appendChild(this.canvas);
    const gl = this.canvas.getContext('webgl2', { antialias: true, powerPreference: 'high-performance', stencil: false, depth: true });
    if (!gl) throw new Error(t('WebGL 2 is not available. Please use an up-to-date Chrome, Edge or Firefox with hardware acceleration enabled.'));
    if (settings.qualityAuto) {
      settings.quality = detectQuality(gl);
      settings.qualityAuto = false;
      saveSettings(settings);
    }
    this.quality = qualityConfig();
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, context: gl, antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.shadowMap.autoUpdate = true;
    // post-processing renders several passes: count the whole frame, reset in render()
    this.renderer.info.autoReset = false;
    this.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.contextLost = true;
      this.onContextLost?.();
    });
    this.canvas.addEventListener('webglcontextrestored', () => {
      this.contextLost = false;
      this.onContextRestored?.();
    });
    window.addEventListener('resize', this.resize);
    this.resize();
  }

  get pixelRatio(): number {
    // Ultra supersamples: above the display's own resolution, scaled down by the browser (the cleanest edges there
    // are, on thin things above all: fences, grass, wires)
    const pr = Math.min(window.devicePixelRatio, this.quality.pixelRatioCap) * this.quality.superSample * settings.resolutionScale * this.dynScale;
    // at most ~8K worth of pixels (a 4K screen at 2× would exceed the GPU's largest render buffer)
    const maxPr = Math.sqrt((3840 * 2160 * 4) / Math.max(1, window.innerWidth * window.innerHeight));
    return Math.min(pr, maxPr);
  }

  setScene(scene: THREE.Scene, camera: THREE.Camera): void {
    this.scene = scene;
    this.camera = camera;
    this.rebuildPipeline();
  }

  /** Switch the camera without rebuilding the post-processing chain (cinematic ↔ cockpit). */
  setCamera(camera: THREE.Camera): void {
    this.taa?.unjitter();
    this.camera = camera;
    if (this.renderPass) this.renderPass.camera = camera;
    this.taa?.setCamera(camera);
    this.resize();
  }

  /** Your car's position (TAA reprojects it with its own motion: it moves with the camera); null: none. */
  setMotionAnchor(pos: THREE.Vector3 | null): void {
    this.taa?.setCar(pos);
  }

  applyQuality(): void {
    this.quality = qualityConfig();
    this.dynScale = 1;
    this.resize();
    this.rebuildPipeline();
  }

  private rebuildPipeline(): void {
    // EffectComposer.dispose frees its own targets, not its passes' (AO, bloom, SMAA buffers leaked on every
    // quality change)
    this.taa?.unjitter();
    for (const p of this.composer?.passes ?? []) p.dispose();
    this.composer?.dispose();
    this.composer = null;
    this.taa = null;
    if (!this.scene || !this.camera) return;
    const q = this.quality;
    this.renderer.shadowMap.enabled = q.shadows;
    this.renderer.shadowMap.type = q.softShadows ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const aa = q.antialias;
    // Low/Medium: render straight to the (natively multisampled) canvas, tone mapping in the material shaders
    if (!q.bloom && !q.ao && !q.grade && (aa === 'native' || aa === 'msaa')) return;
    const taa = aa === 'taa';
    // with AO the scene is drawn by N8AO (no hardware MSAA; SMAA or TAA smooths the edges): a multisampled target
    // would only cost bandwidth on every pass. TAA reads the scene's depth: the targets carry a depth texture.
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: aa === 'msaa' && !q.ao ? 4 : 0 });
    if (taa && !q.ao) rt.depthTexture = new THREE.DepthTexture(size.x, size.y, THREE.UnsignedIntType);
    const composer = new EffectComposer(this.renderer, rt);
    composer.setPixelRatio(1);
    let ao: N8AOPass | null = null;
    if (q.ao) {
      // ambient occlusion renders the scene itself (replaces RenderPass); half resolution keeps it ~1–2 ms
      ao = new N8AOPass(this.scene, this.camera, size.x, size.y);
      ao.configuration.aoRadius = 1.2; // metres: dashboard details, wheel arches, kerbs
      ao.configuration.distanceFalloff = 1;
      ao.configuration.intensity = 2.2;
      ao.configuration.halfRes = !q.aoFullRes;
      ao.configuration.gammaCorrection = false; // OutputPass converts at the end
      ao.setQualityMode(q.aoQuality);
      this.renderPass = ao;
    } else this.renderPass = new RenderPass(this.scene, this.camera);
    composer.addPass(this.renderPass);
    if (taa) {
      // right after the scene, while its depth is at hand (it scrubs NaN/Inf itself)
      const aoPass = ao as unknown as { beautyRenderTarget?: THREE.WebGLRenderTarget } | null;
      this.taa = new TaaPass(this.camera, size.x, size.y, () =>
        aoPass ? (aoPass.beautyRenderTarget?.depthTexture ?? null) : composer.readBuffer.depthTexture,
      );
      composer.addPass(this.taa);
    }
    composer.addPass(new ShaderPass(HdrClampShader));
    if (q.bloom) {
      // the threshold is in linear HDR (before tone mapping): a clear sky is 1.5–3 there, so 0.92 bloomed the whole
      // sky into a milky veil over the frame (brightness 205 vs 164 on Medium, half the contrast); only the sun,
      // headlights and floodlights pass 4
      this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.32, 0.45, 4);
      composer.addPass(this.bloom);
    } else this.bloom = null;
    // N8AO renders without hardware MSAA: smooth the edges with SMAA (its docs recommend it); or SMAA chosen
    if ((q.ao && aa !== 'taa') || aa === 'smaa') composer.addPass(new SMAAPass(size.x, size.y));
    composer.addPass(new OutputPass());
    if (q.grade) composer.addPass(new ShaderPass(GradeShader));
    composer.setSize(size.x, size.y);
    this.composer = composer;
  }

  resize = (): void => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.composer?.setSize(size.x, size.y);
    this.bloom?.setSize(size.x / 2, size.y / 2);
    this.taa?.reset();
    if (this.camera instanceof THREE.PerspectiveCamera) {
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
  };

  render(): void {
    if (this.contextLost || !this.scene || !this.camera) return;
    this.renderer.info.reset();
    if (this.composer) {
      if (this.taa) {
        const size = this.renderer.getDrawingBufferSize(_size);
        this.taa.jitter(size.x, size.y);
      }
      this.composer.render();
      this.taa?.unjitter();
    } else this.renderer.render(this.scene, this.camera);
  }

  /**
   * Feed frame times; lowers/raises the render resolution to hold ~73 % of the display rate (45 fps at 60 Hz, 88 at
   * 120 Hz), rarely and with hysteresis.
   */
  trackFrame(dtMs: number, now: number): void {
    this.frameTimes[this.frameIdx++ % this.frameTimes.length] = dtMs;
    // react quickly when too slow (1.5 s), cautiously when there is headroom (4 s); never on Ultra, which is about
    // picture quality only
    if (!settings.dynamicResolution || settings.quality === 'ultra' || now - this.lastDynChange < 1500 || this.frameIdx < this.frameTimes.length) return;
    let sum = 0;
    for (const t of this.frameTimes) sum += t;
    const avg = sum / this.frameTimes.length;
    let next = this.dynScale;
    const hz = Math.max(60, settings.refreshRate);
    if (avg > 1000 / (hz * 0.73)) next = Math.max(0.6, this.dynScale - 0.1);
    else if (avg < 1000 / (hz * 0.96) && this.dynScale < 1 && now - this.lastDynChange > 4000) next = Math.min(1, this.dynScale + 0.1);
    if (next !== this.dynScale) {
      this.dynScale = next;
      this.lastDynChange = now;
      this.frameIdx = 0; // judge the new resolution on fresh frames
      this.resize();
    }
  }

  get dynamicScale(): number {
    return this.dynScale;
  }

  dispose(): void {
    window.removeEventListener('resize', this.resize);
    this.composer?.dispose();
  }
}
