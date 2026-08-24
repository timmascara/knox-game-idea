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
    chunkSizeWarningLimit: 2000,
  },
  optimizeDeps: {
    exclude: ['@dimforge/rapier3d-compat'],
  },
});
