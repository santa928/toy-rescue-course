import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VITEST_EXCLUDE } from './tooling/vitestDiscovery';
import { resolveVendorChunk } from './tooling/vendorChunk';

export default defineConfig({
  plugins: [react()],
  server: {
    allowedHosts: ['host.docker.internal', 'web'],
  },
  build: {
    chunkSizeWarningLimit: 2_250,
    manifest: true,
    rollupOptions: {
      input: {
        game: resolve(process.cwd(), 'index.html'),
        vehicleLab: resolve(process.cwd(), 'vehicle-lab.html'),
        voxelGame: resolve(process.cwd(), 'voxel-game.html'),
      },
      output: {
        manualChunks: resolveVendorChunk,
      },
    },
  },
  test: {
    environment: 'node',
    exclude: [...VITEST_EXCLUDE],
    globals: true,
  },
});
