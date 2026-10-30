import { h } from './dom';
import { uiAsset } from './images';

/** One shot of the reel: a photo with a camera move, or a car sweeping in over a blurred photo. */
export interface ReelShot {
  /** Photo file in assets/ui (photo_*.webp). */
  photo: string;
  /** pan: a slow sideways track; push: a dolly in; rise: a crane up; car: the car's studio render sweeps in. */
  move: 'pan' | 'push' | 'rise' | 'car';
  /** Car render URL (move 'car'). */
  car?: string;
  /** Lower-third caption. */
  kicker?: string;
  title?: string;
}

/**
 * A short TV-style intro reel for the boot, the race loading screen and the waiting screens: letterbox bars, slow camera
 * moves over the circuit photos (Ken Burns), the car's studio render sweeping in with a light streak, lower-third title
 * cards, a film grain. CSS animations only (transform / opacity / filter): the compositor keeps them smooth while the
 * page's JavaScript is busy building the world.
 */
export function cinematicReel(
  shots: ReelShot[],
  opts: { shotMs?: number; loop?: boolean; bars?: boolean; onEnd?: () => void } = {},
): {
  el: HTMLElement;
  dispose: () => void;
} {
  const shotMs = opts.shotMs ?? 4200;
  const el = h('div.reel', { style: `--shot: ${shotMs}ms` });
  if (opts.bars !== false) el.classList.add('bars');
  const items = shots.map((s) => {
    const shot = h(`div.reel-shot.m-${s.move}`, { style: `--img: url(${uiAsset(s.photo)})` });
    if (s.move === 'car' && s.car) {
      const car = h('img.reel-car', { src: s.car, alt: '', draggable: 'false' });
      car.addEventListener('error', () => car.remove());
      shot.append(h('div.reel-streak'), car);
    }
    if (s.title) shot.append(h('div.reel-caption', {}, s.kicker ? h('span.reel-kicker', { text: s.kicker }) : null, h('span.reel-title', { text: s.title })));
    return shot;
  });
  el.append(...items, h('div.reel-grain'), h('div.reel-vignette'));
  let i = -1;
  let timer = 0;
  const next = () => {
    if (i >= 0) items[i].classList.remove('on');
    i++;
    if (i >= items.length) {
      if (!opts.loop) {
        opts.onEnd?.();
        return;
      }
      i = 0;
    }
    const s = items[i];
    // restart its animations: a shot shown again plays its move from the start
    s.classList.remove('on');
    void s.offsetWidth;
    s.classList.add('on');
    timer = window.setTimeout(next, shotMs);
  };
  requestAnimationFrame(next);
  return {
    el,
    dispose: () => {
      clearTimeout(timer);
      el.remove();
    },
  };
}

/** The usual reel for a circuit: aerial, the car, the grid, pole, the straight. */
export function trackReel(map: string | undefined, trackName: string, car: { url: string; name: string } | null, kicker: string): ReelShot[] {
  const sfx = map && map !== 'nurburgring' ? `_${map}` : '';
  const shots: ReelShot[] = [{ photo: `photo_aerial${sfx}.webp`, move: 'rise', kicker, title: trackName }];
  if (car) shots.push({ photo: `photo_straight${sfx}.webp`, move: 'car', car: car.url, kicker: 'GT3', title: car.name });
  shots.push(
    { photo: `photo_grid${sfx}.webp`, move: 'pan' },
    { photo: `photo_pole${sfx}.webp`, move: 'push' },
    { photo: `photo_straight${sfx}.webp`, move: 'pan' },
  );
  return shots;
}
