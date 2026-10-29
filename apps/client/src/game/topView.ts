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
