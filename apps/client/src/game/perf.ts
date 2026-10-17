import type * as THREE from 'three';
import type { Connection } from '../net/connection';
import type { RemoteCarBuffer } from '../net/remote';
import { h } from '../ui/dom';

/** FPS, frame-time graph, draw calls, triangles, memory, ping and packet loss. */
export class PerfOverlay {
  readonly el: HTMLElement;
  private text: HTMLElement;
  private graph: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private times = new Float32Array(120);
  private idx = 0;
  private t0 = 0;
  private last = performance.now();
  private acc = 0;
  private frames = 0;
  private fps = 0;

  constructor() {
    this.text = h('pre');
    this.graph = h('canvas', { width: 240, height: 60 });
    this.g = this.graph.getContext('2d') as CanvasRenderingContext2D;
    this.el = h('div.perf', {}, this.text, this.graph);
    document.body.append(this.el);
  }

  begin(): void {
    this.t0 = performance.now();
  }

  end(renderer: THREE.WebGLRenderer, conn: Connection, remotes: Iterable<{ buffer: RemoteCarBuffer }>): void {
    const now = performance.now();
    const frame = now - this.last;
    this.last = now;
    this.times[this.idx++ % this.times.length] = frame;
    this.frames++;
    this.acc += frame;
    if (this.acc < 500) return;
    this.fps = (this.frames * 1000) / this.acc;
    this.frames = 0;
    this.acc = 0;
    let recv = 0;
    let lost = 0;
    for (const r of remotes) {
      recv += r.buffer.recvCount;
      lost += r.buffer.lossCount;
    }
    const info = renderer.info;
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    let max = 0;
    for (const t of this.times) max = Math.max(max, t);
    this.text.textContent = [
      `FPS ${this.fps.toFixed(0)}  max ${max.toFixed(1)} ms  cpu ${(now - this.t0).toFixed(1)} ms`,
      `draws ${info.render.calls}  tris ${(info.render.triangles / 1000).toFixed(0)}k`,
      `geo ${info.memory.geometries}  tex ${info.memory.textures}  prog ${info.programs?.length ?? 0}`,
      mem ? `heap ${(mem.usedJSHeapSize / 1048576).toFixed(0)} MB` : 'heap n/a',
      `ping ${conn.rtt.toFixed(0)} ms  loss ${recv + lost ? ((lost / (recv + lost)) * 100).toFixed(1) : '0.0'} %`,
    ].join('\n');
    const g = this.g;
    g.clearRect(0, 0, 240, 60);
    g.strokeStyle = 'rgba(255,255,255,0.25)';
    for (const ms of [16.7, 25, 33.3]) {
      const y = 60 - (ms / 50) * 60;
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(240, y);
      g.stroke();
    }
    for (let i = 0; i < this.times.length; i++) {
      const t = this.times[(this.idx + i) % this.times.length];
      g.fillStyle = t > 25 ? '#ff453a' : t > 20 ? '#ffd60a' : '#30d158';
      const hh = Math.min(60, (t / 50) * 60);
      g.fillRect(i * 2, 60 - hh, 2, hh);
    }
  }

  dispose(): void {
    this.el.remove();
  }
}
