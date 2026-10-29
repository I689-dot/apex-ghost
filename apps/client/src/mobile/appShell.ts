import './mobile.css';
import { QUALITY, saveSettings, settings } from '../settings';
import { TouchControls } from './touchControls';
import { applyFrameRate } from './refreshRate';
import { t } from '../i18n';

const FIRST_RUN_KEY = 'apexghost.app.init.v1';

/**
 * Phone rendering budgets. Low (the app starts on it): a render scale near 1 CSS pixel, sun shadows from the cars
 * only on a small map, no AO / bloom, the standard car model in the cockpit (not the high-detail interior), shorter
 * draw distances, flat clouds, impostor trees only, and the smallest reflection map. KTX2 textures stay
 * GPU-compressed (ASTC/ETC2 on phones).
 * Medium, High and Ultra step up to the full look for recent phones: lit clouds, 3D trees with wind and a 3D lawn on the verges, then bloom, MSAA, PBR scenery and tree shadows, and on Ultra ambient occlusion and the detailed
 * cockpit (dynamic resolution keeps the frame rate).
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
    remoteDetail: false,
    crowd: 0.3,
    ownHeadlightSpots: false,
    ownHeadlightShadows: false,
    treeDistance: 160,
    sceneryDistance: 650,
    detailDistance: 170,
    barrierDistance: 700,
    forestFar: 550,
    rainParticles: 1500,
    anisotropy: 2,
    envMapSize: 64,
    cloudDetail: 0,
    grassShells: 0,
    grassShellRadius: 0,
    forestNear: 0,
  });
  // Medium on a phone: Low's budget with a sharper image and longer views (for recent flagship phones)
  Object.assign(QUALITY.medium, {
    pixelRatioCap: 1.6,
    shadowMapSize: 1024,
    cockpitDetail: false,
    remoteDetail: false,
    crowd: 0.6,
    treeDistance: 260,
    sceneryDistance: 600,
    barrierDistance: 1000,
    forestNear: 50,
    forestFar: 800,
    forestDensity: 0.5,
    rainParticles: 3000,
    cloudDetail: 1,
    grassShells: 5,
    grassShellRadius: 12,
  });
  // High on a phone: bloom, MSAA, PBR scenery and reflections, a sharper image, 3D trees further out
  Object.assign(QUALITY.high, {
    pixelRatioCap: 1.75,
    shadows: true,
    shadowMapSize: 2048,
    shadowRange: 60,
    sceneryShadows: false,
    treeShadows: false,
    softShadows: true,
    bloom: true,
    antialias: 'msaa',
    ao: false,
    envOnTrack: true,
    pbrScenery: true,
    cockpitDetail: false,
    remoteDetail: false,
    crowd: 0.8,
    cloudDetail: 2,
    grassShells: 8,
    grassShellRadius: 20,
    ownHeadlightSpots: false,
    ownHeadlightShadows: false,
    treeDistance: 400,
    sceneryDistance: 1300,
    detailDistance: 380,
    barrierDistance: 1400,
    forestNear: 70,
    forestFar: 1100,
    forestNearDensity: 0.9,
    forestDensity: 0.6,
    rainParticles: 4000,
    anisotropy: 4,
    envMapSize: 128,
  });
  // Ultra on a phone: everything on (AO, tree and scenery shadows, the detailed cockpit), within a phone's memory
  Object.assign(QUALITY.ultra, {
    pixelRatioCap: 2,
    shadows: true,
    shadowMapSize: 2048,
    shadowRange: 90,
    sceneryShadows: true,
    treeShadows: true,
    softShadows: true,
    bloom: true,
    antialias: 'msaa',
    ao: true,
    envOnTrack: true,
    pbrScenery: true,
    cockpitDetail: true,
    remoteDetail: true,
    crowd: 1,
    cloudDetail: 2,
    grassShells: 12,
    grassShellRadius: 28,
    ownHeadlightSpots: true,
    ownHeadlightShadows: false,
    treeDistance: 700,
    sceneryDistance: 2400,
    detailDistance: 650,
    barrierDistance: 2000,
    forestNear: 100,
    forestFar: 1600,
    forestNearDensity: 1,
    forestDensity: 0.75,
    rainParticles: 7000,
    anisotropy: 8,
    envMapSize: 256,
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
  void applyFrameRate();
  // the manifest locks landscape; this covers the dev preview and browsers that allow it
  const so = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
  void so?.lock?.('landscape').catch(() => {});
  // no pinch zoom, no long-press menus or text selection on the game
  document.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('gesturestart', (e) => e.preventDefault());
}
