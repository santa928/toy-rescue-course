import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    allowedHosts: ['host.docker.internal'],
  },
  test: {
    environment: 'node',
    globals: true,
  },
});
