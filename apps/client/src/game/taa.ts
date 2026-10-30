import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

/**
 * Temporal anti-aliasing (Settings → Graphics → Anti-aliasing: TAA), after Karis' "High Quality Temporal
 * Supersampling" (SIGGRAPH 2014) and Playdead's INSIDE TAA:
 *  - the camera is jittered by a sub-pixel Halton(2,3) offset every frame (8 positions), so edges, thin fences and
 *    distant detail are sampled at different points over time;
 *  - each pixel's history is found by reprojection: its world position from the depth buffer, projected with last
 *    frame's camera (no velocity buffer: the world is static; your own car, which moves with the camera, is
 *    reprojected with its own motion; other cars rely on the clamp below);
 *  - the history is sampled with a Catmull-Rom filter (sharp, no blur creeping in over frames) and clipped to the
 *    current frame's 3×3 neighbourhood colour box in YCoCg (variance clipping), which stops ghosting;
 *  - blended 1/10 new, less history when the picture moves fast; a light sharpen follows.
 * The cleanest way to smooth distant geometry and texture shimmer on a moving camera, where MSAA misses textures and
 * thin alpha-tested things (grass, trees, fences) and SMAA shimmers.
 */

const HALTON: [number, number][] = [];
const halton = (i: number, b: number) => {
  let f = 1;
  let r = 0;
  while (i > 0) {
    f /= b;
    r += f * (i % b);
    i = Math.floor(i / b);
  }
  return r;
};
for (let i = 1; i <= 8; i++) HALTON.push([halton(i, 2) - 0.5, halton(i, 3) - 0.5]);

const TaaShader = {
  uniforms: {
    tCurrent: { value: null as THREE.Texture | null },
    tHistory: { value: null as THREE.Texture | null },
    tDepth: { value: null as THREE.Texture | null },
    uInvViewProj: { value: new THREE.Matrix4() },
    uPrevViewProj: { value: new THREE.Matrix4() },
    uTexel: { value: new THREE.Vector2() },
    uCarPos: { value: new THREE.Vector3() },
    uCarDelta: { value: new THREE.Vector3() },
    uCarRadius: { value: 0 },
    uReset: { value: 1 },
    uSharpen: { value: 0.18 },
  },
  vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tCurrent;
    uniform sampler2D tHistory;
    uniform sampler2D tDepth;
    uniform mat4 uInvViewProj;
    uniform mat4 uPrevViewProj;
    uniform vec2 uTexel;
    uniform vec3 uCarPos;
    uniform vec3 uCarDelta;
    uniform float uCarRadius;
    uniform float uReset;
    uniform float uSharpen;
    varying vec2 vUv;

    vec3 toYCoCg(vec3 c) { return vec3(0.25 * c.r + 0.5 * c.g + 0.25 * c.b, 0.5 * c.r - 0.5 * c.b, -0.25 * c.r + 0.5 * c.g - 0.25 * c.b); }
    vec3 fromYCoCg(vec3 c) { return vec3(c.x + c.y - c.z, c.x + c.z, c.x - c.y - c.z); }
    // HDR input: weigh by 1/(1+luma) so bright pixels don't dominate the box (Karis)
    vec3 tonemap(vec3 c) { return c / (1.0 + max(c.r, max(c.g, c.b))); }
    vec3 untonemap(vec3 c) { return c / max(1e-4, 1.0 - max(c.r, max(c.g, c.b))); }

    // 5-tap Catmull-Rom (Jimenez): a sharp history fetch
    vec3 historyCR(vec2 uv) {
      vec2 res = 1.0 / uTexel;
      vec2 pos = uv * res;
      vec2 c = floor(pos - 0.5) + 0.5;
      vec2 f = pos - c;
      vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
      vec2 w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
      vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f));
      vec2 w3 = f * f * (-0.5 + 0.5 * f);
      vec2 w12 = w1 + w2;
      vec2 o12 = w2 / w12;
      vec2 t0 = (c - 1.0) * uTexel;
      vec2 t3 = (c + 2.0) * uTexel;
      vec2 t12 = (c + o12) * uTexel;
      vec3 r = vec3(0.0);
      r += texture2D(tHistory, vec2(t12.x, t0.y)).rgb * w12.x * w0.y;
      r += texture2D(tHistory, vec2(t0.x, t12.y)).rgb * w0.x * w12.y;
      r += texture2D(tHistory, vec2(t12.x, t12.y)).rgb * w12.x * w12.y;
      r += texture2D(tHistory, vec2(t3.x, t12.y)).rgb * w3.x * w12.y;
      r += texture2D(tHistory, vec2(t12.x, t3.y)).rgb * w12.x * w3.y;
      float wsum = w12.x * w0.y + w0.x * w12.y + w12.x * w12.y + w3.x * w12.y + w12.x * w3.y;
      return max(r / wsum, 0.0);
    }

    // the physical sky can overflow half floats: a NaN or Inf in the history would stay there for good
    vec3 fetch(vec2 uv) {
      vec3 c = texture2D(tCurrent, uv).rgb;
      if (any(isnan(c)) || any(isinf(c))) return vec3(0.0);
      return clamp(c, 0.0, 48.0);
    }

    void main() {
      vec3 cur = fetch(vUv);
      // neighbourhood statistics (YCoCg, tonemapped), the closest depth for the reprojection
      vec3 m1 = vec3(0.0);
      vec3 m2 = vec3(0.0);
      vec3 cross = vec3(0.0);
      float dMin = 1.0;
      vec2 dUv = vUv;
      for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
          vec2 o = vec2(float(x), float(y)) * uTexel;
          vec3 c = fetch(vUv + o);
          if (abs(x) + abs(y) == 1) cross += c;
          vec3 s = toYCoCg(tonemap(c));
          m1 += s;
          m2 += s * s;
          float d = texture2D(tDepth, vUv + o).x;
          if (d < dMin) {
            dMin = d;
            dUv = vUv + o;
          }
        }
      }
      // a light sharpen against the softness TAA brings
      vec3 sharp = max(cur + (cur - cross * 0.25) * uSharpen, 0.0);
      if (uReset > 0.5) {
        gl_FragColor = vec4(sharp, 1.0);
        return;
      }
      vec3 mean = m1 / 9.0;
      vec3 sigma = sqrt(max(m2 / 9.0 - mean * mean, 0.0));
      vec3 boxMin = mean - 1.1 * sigma;
      vec3 boxMax = mean + 1.1 * sigma;

      // reprojection: world position from depth, into last frame's camera
      // (the sky, at the far plane, is taken just short of it: reprojected by the camera's rotation)
      vec4 ndc = vec4(dUv * 2.0 - 1.0, min(dMin, 0.99999) * 2.0 - 1.0, 1.0);
      vec4 wp = uInvViewProj * ndc;
      vec3 world = wp.xyz / wp.w;
      // my car moved with the camera: where this point of it was last frame
      if (uCarRadius > 0.0 && distance(world, uCarPos) < uCarRadius) world -= uCarDelta;
      vec4 prev = uPrevViewProj * vec4(world, 1.0);
      vec2 prevUv = prev.xy / prev.w * 0.5 + 0.5 + (vUv - dUv);
      bool off = any(lessThan(prevUv, vec2(0.0))) || any(greaterThan(prevUv, vec2(1.0)));
      vec3 hist = off ? sharp : historyCR(prevUv);

      // clip the history towards the box centre (variance clipping)
      vec3 h = toYCoCg(tonemap(hist));
      vec3 center = 0.5 * (boxMax + boxMin);
      vec3 ext = 0.5 * (boxMax - boxMin) + 1e-4;
      vec3 v = h - center;
      vec3 a = abs(v / ext);
      float ma = max(a.x, max(a.y, a.z));
      if (ma > 1.0) h = center + v / ma;
      hist = untonemap(fromYCoCg(h));

      // more of the new frame when the picture moves fast (less smear), and off-screen history is gone
      float motion = length((prevUv - vUv) / uTexel);
      float blend = off ? 1.0 : mix(0.1, 0.25, clamp(motion / 24.0, 0.0, 1.0));
      // blend in tonemapped space (Karis): no fireflies from bright pixels
      vec3 tc = tonemap(sharp);
      vec3 th = tonemap(hist);
      vec3 res = untonemap(mix(th, tc, blend));
      gl_FragColor = vec4(res, 1.0);
    }`,
};

export class TaaPass extends Pass {
  private readonly quad: FullScreenQuad;
  private readonly copyQuad: FullScreenQuad;
  private readonly material: THREE.ShaderMaterial;
  private history: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];
  private idx = 0;
  private frame = 0;
  private readonly prevViewProj = new THREE.Matrix4();
  private readonly unjittered = new THREE.Matrix4();
  private hasPrev = false;
  private readonly prevCar = new THREE.Vector3();
  private readonly car = new THREE.Vector3();
  private carSet = false;
  private lastCamera: THREE.Camera | null = null;

  constructor(
    private camera: THREE.Camera,
    width: number,
    height: number,
    /** The depth of the frame being resolved (the scene pass' target). */
    private readonly depth: () => THREE.Texture | null,
  ) {
    super();
    this.material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.clone(TaaShader.uniforms),
      vertexShader: TaaShader.vertexShader,
      fragmentShader: TaaShader.fragmentShader,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new FullScreenQuad(this.material);
    this.copyQuad = new FullScreenQuad(new THREE.MeshBasicMaterial({ toneMapped: false, depthTest: false, depthWrite: false }));
    const rt = () => new THREE.WebGLRenderTarget(width, height, { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    this.history = [rt(), rt()];
  }

  setCamera(camera: THREE.Camera): void {
    this.camera = camera;
  }

  /** Your car's position this frame (it moves with the camera: reprojected with its own motion). */
  setCar(pos: THREE.Vector3 | null): void {
    if (!pos) {
      this.carSet = false;
      return;
    }
    this.car.copy(pos);
    this.carSet = true;
  }

  /** Start over (camera cut, resize): no history to blend. */
  reset(): void {
    this.hasPrev = false;
  }

  /** Before the frame is drawn: the camera's sub-pixel jitter. */
  jitter(width: number, height: number): void {
    const cam = this.camera as THREE.PerspectiveCamera;
    if (!cam.isPerspectiveCamera) return;
    if (cam !== this.lastCamera) {
      (this.lastCamera as THREE.PerspectiveCamera | null)?.clearViewOffset?.();
      this.lastCamera = cam;
      this.hasPrev = false;
    }
    cam.clearViewOffset();
    cam.updateWorldMatrix(true, false);
    this.unjittered.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    const [jx, jy] = HALTON[this.frame++ % HALTON.length];
    cam.setViewOffset(width, height, jx, jy, width, height);
  }

  /** After the frame: the camera without jitter (the mirror, raycasts and the next frame's base). */
  unjitter(): void {
    (this.camera as THREE.PerspectiveCamera).clearViewOffset?.();
  }

  override setSize(width: number, height: number): void {
    for (const h of this.history) h.setSize(width, height);
    this.hasPrev = false;
  }

  override render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget): void {
    const u = this.material.uniforms;
    const depth = this.depth();
    const read = this.history[this.idx];
    const write = this.history[1 - this.idx];
    u.tCurrent.value = readBuffer.texture;
    u.tHistory.value = read.texture;
    u.tDepth.value = depth;
    u.uTexel.value.set(1 / readBuffer.width, 1 / readBuffer.height);
    u.uInvViewProj.value.copy(this.unjittered).invert();
    u.uPrevViewProj.value.copy(this.prevViewProj);
    u.uReset.value = this.hasPrev && depth ? 0 : 1;
    // my car: its motion since the last frame (a teleport — a reset — is a cut)
    const moved = this.carSet ? this.car.distanceTo(this.prevCar) : 0;
    u.uCarRadius.value = this.carSet && moved < 8 ? 3.2 : 0;
    u.uCarPos.value.copy(this.car);
    u.uCarDelta.value.subVectors(this.car, this.prevCar);
    if (this.carSet && moved >= 8) u.uReset.value = 1;
    renderer.setRenderTarget(write);
    this.quad.render(renderer);
    (this.copyQuad.material as THREE.MeshBasicMaterial).map = write.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.copyQuad.render(renderer);
    this.idx = 1 - this.idx;
    this.prevViewProj.copy(this.unjittered);
    this.prevCar.copy(this.car);
    this.hasPrev = true;
  }

  override dispose(): void {
    for (const h of this.history) h.dispose();
    this.material.dispose();
    this.quad.dispose();
    (this.copyQuad.material as THREE.Material).dispose();
    this.copyQuad.dispose();
  }
}
