/// <reference types="vitest/config" />
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { precacheFilesFromBuild, serviceWorkerSource } from './src/sw/serviceWorkerSource';
import pkg from './package.json';

/**
 * Writes /sw.js for this build, listing every file the build produced so it is all
 * cached for offline use. Runs after the other plugins, so their files are in the
 * list, and fails the build if the file worker or the WebP encoder is missing.
 */
function serviceWorker(): Plugin {
  return {
    name: 'kid-closet-service-worker',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      let files: string[];
      try {
        files = precacheFilesFromBuild(Object.keys(bundle));
      } catch (err) {
        this.error((err as Error).message);
      }
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: serviceWorkerSource(files) });
    },
  };
}

/**
 * The commit being built: Vercel and GitHub Actions both say which one. Only a
 * plain SHA is used; anything else (e.g. a local build) becomes ''.
 */
function buildCommit(env: Record<string, string>): string {
  const sha = env.VERCEL_GIT_COMMIT_SHA || env.GITHUB_SHA || '';
  return /^[0-9a-f]{40}$/.test(sha) ? sha : '';
}

export default defineConfig(({ mode }) => ({
  // Shown in the parent area (src/app/buildInfo.ts). No dates: the same commit builds the same app.
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_COMMIT__: JSON.stringify(buildCommit(loadEnv(mode, '.', ''))),
  },
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
}));
