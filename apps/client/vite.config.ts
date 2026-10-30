import { cpSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * `vite build --mode app` (pnpm app:web): the mobile app's web bundle (apps/mobile wraps dist/app).
 * Code, the Basis transcoder, the menu photos, the vegetation (trees, grass, ~1.2 MB) and the surface detail maps (0.7 MB) are bundled; cars, maps and sounds (~200 MB) are loaded
 * from the website at runtime (.env.app: VITE_ASSET_BASE), so the public folder is not copied.
 */
function appPublicFiles(outDir: string): Plugin {
  return {
    name: 'apex-app-public',
    apply: 'build',
    closeBundle() {
      for (const dir of ['libs', 'assets/ui', 'assets/vegetation', 'assets/textures']) {
        const src = path.join(here, 'public', dir);
        if (existsSync(src)) cpSync(src, path.join(outDir, dir), { recursive: true });
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  const app = mode === 'app';
  const outDir = app ? 'dist/app' : 'dist/apex-ghost'; // the website folder name becomes the Vercel project name on first deploy
  return {
    base: './',
    server: { port: 5173 },
    publicDir: app ? false : 'public',
    plugins: app ? [appPublicFiles(path.join(here, outDir))] : [],
    build: {
      outDir,
      emptyOutDir: true,
      target: 'es2022',
      assetsInlineLimit: 0,
      chunkSizeWarningLimit: 2500,
      rollupOptions: {
        output: { manualChunks: { three: ['three'], rapier: ['@dimforge/rapier3d-compat'] } },
      },
    },
    optimizeDeps: { exclude: ['@dimforge/rapier3d-compat'] },
  };
});
