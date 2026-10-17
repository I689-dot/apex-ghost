const env = import.meta.env as { VITE_SERVER_URL?: string; DEV: boolean };

/** Realtime server base URL (http/https; ws/wss is derived). */
export const SERVER_URL: string = (env.VITE_SERVER_URL ?? `http://${location.hostname || 'localhost'}:8787`).replace(/\/$/, '');

export const IS_DEV = env.DEV;

export const ASSET_BASE = import.meta.env.BASE_URL;
