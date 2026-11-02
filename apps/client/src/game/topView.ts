import * as THREE from 'three';

/** A car seen from straight above, and where its outline sits in its own frame (m; x = left, z = forward). */
export interface TopView {
  url: string;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/**
 * The car's own model rendered from straight above (nose up), once at load, for the car status instrument: every
 * car showed the same drawn outline. Rendered alone in a scene of its own, lit from above, into a transparent
 * picture; the object goes back where it was.
 */
export function renderTopView(renderer: THREE.WebGLRenderer, object: THREE.Object3D, pxWide = 120): TopView | null {
  const parent = object.parent;
  const pos = object.position.clone();
  const rot = object.quaternion.clone();
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x404048, 2.2));
  const sun = new THREE.DirectionalLight(0xffffff, 2.4);
  sun.position.set(-1.5, 6, 2.5);
  scene.add(sun);
  object.position.set(0, 0, 0);
  object.quaternion.identity();
  scene.add(object);
  object.updateMatrixWorld(true);
  // the car's meshes only: its smoke, light targets and such reach metres away and shrank the car to a dot
  const box = new THREE.Box3();
  const mb = new THREE.Box3();
  object.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.visible || (o as THREE.Points).isPoints) return;
    m.geometry.computeBoundingBox();
    if (!m.geometry.boundingBox) return;
    mb.copy(m.geometry.boundingBox).applyMatrix4(m.matrixWorld);
    if (mb.min.x < -3 || mb.max.x > 3 || mb.min.z < -4 || mb.max.z > 4 || mb.max.y > 3) return;
    box.union(mb);
  });
  let out: TopView | null = null;
  if (!box.isEmpty()) {
    const w = box.max.x - box.min.x;
    const l = box.max.z - box.min.z;
    const W = pxWide * 2;
    const H = Math.round((W * l) / w);
    // looking down with +z (forward) up the picture: the picture's right is the car's right (−x)
    const cam = new THREE.OrthographicCamera(-w / 2, w / 2, l / 2, -l / 2, 0.1, box.max.y + 10);
    cam.up.set(0, 0, 1);
    cam.position.set((box.min.x + box.max.x) / 2, box.max.y + 5, (box.min.z + box.max.z) / 2);
    cam.lookAt(cam.position.x, 0, cam.position.z);
    const rt = new THREE.WebGLRenderTarget(W, H, { samples: 4 });
    rt.texture.colorSpace = THREE.SRGBColorSpace;
    const prevTarget = renderer.getRenderTarget();
    const prevClear = renderer.getClearColor(new THREE.Color());
    const prevAlpha = renderer.getClearAlpha();
    renderer.setRenderTarget(rt);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(scene, cam);
    const px = new Uint8Array(W * H * 4);
    renderer.readRenderTargetPixels(rt, 0, 0, W, H, px);
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(prevClear, prevAlpha);
    rt.dispose();
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const g = c.getContext('2d') as CanvasRenderingContext2D;
    const img = g.createImageData(W, H);
    // the render target's rows run bottom-up
    for (let y = 0; y < H; y++) img.data.set(px.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
    g.putImageData(img, 0, 0);
    out = { url: c.toDataURL('image/png'), minX: box.min.x, maxX: box.max.x, minZ: box.min.z, maxZ: box.max.z };
  }
  object.position.copy(pos);
  object.quaternion.copy(rot);
  if (parent) parent.add(object);
  else scene.remove(object);
  object.updateMatrixWorld(true);
  return out;
}

/** The car's line drawing from above (TopLines): white lines on transparent, W×H, and the outline's frame (m). */
export interface TopLines {
  /** Line strength per pixel, 0…255, rows top (nose) to bottom. */
  lines: Uint8Array;
  width: number;
  height: number;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/**
 * The car's own model as a technical line drawing from straight above (iRacing's damage diagram): rendered twice
 * top-down, its surface directions and its height, and drawn where either jumps (the silhouette, panel creases,
 * the wing, the cockpit, the wheels). Once at load; each car gets its own.
 */
export function renderTopLines(renderer: THREE.WebGLRenderer, object: THREE.Object3D, pxWide = 220): TopLines | null {
  const parent = object.parent;
  const pos = object.position.clone();
  const rot = object.quaternion.clone();
  const scene = new THREE.Scene();
  object.position.set(0, 0, 0);
  object.quaternion.identity();
  scene.add(object);
  object.updateMatrixWorld(true);
  const box = new THREE.Box3();
  const mb = new THREE.Box3();
  object.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.visible || (o as THREE.Points).isPoints) return;
    m.geometry.computeBoundingBox();
    if (!m.geometry.boundingBox) return;
    mb.copy(m.geometry.boundingBox).applyMatrix4(m.matrixWorld);
    if (mb.min.x < -3 || mb.max.x > 3 || mb.min.z < -4 || mb.max.z > 4 || mb.max.y > 3) return;
    box.union(mb);
  });
  let out: TopLines | null = null;
  if (!box.isEmpty()) {
    const w = box.max.x - box.min.x;
    const l = box.max.z - box.min.z;
    const W = pxWide;
    const H = Math.round((W * l) / w);
    const cam = new THREE.OrthographicCamera(-w / 2, w / 2, l / 2, -l / 2, 0.1, box.max.y - box.min.y + 10);
    cam.up.set(0, 0, 1);
    cam.position.set((box.min.x + box.max.x) / 2, box.max.y + 5, (box.min.z + box.max.z) / 2);
    cam.lookAt(cam.position.x, 0, cam.position.z);
    const near = 5;
    const far = box.max.y - box.min.y + 5;
    cam.near = near - 0.1;
    cam.far = far + 0.1;
    cam.updateProjectionMatrix();
    const rt = new THREE.WebGLRenderTarget(W, H);
    const prevTarget = renderer.getRenderTarget();
    const prevClear = renderer.getClearColor(new THREE.Color());
    const prevAlpha = renderer.getClearAlpha();
    const prevOverride = scene.overrideMaterial;
    const read = (mat: THREE.Material) => {
      scene.overrideMaterial = mat;
      renderer.setRenderTarget(rt);
      renderer.setClearColor(0x000000, 0);
      renderer.clear();
      renderer.render(scene, cam);
      const px = new Uint8Array(W * H * 4);
      renderer.readRenderTargetPixels(rt, 0, 0, W, H, px);
      return px;
    };
    const normalMat = new THREE.MeshNormalMaterial({ side: THREE.DoubleSide });
    // height as a colour: 0 at the ground … 1 at the roof (a shader of its own: the depth packing is not needed)
    const heightMat = new THREE.ShaderMaterial({
      side: THREE.DoubleSide,
      uniforms: { lo: { value: box.min.y }, hi: { value: box.max.y } },
      vertexShader: 'varying float vy; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vy = w.y; gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader:
        'uniform float lo; uniform float hi; varying float vy; void main() { float u = clamp((vy - lo) / max(hi - lo, 0.01), 0.0, 1.0); gl_FragColor = vec4(u, fract(u * 255.0), 0.0, 1.0); }',
    });
    const nrm = read(normalMat);
    const hgt = read(heightMat);
    scene.overrideMaterial = prevOverride;
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(prevClear, prevAlpha);
    rt.dispose();
    normalMat.dispose();
    heightMat.dispose();
    const range = box.max.y - box.min.y;
    // rows bottom-up in the target: flipped as they are read
    const at = (x: number, y: number) => ((H - 1 - y) * W + x) * 4;
    const lines = new Uint8Array(W * H);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const i = at(x, y);
        const solid = nrm[i + 3] > 0;
        let e = 0;
        for (const [dx, dy] of [
          [1, 0],
          [0, 1],
          [1, 1],
          [1, -1],
        ]) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const j = at(nx, ny);
          const other = nrm[j + 3] > 0;
          if (solid !== other) {
            e = Math.max(e, 1);
            continue;
          }
          if (!solid) continue;
          // a crease: the surface turns sharply
          const dn = (Math.abs(nrm[i] - nrm[j]) + Math.abs(nrm[i + 1] - nrm[j + 1]) + Math.abs(nrm[i + 2] - nrm[j + 2])) / 255;
          // a step: one part lies over another (the wing over the deck, the mirrors, the wheels under the arches)
          const dh = (Math.abs(hgt[i] - hgt[j]) / 255) * range;
          e = Math.max(e, Math.min(1, Math.max((dn - 0.35) / 0.4, (dh - 0.03) / 0.06)));
        }
        lines[y * W + x] = Math.round(Math.max(0, e) * 255);
      }
    out = { lines, width: W, height: H, minX: box.min.x, maxX: box.max.x, minZ: box.min.z, maxZ: box.max.z };
  }
  object.position.copy(pos);
  object.quaternion.copy(rot);
  if (parent) parent.add(object);
  else scene.remove(object);
  object.updateMatrixWorld(true);
  return out;
}
