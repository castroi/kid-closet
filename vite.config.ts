/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    // The WebP encoder loads its own .wasm file; pre-bundling breaks that lookup.
    exclude: ['@jsquash/webp'],
  },
  worker: {
    format: 'es',
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/test/**',
        // Browser-only glue that jsdom cannot run (real OPFS worker, canvas
        // encoding, service worker registration, app bootstrap).
        'src/main.tsx',
        'src/storage/opfs.worker.ts',
        'src/image/browserImage.ts',
        'src/pwa.ts',
      ],
      thresholds: {
        lines: 80,
        statements: 80,
        functions: 80,
        branches: 75,
      },
    },
  },
});
