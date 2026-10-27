// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { SHELL_FILES, buildId, precacheFilesFromBuild, serviceWorkerSource } from './serviceWorkerSource';

const ORIGIN = 'https://closet.test';
const BUILD = ['/assets/index-abc.js', '/assets/opfs.worker-def.js', '/assets/webp_enc-123.wasm', '/assets/webp_enc-456.js'];

type Key = string | { url: string };
const path = (key: Key) => (typeof key === 'string' ? key : new URL(key.url).pathname);

/** In-memory CacheStorage: enough of it for the service worker. */
function fakeCaches(fetchFn: (key: Key) => Promise<Response>) {
  const stores = new Map<string, Map<string, Response>>();
  const open = async (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const store = stores.get(name)!;
    return {
      put: async (key: Key, response: Response) => void store.set(path(key), response),
      match: async (key: Key) => store.get(path(key)),
      addAll: async (keys: string[]) => {
        const responses = await Promise.all(keys.map((k) => fetchFn(k)));
        if (responses.some((r) => !r.ok)) throw new TypeError('addAll failed');
        keys.forEach((k, i) => store.set(path(k), responses[i]));
      },
    };
  };
  return {
    stores,
    api: {
      open,
      keys: async () => [...stores.keys()],
      delete: async (name: string) => stores.delete(name),
      // Like the real CacheStorage.match: searches every cache, oldest first.
      match: async (key: Key) => {
        for (const store of stores.values()) if (store.has(path(key))) return store.get(path(key));
        return undefined;
      },
    },
  };
}

const HTML_PATHS = ['/', '/index.html'];
/** A short page-load timeout, so tests of the weak-signal fallback stay fast. */
const NAV_TIMEOUT = 30;

/** Runs the generated service worker against fakes and returns handles to drive it. */
function startWorker(buildFiles = BUILD) {
  const listeners = new Map<string, (event: unknown) => void>();
  let online = true;
  let slow: Promise<void> | null = null;
  const served: string[] = [];
  const fetchFn = vi.fn(async (key: Key & { mode?: string }) => {
    if (slow) await slow;
    if (!online) throw new TypeError('offline');
    const p = path(key);
    served.push(p);
    if (p === '/missing.js') return new Response('', { status: 404 });
    const html = HTML_PATHS.includes(p) || (typeof key !== 'string' && key.mode === 'navigate' && !p.includes('.'));
    return new Response(`network ${p}`, { status: 200, headers: { 'content-type': html ? 'text/html' : 'application/octet-stream' } });
  });
  const caches = fakeCaches(fetchFn);
  const claim = vi.fn(async () => undefined);
  const self = {
    addEventListener: (type: string, fn: (event: unknown) => void) => listeners.set(type, fn),
    location: { origin: ORIGIN },
    clients: { claim },
  };
  const source = serviceWorkerSource(buildFiles, NAV_TIMEOUT);
  new Function('self', 'caches', 'fetch', source)(self, caches.api, fetchFn);

  const lifecycle = async (type: 'install' | 'activate') => {
    let work: Promise<unknown> = Promise.resolve();
    listeners.get(type)!({ waitUntil: (p: Promise<unknown>) => (work = p) });
    await work;
  };
  /** Dispatches a fetch; resolves with the answer and a promise for the event's background work. */
  const dispatch = (pathname: string, init: { method?: string; mode?: string; origin?: string } = {}) => {
    let reply: Promise<Response> | undefined;
    const extended: Promise<unknown>[] = [];
    listeners.get('fetch')!({
      request: { url: `${init.origin ?? ORIGIN}${pathname}`, method: init.method ?? 'GET', mode: init.mode ?? 'cors' },
      respondWith: (p: Promise<Response>) => (reply = p),
      waitUntil: (p: Promise<unknown>) => extended.push(p),
    });
    // Like the browser: wait for every waitUntil promise, including ones added while waiting.
    const background = async () => {
      for (let i = 0; i < extended.length; i++) await extended[i];
    };
    return { reply, extended, background };
  };
  const request = async (pathname: string, init: { method?: string; mode?: string; origin?: string } = {}) => {
    const { reply, background } = dispatch(pathname, init);
    if (!reply) return undefined;
    const response = await reply;
    await background();
    return response;
  };
  let release: () => void = () => undefined;
  return {
    caches,
    claim,
    fetchFn,
    served,
    lifecycle,
    dispatch,
    request,
    goOffline: () => (online = false),
    slowNetwork: () => (slow = new Promise<void>((r) => (release = r))),
    releaseNetwork: () => {
      slow = null;
      release();
    },
    cacheName: `kid-closet-${/CACHE_PREFIX \+ "(\w+)"/.exec(source)![1]}`,
  };
}

const cacheNameOf = (source: string) => /CACHE_PREFIX \+ "(\w+)"/.exec(source)![1];

describe('generated service worker', () => {
  it('pre-caches the app shell and every file of the build on install', async () => {
    const sw = startWorker();
    await sw.lifecycle('install');
    const cached = [...sw.caches.stores.get(sw.cacheName)!.keys()].sort();
    expect(cached).toEqual([...new Set([...SHELL_FILES, ...BUILD])].sort());
  });

  it('fails the install if any file cannot be fetched, so the old version keeps running', async () => {
    const sw = startWorker([...BUILD, '/missing.js']);
    await expect(sw.lifecycle('install')).rejects.toThrow('addAll failed');
  });

  it('never takes over a running old version by itself', () => {
    expect(serviceWorkerSource(BUILD)).not.toContain('skipWaiting');
  });

  it('deletes older builds\' caches on activate, keeps other caches, and takes control', async () => {
    const sw = startWorker();
    sw.caches.stores.set('kid-closet-v1', new Map());
    sw.caches.stores.set('kid-closet-oldbuild', new Map());
    sw.caches.stores.set('someone-else', new Map());
    await sw.lifecycle('install');
    await sw.lifecycle('activate');
    expect([...sw.caches.stores.keys()].sort()).toEqual([sw.cacheName, 'someone-else'].sort());
    expect(sw.claim).toHaveBeenCalled();
  });

  it('loads pages from the network first and keeps the newest copy for offline use', async () => {
    const sw = startWorker();
    await sw.lifecycle('install');
    expect(await (await sw.request('/', { mode: 'navigate' }))!.text()).toBe('network /');
    sw.goOffline();
    // Install cached "network /index.html"; the page load above replaced it with the newer copy.
    expect(await (await sw.request('/anything', { mode: 'navigate' }))!.text()).toBe('network /');
  });

  it('shows the cached page on a weak signal, and still refreshes it from the late answer', async () => {
    const sw = startWorker();
    await sw.lifecycle('install');
    sw.slowNetwork();
    const { reply, background } = sw.dispatch('/', { mode: 'navigate' });
    expect(await (await reply!)!.text()).toBe('network /index.html'); // the cached page, after the timeout
    sw.releaseNetwork();
    await background();
    sw.goOffline();
    expect(await (await sw.request('/', { mode: 'navigate' }))!.text()).toBe('network /');
  });

  it('waits for the network on a weak signal when no page is cached yet', async () => {
    const sw = startWorker();
    sw.slowNetwork();
    const { reply } = sw.dispatch('/', { mode: 'navigate' });
    setTimeout(() => sw.releaseNetwork(), NAV_TIMEOUT * 3);
    expect(await (await reply!)!.text()).toBe('network /');
  });

  it('answers a page load with a network error when offline and nothing is cached', async () => {
    const sw = startWorker();
    sw.goOffline();
    expect((await sw.request('/', { mode: 'navigate' }))!.type).toBe('error');
  });

  it('keeps only an HTML answer as the offline page', async () => {
    const sw = startWorker();
    await sw.lifecycle('install');
    await sw.request('/manifest.webmanifest', { mode: 'navigate' }); // someone opened the manifest directly
    sw.goOffline();
    expect(await (await sw.request('/', { mode: 'navigate' }))!.text()).toBe('network /index.html');
  });

  it('serves build files from the cache without the network', async () => {
    const sw = startWorker();
    await sw.lifecycle('install');
    sw.served.length = 0;
    expect(await (await sw.request('/assets/webp_enc-123.wasm'))!.text()).toBe('network /assets/webp_enc-123.wasm');
    expect(sw.served).toEqual([]);
  });

  it('fetches and caches a build file that is not cached yet, keeping the worker alive for the write', async () => {
    const sw = startWorker();
    const { reply, extended, background } = sw.dispatch('/assets/late-chunk.js');
    expect(extended.length).toBe(1); // kept alive from the moment of the request, not only later
    expect(await (await reply!)!.text()).toBe('network /assets/late-chunk.js');
    expect(extended.length).toBeGreaterThan(1); // and the cache write is tied to the event too
    await background();
    sw.goOffline();
    expect(await (await sw.request('/assets/late-chunk.js'))!.text()).toBe('network /assets/late-chunk.js');
  });

  it('keeps the manifest and icons up to date, with the cached copy offline', async () => {
    const sw = startWorker();
    await sw.lifecycle('install');
    sw.served.length = 0;
    await sw.request('/manifest.webmanifest');
    expect(sw.served).toEqual(['/manifest.webmanifest']);
    sw.goOffline();
    expect((await sw.request('/icons/icon-192.png'))!.ok).toBe(true);
  });

  it('answers with a network error when offline and nothing is cached', async () => {
    const sw = startWorker();
    sw.goOffline();
    expect((await sw.request('/not-cached.txt'))!.type).toBe('error');
  });

  it('leaves other requests alone', async () => {
    const sw = startWorker();
    expect(await sw.request('/api', { method: 'POST' })).toBeUndefined();
    expect(await sw.request('/x.js', { origin: 'https://elsewhere.test' })).toBeUndefined();
  });

  it('names the cache after both the files and the worker logic', () => {
    expect(cacheNameOf(serviceWorkerSource(BUILD))).toBe(cacheNameOf(serviceWorkerSource([...BUILD].reverse())));
    expect(cacheNameOf(serviceWorkerSource(BUILD))).not.toBe(cacheNameOf(serviceWorkerSource([...BUILD, '/assets/x.js'])));
    // Different logic (here: another timeout), same files: a new cache.
    expect(cacheNameOf(serviceWorkerSource(BUILD, 3000))).not.toBe(cacheNameOf(serviceWorkerSource(BUILD, 30)));
  });
});

describe('precacheFilesFromBuild', () => {
  it('lists the build files as site paths, without source maps, the page or the worker script itself', () => {
    expect(
      precacheFilesFromBuild([
        'assets/index-abc.js',
        'assets/index-abc.js.map',
        'assets/opfs.worker-def.js',
        'assets/webp_enc-123.wasm',
        'assets/webp_enc-456.js',
        'assets/doll-default-789.webp',
        'assets/sample-garment-012.webp',
        'index.html',
        'sw.js',
      ]),
    ).toEqual([
      '/assets/index-abc.js',
      '/assets/opfs.worker-def.js',
      '/assets/webp_enc-123.wasm',
      '/assets/webp_enc-456.js',
      '/assets/doll-default-789.webp',
      '/assets/sample-garment-012.webp',
    ]);
  });

  const all = ['assets/index.js', 'assets/opfs.worker-1.js', 'assets/webp_enc.wasm', 'assets/webp_enc.js', 'assets/doll-default.webp', 'assets/sample-garment.webp'];
  const without = (file: string) => all.filter((f) => f !== file);

  it.each([
    ['the file worker', without('assets/opfs.worker-1.js')],
    ['the WebP encoder (.wasm)', without('assets/webp_enc.wasm')],
    ['the WebP encoder (its .js loader)', without('assets/webp_enc.js')],
    ['the default doll picture', without('assets/doll-default.webp')],
    ['the sample garment photo', without('assets/sample-garment.webp')],
  ])('stops the build when %s is missing', (what, files) => {
    expect(() => precacheFilesFromBuild(files)).toThrow(what);
  });
});

describe('buildId', () => {
  it('is the same for the same parts in any order, and changes with them', () => {
    expect(buildId(['/a', '/b'])).toBe(buildId(['/b', '/a']));
    expect(buildId(['/a', '/b'])).not.toBe(buildId(['/a', '/c']));
    expect(buildId([])).toMatch(/^[0-9a-z]+$/);
  });
});
