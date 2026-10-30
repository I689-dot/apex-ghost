import * as THREE from 'three';

/**
 * Virtual rear-view mirror at the top of the screen (as in the F1 games' and ACC's "virtual mirror"): a camera at
 * the back of your car looking back, rendered into its own target and drawn flipped left/right, as a mirror shows
 * it. Drawn straight to the canvas after the post-processing chain (no bloom or AO: it is small), with the renderer's
 * own tone mapping so it matches the frame. On Low it refreshes every other frame.
 */
export class RearMirror {
  readonly camera = new THREE.PerspectiveCamera(30, 4, 0.4, 600);
  private readonly anchor = new THREE.Object3D();
  private target: THREE.WebGLRenderTarget | null = null;
  private readonly quad: THREE.Mesh;
  private readonly quadScene = new THREE.Scene();
  private readonly quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private frame = 0;
  private readonly clear = new THREE.Color();
  visible = true;
  /** Render every n-th frame. */
  every = 1;

  constructor(carObject: THREE.Object3D, dims: { length: number; width: number; height: number }) {
    // just behind the roof's trailing edge, a little higher than the roof: the rear wing stays out of the picture
    this.anchor.position.set(0, dims.height + 0.12, -dims.length * 0.5 - 0.15);
    carObject.add(this.anchor);
    this.anchor.add(this.camera);
    // cameras look down −Z, the car's back is −Z: no turn needed; a slight downward pitch to the road behind
    this.camera.rotation.set(-0.045, 0, 0);
    const mat = new THREE.MeshBasicMaterial({ map: null, depthTest: false, depthWrite: false });
    const geo = new THREE.PlaneGeometry(2, 2);
    // a mirror: flip left/right in the texture coordinates
    const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i));
    this.quad = new THREE.Mesh(geo, mat);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
  }

  /** The mirror's rectangle in CSS pixels (top centre). */
  static rect(): { x: number; y: number; w: number; h: number } {
    const w = Math.round(Math.min(window.innerWidth * 0.34, 560));
    const h = Math.round(w / 4.2);
    return { x: Math.round((window.innerWidth - w) / 2), y: 10, w, h };
  }

  /** After the main frame: render the view behind and draw it into the top of the canvas. */
  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene): void {
    if (!this.visible) return;
    const r = RearMirror.rect();
    const pr = renderer.getPixelRatio();
    const w = Math.max(64, Math.round(r.w * pr));
    const hgt = Math.max(16, Math.round(r.h * pr));
    if (!this.target || this.target.width !== w || this.target.height !== hgt) {
      this.target?.dispose();
      this.target = new THREE.WebGLRenderTarget(w, hgt, { type: THREE.HalfFloatType, samples: 4 });
      (this.quad.material as THREE.MeshBasicMaterial).map = this.target.texture;
      (this.quad.material as THREE.MeshBasicMaterial).needsUpdate = true;
    }
    if (this.camera.aspect !== r.w / r.h) {
      this.camera.aspect = r.w / r.h;
      this.camera.updateProjectionMatrix();
    }
    const prevTarget = renderer.getRenderTarget();
    renderer.getClearColor(this.clear);
    const clearAlpha = renderer.getClearAlpha();
    const prevAuto = renderer.autoClear;
    const shadowAuto = renderer.shadowMap.autoUpdate;
    if (this.frame++ % this.every === 0) {
      // the sun's shadow map was drawn for this frame already
      renderer.shadowMap.autoUpdate = false;
      renderer.setRenderTarget(this.target);
      renderer.autoClear = true;
      renderer.render(scene, this.camera);
      renderer.shadowMap.autoUpdate = shadowAuto;
    }
    renderer.setRenderTarget(null);
    renderer.autoClear = false;
    const size = renderer.getSize(new THREE.Vector2());
    // a thin dark frame, then the picture (viewport y counts from the bottom)
    const yb = size.y - r.y - r.h;
    renderer.setScissorTest(true);
    renderer.setScissor(r.x - 2, yb - 2, r.w + 4, r.h + 4);
    renderer.setViewport(r.x - 2, yb - 2, r.w + 4, r.h + 4);
    renderer.setClearColor(0x0b0c0e, 1);
    renderer.clear(true, true, false);
    renderer.setScissor(r.x, yb, r.w, r.h);
    renderer.setViewport(r.x, yb, r.w, r.h);
    renderer.render(this.quadScene, this.quadCam);
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, size.x, size.y);
    renderer.autoClear = prevAuto;
    renderer.setClearColor(this.clear, clearAlpha);
    renderer.setRenderTarget(prevTarget);
  }

  dispose(): void {
    this.target?.dispose();
    this.quad.geometry.dispose();
    (this.quad.material as THREE.Material).dispose();
    this.anchor.removeFromParent();
  }
}
