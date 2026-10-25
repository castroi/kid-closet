/**
 * Builds the source of /sw.js for one build. vite.config.ts calls this with the
 * build's own files, so the service worker pre-caches exactly what this version
 * of the app needs (including the file worker and the WebP encoder) and uses a
 * cache named after the build.
 *
 * Caching rules:
 * - Install: pre-cache the app shell and every file of the build. If any fails,
 *   install fails and the current version keeps running; the next visit retries.
 * - No skipWaiting: a new version takes over only once every open copy of the old
 *   one has closed, so a running old version never loses files it still needs.
 * - Activate: delete the caches of older builds.
 * - Pages: network first, but after NAVIGATION_TIMEOUT_MS on a weak signal the
 *   cached page is shown (the network answer still refreshes the cache). Only an
 *   HTML answer is kept as the offline page.
 * - /assets/*: cache first; their names contain a content hash, so they never change.
 * - Anything else of this site (manifest, icons): network first, cache when offline.
 * Cache writes are tied to the request with waitUntil, so iOS doesn't stop the
 * worker before they finish.
 */

/** Files that are not part of the build output but belong to the app shell. */
export const SHELL_FILES = ['/', '/index.html', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/apple-touch-icon.png'];

/** How long a page load waits for the network before showing the cached page. */
export const NAVIGATION_TIMEOUT_MS = 3000;

/** A short, stable id: the same strings give the same id. FNV-1a over the sorted strings. */
export function buildId(parts: string[]): string {
  let hash = 0x811c9dc5;
  for (const char of [...parts].sort().join('\n')) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

/**
 * Turns the build's output file names into the list to pre-cache, and stops the
 * build if a file the app needs offline is missing from it.
 */
export function precacheFilesFromBuild(outputFiles: string[]): string[] {
  const files = outputFiles
    .filter((name) => !name.endsWith('.map') && name !== 'index.html' && name !== 'sw.js')
    .map((name) => `/${name}`);
  const required: [string, (f: string) => boolean][] = [
    ['the file worker', (f) => /opfs\.worker.*\.js$/.test(f)],
    ['the WebP encoder (.wasm)', (f) => f.endsWith('.wasm')],
    ['the WebP encoder (its .js loader)', (f) => /webp_enc.*\.js$/.test(f)],
  ];
  for (const [what, found] of required) {
    if (!files.some(found)) throw new Error(`The service worker would not cache ${what} for offline use`);
  }
  return files;
}

export function serviceWorkerSource(buildFiles: string[], navigationTimeoutMs = NAVIGATION_TIMEOUT_MS): string {
  // Sorted, so the same files in any order give the same worker and the same cache name.
  const precache = [...new Set([...SHELL_FILES, ...[...buildFiles].sort()])];
  const logic = `const PRECACHE = ${JSON.stringify(precache)};
const NAVIGATION_TIMEOUT_MS = ${navigationTimeoutMs};

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function store(event, key, response) {
  const saving = caches.open(CACHE).then((cache) => cache.put(key, response));
  try {
    event.waitUntil(saving);
  } catch (e) {
    // The event is already finished; the write still runs, just without the keep-alive.
  }
}

function isHtml(response) {
  return (response.headers.get('content-type') || '').includes('text/html');
}

function navigate(event) {
  const fromNetwork = fetch(event.request).then((response) => {
    if (response.ok && isHtml(response)) store(event, '/index.html', response.clone());
    return response;
  });
  // Keep the worker alive until the network answer has refreshed the cache, even
  // if the cached page was shown first.
  event.waitUntil(fromNetwork.then(() => undefined, () => undefined));
  return new Promise((resolve) => {
    let done = false;
    let timer;
    const finish = (response) => {
      if (!done && response) {
        done = true;
        clearTimeout(timer);
        resolve(response);
      }
    };
    const showCached = () => caches.match('/index.html').then(finish);
    fromNetwork.then(finish, () => showCached().then(() => finish(Response.error())));
    timer = setTimeout(showCached, NAVIGATION_TIMEOUT_MS); // weak signal: show the cached page meanwhile
  });
}

/** Keeps the worker alive, from the moment of the request, until the work and any cache write it starts are done. */
function keepAlive(event, work) {
  event.waitUntil(work.then(() => undefined, () => undefined));
  return work;
}

function networkFirst(event) {
  const request = event.request;
  return keepAlive(
    event,
    fetch(request)
      .then((response) => {
        if (response.ok) store(event, request, response.clone());
        return response;
      })
      .catch(() => caches.match(request).then((cached) => cached || Response.error())),
  );
}

function cacheFirst(event) {
  const request = event.request;
  return keepAlive(
    event,
    caches.match(request).then(
      (cached) =>
        cached ||
        fetch(request).then((response) => {
          if (response.ok) store(event, request, response.clone());
          return response;
        }),
    ),
  );
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode === 'navigate') event.respondWith(navigate(event));
  else if (url.pathname.startsWith('/assets/')) event.respondWith(cacheFirst(event));
  else event.respondWith(networkFirst(event));
});
`;
  // Named after both the files and the logic, so a change to either gets a fresh cache.
  return `/* Generated by vite.config.ts from src/sw/serviceWorkerSource.ts; do not edit. */
const CACHE_PREFIX = 'kid-closet-';
const CACHE = CACHE_PREFIX + ${JSON.stringify(buildId([...buildFiles, logic]))};
${logic}`;
}
