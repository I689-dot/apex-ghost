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
import { QUALITY, detectQuality, saveSettings, settings, type QualityConfig } from '../settings';
import { t } from '../i18n';

/** Owns the WebGL renderer and the (cheap) post-processing chain. */
export class Graphics {
  readonly renderer: THREE.WebGLRenderer;
  readonly canvas: HTMLCanvasElement;
  quality: QualityConfig;
  private composer: EffectComposer | null = null;
  private renderPass: RenderPass | N8AOPass | null = null;
  private bloom: UnrealBloomPass | null = null;
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
    this.quality = QUALITY[settings.quality];
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
    return Math.min(window.devicePixelRatio, this.quality.pixelRatioCap) * settings.resolutionScale * this.dynScale;
  }

  setScene(scene: THREE.Scene, camera: THREE.Camera): void {
    this.scene = scene;
    this.camera = camera;
    this.rebuildPipeline();
  }

  /** Switch the camera without rebuilding the post-processing chain (cinematic ↔ cockpit). */
  setCamera(camera: THREE.Camera): void {
    this.camera = camera;
    if (this.renderPass) this.renderPass.camera = camera;
    this.resize();
  }

  applyQuality(): void {
    this.quality = QUALITY[settings.quality];
    this.dynScale = 1;
    this.resize();
    this.rebuildPipeline();
  }

  private rebuildPipeline(): void {
    this.composer?.dispose();
    this.composer = null;
    if (!this.scene || !this.camera) return;
    const q = this.quality;
    this.renderer.shadowMap.enabled = q.shadows;
    this.renderer.shadowMap.type = q.softShadows ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    // Low/Medium: render straight to the (natively multisampled) canvas, tone mapping in the material shaders
    if (!q.bloom) return;
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: q.antialias === 'msaa' ? 4 : 0 });
    const composer = new EffectComposer(this.renderer, rt);
    composer.setPixelRatio(1);
    if (q.ao) {
      // ambient occlusion renders the scene itself (replaces RenderPass); half resolution keeps it ~1–2 ms
      const ao = new N8AOPass(this.scene, this.camera, size.x, size.y);
      ao.configuration.aoRadius = 1.2; // metres: dashboard details, wheel arches, kerbs
      ao.configuration.distanceFalloff = 1;
      ao.configuration.intensity = 2.2;
      ao.configuration.halfRes = true;
      ao.configuration.gammaCorrection = false; // OutputPass converts at the end
      ao.setQualityMode(settings.quality === 'ultra' ? 'Medium' : 'Low');
      this.renderPass = ao;
    } else this.renderPass = new RenderPass(this.scene, this.camera);
    composer.addPass(this.renderPass);
    composer.addPass(new ShaderPass(HdrClampShader));
    if (q.bloom) {
      // the threshold is in linear HDR (before tone mapping): a clear sky is 1.5–3 there, so 0.92 bloomed the whole
      // sky into a milky veil over the frame (brightness 205 vs 164 on Medium, half the contrast); only the sun,
      // headlights and floodlights pass 4
      this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.32, 0.45, 4);
      composer.addPass(this.bloom);
    } else this.bloom = null;
    // N8AO renders without hardware MSAA: smooth the edges with SMAA (its docs recommend it)
    if (q.ao) composer.addPass(new SMAAPass(size.x, size.y));
    composer.addPass(new OutputPass());
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
    if (this.camera instanceof THREE.PerspectiveCamera) {
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
  };

  render(): void {
    if (this.contextLost || !this.scene || !this.camera) return;
    this.renderer.info.reset();
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  /** Feed frame times; lowers/raises the render resolution to hold ~45+ fps (rarely, with hysteresis). */
  trackFrame(dtMs: number, now: number): void {
    this.frameTimes[this.frameIdx++ % this.frameTimes.length] = dtMs;
    // react quickly when too slow (1.5 s), cautiously when there is headroom (4 s)
    if (!settings.dynamicResolution || now - this.lastDynChange < 1500 || this.frameIdx < this.frameTimes.length) return;
    let sum = 0;
    for (const t of this.frameTimes) sum += t;
    const avg = sum / this.frameTimes.length;
    let next = this.dynScale;
    if (avg > 1000 / 44) next = Math.max(0.6, this.dynScale - 0.1);
    else if (avg < 1000 / 58 && this.dynScale < 1 && now - this.lastDynChange > 4000) next = Math.min(1, this.dynScale + 0.1);
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
