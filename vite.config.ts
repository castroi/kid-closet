/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { serviceWorkerSource } from './src/sw/serviceWorkerSource';

/** Writes /sw.js for this build, listing every file the build produced so it is all cached for offline use. */
function serviceWorker(): Plugin {
  return {
    name: 'kid-closet-service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const files = Object.keys(bundle)
        .filter((name) => !name.endsWith('.map') && name !== 'index.html' && name !== 'sw.js')
        .map((name) => `/${name}`);
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: serviceWorkerSource(files) });
    },
  };
}

export default defineConfig({
  plugins: [react(), serviceWorker()],
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
