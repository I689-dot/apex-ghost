import './styles.css';
import { App } from './app';
import { h } from './ui/dom';
import { setLang, t } from './i18n';
import { settings } from './settings';
import { IS_APP, isMobileDevice } from './mobile/platform';
import { installScreen } from './mobile/installScreen';
import { initAppShell } from './mobile/appShell';
import { initGamepad } from './input/gamepad';
import { cinematicReel } from './ui/reel';
import { heroUrl } from './ui/images';

/**
 * The intro when the game opens (once per visit; a click or a key skips it): the logo over a short reel of the
 * circuit and a car, then the menu. Skipped by the e2e tools (?nointro) and with reduced motion.
 */
function playIntro(): void {
  let seen = false;
  try {
    seen = sessionStorage.getItem('apexghost.intro') === '1' || new URLSearchParams(location.search).has('nointro') || navigator.webdriver;
    sessionStorage.setItem('apexghost.intro', '1');
  } catch {
    /* storage blocked: play it */
  }
  if (seen || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const intro = h('div.intro');
  const end = () => {
    if (intro.classList.contains('out')) return;
    intro.classList.add('out');
    window.removeEventListener('keydown', end, true);
    setTimeout(() => {
      reel.dispose();
      intro.remove();
    }, 800);
  };
  const reel = cinematicReel(
    [
      { photo: 'photo_aerial.webp', move: 'rise' },
      {
        photo: 'photo_hero.webp',
        move: 'car',
        car: heroUrl({ id: '2024_porsche_992_gt3_r' } as Parameters<typeof heroUrl>[0]),
        kicker: 'GT3',
        title: 'APEX GHOST',
      },
      { photo: 'photo_grid.webp', move: 'pan', kicker: t('ONLINE · SOLO'), title: t('Ready to race') },
    ],
    { shotMs: 2600, onEnd: end },
  );
  intro.append(
    reel.el,
    h('div.intro-logo', {}, h('div.logo', {}, h('span', { text: 'APEX' }), h('b', { text: 'GHOST' }))),
    h('div.intro-skip', { text: t('Click or press any key to skip') }),
  );
  intro.addEventListener('click', end);
  window.addEventListener('keydown', end, true);
  document.body.append(intro);
}

setLang(settings.language === 'es' ? 'es' : 'en');
const root = document.getElementById('app') as HTMLElement;

if (!IS_APP && isMobileDevice()) {
  // the website stays desktop-only (keyboard driving); phones get the app instead
  root.append(installScreen());
} else {
  try {
    if (IS_APP) initAppShell();
    const app = new App(root);
    initGamepad();
    app.showMenu();
    playIntro();
    if (import.meta.env.DEV) (window as unknown as { __app?: App }).__app = app; // e2e tools
  } catch (e) {
    root.append(h('div.fatal', {}, h('h2', { text: t('Cannot start') }), h('p', { text: (e as Error).message })));
  }
}

// the boot splash (index.html) leaves once the first screen is built
const boot = document.getElementById('boot');
if (boot) {
  requestAnimationFrame(() => boot.classList.add('out'));
  setTimeout(() => boot.remove(), 600);
}
