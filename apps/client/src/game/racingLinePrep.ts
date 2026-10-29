import type { TrackData } from '@apex/shared';
import { primeRacingLine, type RacingLine } from './ai';

/**
 * The racing line (bots, the braking-line assist, road wear) takes seconds to optimise on a phone. A worker builds it
 * while the session downloads the track and cars; the session awaits this before the first use. Without workers (or
 * if it fails) racingLineFor builds it on the main thread as before.
 */
export function prepareRacingLine(track: TrackData): Promise<void> {
  return new Promise((resolve) => {
    let w: Worker;
    try {
      w = new Worker(new URL('./racingLineWorker.ts', import.meta.url), { type: 'module' });
    } catch {
      resolve();
      return;
    }
    w.onmessage = (e: MessageEvent<RacingLine>) => {
      primeRacingLine(track, e.data);
      w.terminate();
      resolve();
    };
    w.onerror = () => {
      w.terminate();
      resolve();
    };
    w.postMessage(track);
  });
}
