import type { TrackData } from '@apex/shared';
import { loadTrackFile } from '../game/assets';

/**
 * A layout's shape as an SVG outline (the lobby's circuit cards and preview), drawn from its centreline seen from
 * above, the start/finish marked. Built once per layout from the track file (cached by the asset loader).
 */
const outlines = new Map<string, string>();
const pending = new Map<string, Promise<string | null>>();

function outlineOf(td: TrackData): string {
  const cl = td.centerline;
  const n = cl.length / 3;
  // every point would be ~5000 on the 25 km layout: a point every few metres is plenty for a card
  const step = Math.max(1, Math.floor(n / 900));
  let x0 = Infinity;
  let x1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  for (let i = 0; i < n; i += step) {
    x0 = Math.min(x0, cl[i * 3]);
    x1 = Math.max(x1, cl[i * 3]);
    z0 = Math.min(z0, cl[i * 3 + 2]);
    z1 = Math.max(z1, cl[i * 3 + 2]);
  }
  const size = Math.max(x1 - x0, z1 - z0) || 1;
  const pad = 6;
  const k = (100 - pad * 2) / size;
  const ox = pad + (100 - pad * 2 - (x1 - x0) * k) / 2;
  const oz = pad + (100 - pad * 2 - (z1 - z0) * k) / 2;
  const px = (i: number) => (ox + (cl[i * 3] - x0) * k).toFixed(2);
  const pz = (i: number) => (oz + (cl[i * 3 + 2] - z0) * k).toFixed(2);
  let d = `M${px(0)} ${pz(0)}`;
  for (let i = step; i < n; i += step) d += `L${px(i)} ${pz(i)}`;
  d += 'Z';
  return (
    `<svg class="trk-outline" viewBox="0 0 100 100" aria-hidden="true">` +
    `<path class="trk-shadow" d="${d}"/><path class="trk-line" d="${d}"/>` +
    `<circle class="trk-start" cx="${px(0)}" cy="${pz(0)}" r="2.6"/></svg>`
  );
}

/** The outline's SVG if it is ready; otherwise null, and `onReady` is called once it is. */
export function trackOutline(id: string, onReady: () => void): string | null {
  const ready = outlines.get(id);
  if (ready) return ready;
  if (!pending.has(id))
    pending.set(
      id,
      loadTrackFile(id).then(
        (td) => {
          const svg = outlineOf(td);
          outlines.set(id, svg);
          onReady();
          return svg;
        },
        () => {
          pending.delete(id);
          return null;
        },
      ),
    );
  return null;
}
