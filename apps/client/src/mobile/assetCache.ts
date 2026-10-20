import { ASSET_BASE } from '../config';

/**
 * Game data fetch. On the website it is a plain fetch (same origin, the HTTP cache does the rest).
 * In the mobile app the data comes from the website, so it is also kept in Cache Storage, which makes
 * offline solo races work after a car and a map have been loaded once:
 *  - versioned files (`…?v=<build>`: models, collision, textures) are immutable: cache first, and older
 *    versions of the same file are dropped when a new one arrives;
 *  - the rest (car list, layout index, engine banks) is network first, the cached copy when offline.
 */
const REMOTE = /^https?:\/\//i.test(ASSET_BASE) && !ASSET_BASE.startsWith(location.origin);
const CACHE = 'apex-assets-v1';
let cachePromise: Promise<Cache | null> | null = null;

function openCache(): Promise<Cache | null> {
  cachePromise ??= (async () => {
    try {
      if (typeof caches === 'undefined') return null;
      void navigator.storage?.persist?.().catch(() => false);
      return await caches.open(CACHE);
    } catch {
      return null;
    }
  })();
  return cachePromise;
}

const versioned = (u: string) => /[?&]v=/.test(u);
const basePath = (u: string) => u.split('?')[0];

export async function assetFetch(url: string): Promise<Response> {
  if (!REMOTE) return fetch(url);
  const cache = await openCache();
  if (!cache) return fetch(url);
  if (versioned(url)) {
    const hit = await cache.match(url).catch(() => undefined);
    if (hit) return hit;
    const res = await fetch(url);
    if (res.ok) void store(cache, url, res.clone(), true);
    return res;
  }
  try {
    const res = await fetch(url, { cache: 'no-cache' });
    if (res.ok) void store(cache, url, res.clone(), false);
    return res;
  } catch (e) {
    const hit = await cache.match(url).catch(() => undefined);
    if (hit) return hit;
    throw e;
  }
}

async function store(cache: Cache, url: string, res: Response, prune: boolean): Promise<void> {
  try {
    await cache.put(url, res);
    if (!prune) return;
    const path = basePath(url);
    for (const req of await cache.keys()) if (req.url !== url && basePath(req.url) === path) void cache.delete(req);
  } catch {
    /* quota or a failed body: the file just isn't available offline */
  }
}
