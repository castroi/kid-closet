// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { SHELL_FILES, buildId, serviceWorkerSource } from './serviceWorkerSource';

const ORIGIN = 'https://closet.test';
const BUILD = ['/assets/index-abc.js', '/assets/opfs.worker-def.js', '/assets/webp_enc-123.wasm'];

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

/** Runs the generated service worker against fakes and returns handles to drive it. */
function startWorker(buildFiles = BUILD) {
  const listeners = new Map<string, (event: unknown) => void>();
  let online = true;
  const served: string[] = [];
  const fetchFn = vi.fn(async (key: Key) => {
    if (!online) throw new TypeError('offline');
    served.push(path(key));
    if (path(key) === '/missing.js') return new Response('', { status: 404 });
    return new Response(`network ${path(key)}`, { status: 200 });
  });
  const caches = fakeCaches(fetchFn);
  const claim = vi.fn(async () => undefined);
  const self = {
    addEventListener: (type: string, fn: (event: unknown) => void) => listeners.set(type, fn),
    location: { origin: ORIGIN },
    clients: { claim },
  };
  new Function('self', 'caches', 'fetch', serviceWorkerSource(buildFiles))(self, caches.api, fetchFn);

  const lifecycle = async (type: 'install' | 'activate') => {
    let work: Promise<unknown> = Promise.resolve();
    listeners.get(type)!({ waitUntil: (p: Promise<unknown>) => (work = p) });
    await work;
  };
  const request = async (pathname: string, init: { method?: string; mode?: string; origin?: string } = {}) => {
    let reply: Promise<Response> | undefined;
    listeners.get('fetch')!({
      request: { url: `${init.origin ?? ORIGIN}${pathname}`, method: init.method ?? 'GET', mode: init.mode ?? 'cors' },
      respondWith: (p: Promise<Response>) => (reply = p),
    });
    if (!reply) return undefined;
    const response = await reply;
    await new Promise((r) => setTimeout(r, 0)); // let background cache writes finish
    return response;
  };
  return {
    caches,
    claim,
    fetchFn,
    served,
    lifecycle,
    request,
    goOffline: () => (online = false),
    cacheName: `kid-closet-${buildId(buildFiles)}`,
  };
}

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

  it('serves build files from the cache without the network', async () => {
    const sw = startWorker();
    await sw.lifecycle('install');
    sw.served.length = 0;
    expect(await (await sw.request('/assets/webp_enc-123.wasm'))!.text()).toBe('network /assets/webp_enc-123.wasm');
    expect(sw.served).toEqual([]);
  });

  it('fetches and caches a build file that is not cached yet', async () => {
    const sw = startWorker();
    expect(await (await sw.request('/assets/late-chunk.js'))!.text()).toBe('network /assets/late-chunk.js');
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
});

describe('buildId', () => {
  it('is the same for the same files in any order, and changes with them', () => {
    expect(buildId(['/a', '/b'])).toBe(buildId(['/b', '/a']));
    expect(buildId(['/a', '/b'])).not.toBe(buildId(['/a', '/c']));
    expect(buildId([])).toMatch(/^[0-9a-z]+$/);
  });
});
