import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { port: 5173 },
  build: {
    // the folder name becomes the Vercel project name on first deploy
    outDir: 'dist/apex-ghost',
    emptyOutDir: true,
    target: 'es2022',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 2500,
    rollupOptions: {
      output: { manualChunks: { three: ['three'], rapier: ['@dimforge/rapier3d-compat'] } },
    },
  },
  optimizeDeps: { exclude: ['@dimforge/rapier3d-compat'] },
});
