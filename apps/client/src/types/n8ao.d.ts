declare module 'n8ao' {
  import type { Camera, Color, Scene, WebGLRenderTarget } from 'three';
  import { Pass } from 'three/examples/jsm/postprocessing/Pass.js';

  /** Screen-space ambient occlusion pass that also renders the scene (replaces RenderPass). */
  export class N8AOPass extends Pass {
    constructor(scene: Scene, camera: Camera, width?: number, height?: number);
    camera: Camera;
    scene: Scene;
    beautyRenderTarget: WebGLRenderTarget;
    configuration: {
      aoRadius: number;
      distanceFalloff: number;
      intensity: number;
      color: Color;
      halfRes: boolean;
      depthAwareUpsampling: boolean;
      gammaCorrection: boolean;
      screenSpaceRadius: boolean;
      aoSamples: number;
      denoiseSamples: number;
    };
    setQualityMode(mode: 'Performance' | 'Low' | 'Medium' | 'High' | 'Ultra'): void;
    setSize(width: number, height: number): void;
  }
}
