/**
 * Where the game runs: the desktop website, a phone browser (refused, with an install button),
 * or the Android / iOS app (Capacitor, apps/mobile), which wraps this same code base.
 */
const env = import.meta.env as { VITE_APP?: string; VITE_WEB_URL?: string; DEV: boolean };

function devFlag(): boolean {
  // dev only: http://localhost:5173/?app=1 previews the app UI in a desktop browser (Playwright tests)
  if (!env.DEV) return false;
  try {
    const q = new URLSearchParams(location.search).get('app');
    if (q === '1') sessionStorage.setItem('apexghost.appMode', '1');
    if (q === '0') sessionStorage.removeItem('apexghost.appMode');
    return sessionStorage.getItem('apexghost.appMode') === '1';
  } catch {
    return false;
  }
}

function nativeShell(): boolean {
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return !!cap?.isNativePlatform?.();
}

/** True inside the mobile app (the `app` build, the Capacitor shell, or `?app=1` in dev). */
export const IS_APP: boolean = env.VITE_APP === '1' || nativeShell() || devFlag();

/** The public website (the app's download page and the source of its large assets). */
export const WEB_URL = (env.VITE_WEB_URL ?? 'https://apex-ghost-liard.vercel.app').replace(/\/$/, '');

/** The signed Android app, served by the website itself (apps/client/public/downloads). */
export const APK_PATH = 'downloads/apex-ghost.apk';
export const APK_URL = `${WEB_URL}/${APK_PATH}`;

export function isAndroid(): boolean {
  return /Android/i.test(navigator.userAgent);
}

export function isIOS(): boolean {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/i.test(ua) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(ua));
}

/** A phone or tablet browser (the website is desktop-only: keyboard driving). */
export function isMobileDevice(): boolean {
  const ua = navigator.userAgent;
  const touchOnly = matchMedia('(pointer: coarse)').matches && !matchMedia('(pointer: fine)').matches;
  return /Android|iPhone|iPad|iPod|Mobile|Silk|Kindle/i.test(ua) || touchOnly || (navigator.maxTouchPoints > 1 && /Macintosh/.test(ua) && screen.width < 1400);
}
