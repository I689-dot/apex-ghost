const env = import.meta.env as { VITE_SERVER_URL?: string; VITE_ASSET_BASE?: string; DEV: boolean };

/** Realtime server base URL (http/https; ws/wss is derived). */
export const SERVER_URL: string = (env.VITE_SERVER_URL ?? `http://${location.hostname || 'localhost'}:8787`).replace(/\/$/, '');

export const IS_DEV = env.DEV;

/**
 * Where the game data (cars, maps, engine sounds) comes from: next to the page on the website; in the mobile
 * app, the website's copy (VITE_ASSET_BASE), so the APK stays small (see DECISIONS.md, "Mobile app").
 */
export const ASSET_BASE: string = env.VITE_ASSET_BASE ? env.VITE_ASSET_BASE.replace(/\/?$/, '/') : import.meta.env.BASE_URL;
