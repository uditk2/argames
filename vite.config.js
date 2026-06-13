import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite config. PixiJS + React. MediaPipe Tasks Vision is loaded from a CDN
// ESM URL at runtime (see src/vision/poseTracker.js), so it is intentionally
// NOT bundled here — that keeps the build offline-safe and avoids wasm copy steps.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    allowedHosts: ['sharyl-unbroke-julius.ngrok-free.dev'],
  },
});
