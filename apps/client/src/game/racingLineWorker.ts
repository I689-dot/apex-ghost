import type { TrackData } from '@apex/shared';
import { buildRacingLine } from './ai';

/** Builds a track's racing line off the main thread (racingLinePrep.ts). */
self.onmessage = (e: MessageEvent<TrackData>) => {
  const line = buildRacingLine(e.data);
  (self as unknown as Worker).postMessage(line, [line.x.buffer, line.z.buffer, line.offset.buffer, line.ds.buffer, line.curvature.buffer]);
};
