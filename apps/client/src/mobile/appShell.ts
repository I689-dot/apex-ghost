import './mobile.css';
import { QUALITY, saveSettings, settings } from '../settings';
import { TouchControls } from './touchControls';
import { t } from '../i18n';

const FIRST_RUN_KEY = 'apexghost.app.init.v1';

/**
 * Phone rendering budget. It replaces the Low preset inside the app (the app starts on it):
 * a render scale near 1 CSS pixel, sun shadows from the cars only on a small map, no AO / bloom,
 * the standard car model in the cockpit (not the high-detail interior), shorter draw distances,
 * and the smallest reflection map. KTX2 textures stay GPU-compressed (ASTC/ETC2 on phones).
 */
function applyPhoneQuality(): void {
  Object.assign(QUALITY.low, {
    shadows: true,
    shadowMapSize: 1024,
    shadowRange: 35,
    sceneryShadows: false,
    treeShadows: false,
    softShadows: false,
    pixelRatioCap: 1.25,
    bloom: false,
    ao: false,
    antialias: 'native',
    envOnTrack: false,
    pbrScenery: false,
    cockpitDetail: false,
    ownHeadlightSpots: false,
    ownHeadlightShadows: false,
    treeDistance: 160,
    sceneryDistance: 420,
    detailDistance: 110,
    rainParticles: 1500,
    anisotropy: 2,
    envMapSize: 64,
  });
  // Medium on a phone: Low's budget with a sharper image and longer views (for recent flagship phones)
  Object.assign(QUALITY.medium, {
    pixelRatioCap: 1.6,
    shadowMapSize: 1024,
    cockpitDetail: false,
    treeDistance: 260,
    sceneryDistance: 600,
    rainParticles: 3000,
  });
  let first = false;
  try {
    first = !localStorage.getItem(FIRST_RUN_KEY);
    localStorage.setItem(FIRST_RUN_KEY, '1');
  } catch {
    first = true;
  }
  if (first) {
    settings.quality = 'low';
    settings.qualityAuto = false;
    settings.resolutionScale = 0.9;
    settings.dynamicResolution = true;
    settings.showPerf = false;
    // a phone screen is small: a slightly wider view, and full assists on touch
    settings.fov = 70;
    settings.assists = { ...settings.assists, abs: true, tc: 2 };
    saveSettings(settings);
  }
}

/** Android back button: closes what is open, pauses a race, leaves a lobby; exits from the main menu. */
function handleBack(exit: () => void): void {
  const closeBtn = document.querySelector<HTMLElement>('.modal:not(.pause) header button.icon');
  if (closeBtn) return closeBtn.click();
  if (document.querySelector('.race-ui')) {
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape' }));
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Escape', key: 'Escape' }));
    return;
  }
  const leave = [...document.querySelectorAll<HTMLElement>('.lobby button, .results button')].find((b) =>
    [t('Leave'), t('Back to menu')].includes(b.textContent ?? ''),
  );
  if (leave) return leave.click();
  exit();
}

async function nativeHooks(): Promise<void> {
  try {
    const { App } = await import('@capacitor/app');
    await App.addListener('backButton', () => handleBack(() => void App.exitApp()));
  } catch {
    /* not inside the native shell (dev preview) */
  }
}

/** Everything the app adds on top of the shared game: phone graphics, touch controls, landscape UI. */
export function initAppShell(): void {
  document.documentElement.classList.add('mobile-app');
  applyPhoneQuality();
  new TouchControls();
  void nativeHooks();
  // the manifest locks landscape; this covers the dev preview and browsers that allow it
  const so = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
  void so?.lock?.('landscape').catch(() => {});
  // no pinch zoom, no long-press menus or text selection on the game
  document.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('gesturestart', (e) => e.preventDefault());
}
