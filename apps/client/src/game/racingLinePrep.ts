import type { TrackData } from '@apex/shared';
import { primeRacingLine, racingLineFromFile, type RacelineFile, type RacingLine } from './ai';
import { url } from './assets';

/**
 * The racing line (bots, the braking-line assist, road wear). Each layout ships its line, optimised offline for the
 * lap time with the kerbs used (assets/racelines/<layout>.json, tools/sim/raceline.ts). Without it (a layout not
 * done yet, or the file is for another version of it) a worker builds the minimum-curvature line while the session
 * downloads the track and cars (seconds on a phone); without workers, racingLineFor builds it on the main thread.
 */
export async function prepareRacingLine(track: TrackData): Promise<void> {
  try {
    const res = await fetch(url(`assets/racelines/${track.id}.json`));
    if (res.ok) {
      const line = racingLineFromFile(track, (await res.json()) as RacelineFile);
      if (line) {
        primeRacingLine(track, line);
        return;
      }
    }
  } catch {
    // no file: build it below
  }
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
