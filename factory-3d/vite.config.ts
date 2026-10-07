import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    strictPort: true,
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
  // Pre-bundle the lazily imported dev overlay too, so Vite never re-optimises
  // mid-session (which would load a second copy of React).
  optimizeDeps: { include: ['r3f-perf'] },
  build: { chunkSizeWarningLimit: 1600 },
});
