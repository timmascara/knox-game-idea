import { defineConfig } from 'vite';

// Home Court — Vite configuration.
// Rapier ships as a WASM module; Vite handles it fine, but we make sure it is
// treated as an asset dependency that gets optimized and not externalized.
export default defineConfig({
  base: './',
  server: {
    host: true,
    port: 5173,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    outDir: 'dist',
    chunkSizeWarningLimit: 4000,
    // The rigged hand (~1.8 MB) is inlined so the single-file build works.
    assetsInlineLimit: 4 * 1024 * 1024,
  },
  optimizeDeps: {
    exclude: ['@dimforge/rapier3d-compat'],
  },
});
