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
    // Only the rigged hand is inlined (so the single-file build works and
    // HandAsset.js can base64-decode it under a strict CSP). Park models and
    // textures are fetched as files: inlining megabytes of GLB and WebP into
    // the JS bundle would make every load pay for the whole park up front.
    assetsInlineLimit: (file) => /hand_right\.glb$/.test(file),
  },
  optimizeDeps: {
    exclude: ['@dimforge/rapier3d-compat'],
  },
});
