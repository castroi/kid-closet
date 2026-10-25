// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { blobToText } from './fileStore';
import {
  OpfsFileStore,
  createWorkerWriter,
  documentVisibility,
  type DirHandleLike,
  type FileHandleLike,
} from './opfsStore';

function notFound(): Error {
  const err = new Error('not found');
  err.name = 'NotFoundError';
  return err;
}

/** In-memory imitation of an OPFS directory tree. */
class FakeDir implements DirHandleLike {
  files = new Map<string, Blob>();
  dirs = new Map<string, FakeDir>();

  constructor(private readonly writable = true) {}

  async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<DirHandleLike> {
    let dir = this.dirs.get(name);
    if (!dir) {
      if (!options?.create) throw notFound();
      dir = new FakeDir(this.writable);
      this.dirs.set(name, dir);
    }
    return dir;
  }

  async getFileHandle(name: string, options?: { create?: boolean }): Promise<FileHandleLike> {
    if (!this.files.has(name)) {
      if (!options?.create) throw notFound();
      this.files.set(name, new Blob([]));
    }
    const handle: FileHandleLike = { getFile: async () => this.files.get(name)! };
    if (this.writable) {
      handle.createWritable = async () => {
        let pending: Blob = new Blob([]);
        return {
          write: async (data: Blob) => {
            pending = data;
          },
          close: async () => {
            this.files.set(name, pending);
          },
        };
      };
    }
    return handle;
  }

  async removeEntry(name: string): Promise<void> {
    if (!this.files.delete(name)) throw notFound();
  }

  async *keys(): AsyncIterable<string> {
    yield* this.files.keys();
  }
}

describe('OpfsFileStore', () => {
  it('writes with createWritable when available', async () => {
    const root = new FakeDir();
    const workerWrite = vi.fn();
    const store = new OpfsFileStore(async () => root, workerWrite);
    await store.write('images/a.webp', new Blob(['A']));
    await store.write('closet-a.json', new Blob(['{}']));
    expect(workerWrite).not.toHaveBeenCalled();
    expect(await blobToText((await store.read('images/a.webp'))!)).toBe('A');
    expect(await store.list('images')).toEqual(['a.webp']);
    expect(await blobToText((await store.read('closet-a.json'))!)).toBe('{}');
  });

  it('aborts the stream and keeps the old file when a write fails', async () => {
    const root = new FakeDir();
    root.files.set('closet-a.json', new Blob(['old']));
    const abort = vi.fn().mockResolvedValue(undefined);
    const getFileHandle = root.getFileHandle.bind(root);
    root.getFileHandle = async (name, options) => {
      const handle = await getFileHandle(name, options);
      handle.createWritable = async () => ({
        write: async () => {
          throw new Error('quota exceeded');
        },
        close: async () => undefined,
        abort,
      });
      return handle;
    };
    const store = new OpfsFileStore(async () => root, vi.fn());
    await expect(store.write('closet-a.json', new Blob(['new']))).rejects.toThrow('quota exceeded');
    expect(abort).toHaveBeenCalledOnce();
    expect(await blobToText((await store.read('closet-a.json'))!)).toBe('old');
  });

  it('reports the write error even when abort fails or is missing', async () => {
    for (const abort of [vi.fn().mockRejectedValue(new Error('abort failed')), undefined]) {
      const root = new FakeDir();
      const getFileHandle = root.getFileHandle.bind(root);
      root.getFileHandle = async (name, options) => {
        const handle = await getFileHandle(name, options);
        handle.createWritable = async () => ({
          write: async () => undefined,
          close: async () => {
            throw new Error('close failed');
          },
          abort,
        });
        return handle;
      };
      const store = new OpfsFileStore(async () => root, vi.fn());
      await expect(store.write('a.json', new Blob(['x']))).rejects.toThrow('close failed');
    }
  });

  it('falls back to the worker when createWritable is missing (Safari)', async () => {
    const root = new FakeDir(false);
    const workerWrite = vi.fn().mockResolvedValue(undefined);
    const store = new OpfsFileStore(async () => root, workerWrite);
    await store.write('images/b.webp', new Blob(['xyz']));
    expect(workerWrite).toHaveBeenCalledWith('images/b.webp', new TextEncoder().encode('xyz'));
  });

  it('returns null / empty for missing files and folders', async () => {
    const store = new OpfsFileStore(async () => new FakeDir(), vi.fn());
    expect(await store.read('images/none.webp')).toBeNull();
    expect(await store.read('none.json')).toBeNull();
    expect(await store.list('images')).toEqual([]);
    await expect(store.remove('images/none.webp')).resolves.toBeUndefined();
    await expect(store.remove('none.json')).resolves.toBeUndefined();
  });

  it('removes files', async () => {
    const root = new FakeDir();
    const store = new OpfsFileStore(async () => root, vi.fn());
    await store.write('images/a.webp', new Blob(['A']));
    await store.remove('images/a.webp');
    expect(await store.read('images/a.webp')).toBeNull();
  });

  it('rethrows unexpected errors', async () => {
    const root = new FakeDir();
    root.getDirectoryHandle = async () => {
      throw new Error('quota');
    };
    root.getFileHandle = async () => {
      throw new Error('denied');
    };
    root.removeEntry = async () => {
      throw new Error('locked');
    };
    root.dirs.set('images', root);
    const store = new OpfsFileStore(async () => root, vi.fn());
    await expect(store.read('images/a.webp')).rejects.toThrow('quota');
    await expect(store.read('a.json')).rejects.toThrow('denied');
    await expect(store.remove('a.json')).rejects.toThrow('locked');
  });
});

describe('createWorkerWriter', () => {
  function fakeWorker() {
    const listeners = new Map<string, (e: MessageEvent) => void>();
    const posted: { id: number; path: string }[] = [];
    const fake = {
      posted,
      terminated: false,
      failPost: false,
      reply: (data: unknown) => listeners.get('message')?.({ data } as MessageEvent),
      crash: () => listeners.get('error')?.({} as MessageEvent),
      worker: {
        postMessage: (msg: { id: number; path: string }) => {
          if (fake.failPost) throw new Error('could not post');
          posted.push(msg);
        },
        addEventListener: (type: string, fn: (e: MessageEvent) => void) => {
          listeners.set(type, fn);
        },
        terminate: () => {
          fake.terminated = true;
        },
      } as unknown as Worker,
    };
    return fake;
  }

  /** A worker factory that records every worker it starts. */
  function workerFactory() {
    const started: ReturnType<typeof fakeWorker>[] = [];
    return {
      started,
      create: () => {
        const fake = fakeWorker();
        started.push(fake);
        return fake.worker;
      },
    };
  }

  it('starts the worker only on the first write', async () => {
    const workers = workerFactory();
    const write = createWorkerWriter(workers.create);
    expect(workers.started).toHaveLength(0);
    const p = write('a.json', new Uint8Array([1]));
    expect(workers.started).toHaveLength(1);
    workers.started[0].reply({ id: 1, ok: true });
    await expect(p).resolves.toBeUndefined();
    const q = write('b.json', new Uint8Array([2]));
    expect(workers.started).toHaveLength(1);
    workers.started[0].reply({ id: 2, ok: true });
    await expect(q).resolves.toBeUndefined();
  });

  it('fails waiting writes when the worker crashes', async () => {
    const workers = workerFactory();
    const write = createWorkerWriter(workers.create);
    const a = write('a.json', new Uint8Array([1]));
    const b = write('b.json', new Uint8Array([2]));
    workers.started[0].crash();
    await expect(a).rejects.toThrow('worker stopped');
    await expect(b).rejects.toThrow('worker stopped');
    expect(workers.started[0].terminated).toBe(true);
  });

  it('starts a fresh worker for the next write after a crash', async () => {
    const workers = workerFactory();
    const write = createWorkerWriter(workers.create);
    const a = write('a.json', new Uint8Array([1]));
    workers.started[0].crash();
    await expect(a).rejects.toThrow('worker stopped');

    const b = write('b.json', new Uint8Array([2]));
    expect(workers.started).toHaveLength(2);
    expect(workers.started[1].posted.map((m) => m.path)).toEqual(['b.json']);
    workers.started[1].reply({ id: 2, ok: true });
    await expect(b).resolves.toBeUndefined();
  });

  it('ignores a crash or reply from a worker it already replaced', async () => {
    const workers = workerFactory();
    const write = createWorkerWriter(workers.create);
    const a = write('a.json', new Uint8Array([1]));
    workers.started[0].crash();
    await expect(a).rejects.toThrow('worker stopped');

    const b = write('b.json', new Uint8Array([2]));
    workers.started[0].crash();
    workers.started[0].reply({ id: 2, ok: false, error: 'stale' });
    workers.started[1].reply({ id: 2, ok: true });
    await expect(b).resolves.toBeUndefined();
    expect(workers.started[1].terminated).toBe(false);
  });

  it('gives up on a worker that stops answering and starts a fresh one', async () => {
    vi.useFakeTimers();
    try {
      const workers = workerFactory();
      const write = createWorkerWriter(workers.create, 1000);
      const a = write('a.json', new Uint8Array([1]));
      const rejected = expect(a).rejects.toThrow('did not answer');
      await vi.advanceTimersByTimeAsync(1000);
      await rejected;
      expect(workers.started[0].terminated).toBe(true);

      const b = write('b.json', new Uint8Array([2]));
      expect(workers.started).toHaveLength(2);
      workers.started[1].reply({ id: 2, ok: true });
      await expect(b).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not time out a write that was answered', async () => {
    vi.useFakeTimers();
    try {
      const workers = workerFactory();
      const write = createWorkerWriter(workers.create, 1000);
      const a = write('a.json', new Uint8Array([1]));
      workers.started[0].reply({ id: 1, ok: true });
      await expect(a).resolves.toBeUndefined();
      await vi.advanceTimersByTimeAsync(5000);
      expect(workers.started[0].terminated).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects instead of hanging when the worker cannot be started', async () => {
    let attempts = 0;
    const fake = fakeWorker();
    const write = createWorkerWriter(() => {
      attempts += 1;
      if (attempts === 1) throw new Error('worker script missing');
      return fake.worker;
    });
    await expect(write('a.json', new Uint8Array([1]))).rejects.toThrow('worker script missing');
    const b = write('b.json', new Uint8Array([2]));
    fake.reply({ id: fake.posted[0].id, ok: true });
    await expect(b).resolves.toBeUndefined();
  });

  it('rejects when posting to the worker throws', async () => {
    const workers = workerFactory();
    const write = createWorkerWriter(workers.create);
    const a = write('a.json', new Uint8Array([1])); // starts the worker
    workers.started[0].failPost = true;
    await expect(write('b.json', new Uint8Array([2]))).rejects.toThrow('could not post');
    // The failed post does not disturb a write that is already waiting.
    workers.started[0].reply({ id: 1, ok: true });
    await expect(a).resolves.toBeUndefined();
  });

  it('resolves and rejects by request id', async () => {
    const workers = workerFactory();
    const write = createWorkerWriter(workers.create);
    const first = write('a.json', new Uint8Array([1]));
    const second = write('b.json', new Uint8Array([2]));
    const fake = workers.started[0];
    expect(fake.posted.map((m) => m.path)).toEqual(['a.json', 'b.json']);
    fake.reply({ id: 2, ok: false, error: 'nope' });
    fake.reply({ id: 1, ok: true });
    fake.reply({ id: 99, ok: true }); // unknown ids are ignored
    await expect(first).resolves.toBeUndefined();
    await expect(second).rejects.toThrow('nope');
  });

  it('uses a default error message', async () => {
    const workers = workerFactory();
    const p = createWorkerWriter(workers.create)('a.json', new Uint8Array([1]));
    workers.started[0].reply({ id: 1, ok: false });
    await expect(p).rejects.toThrow('Write failed');
  });

  it('wraps a non-Error thrown while posting', async () => {
    const fake = fakeWorker();
    (fake.worker as unknown as { postMessage: () => void }).postMessage = () => {
      throw 'cannot clone';
    };
    await expect(createWorkerWriter(() => fake.worker)('a.json', new Uint8Array([1]))).rejects.toThrow('cannot clone');
  });

  describe('while the app is hidden', () => {
    function visibility() {
      let listener: (visible: boolean) => void = () => undefined;
      return {
        watch: (fn: (visible: boolean) => void) => {
          listener = fn;
        },
        set: (visible: boolean) => listener(visible),
      };
    }

    it('does not time out a write while the app is hidden', async () => {
      vi.useFakeTimers();
      try {
        const workers = workerFactory();
        const screen = visibility();
        const write = createWorkerWriter(workers.create, 1000, screen.watch);
        const a = write('a.json', new Uint8Array([1]));
        screen.set(false); // the kid switched apps; iOS suspends the page
        await vi.advanceTimersByTimeAsync(60_000);
        expect(workers.started[0].terminated).toBe(false);
        screen.set(true); // back in the app; the reply arrives just after
        await vi.advanceTimersByTimeAsync(10);
        workers.started[0].reply({ id: 1, ok: true });
        await expect(a).resolves.toBeUndefined();
      } finally {
        vi.useRealTimers();
      }
    });

    it('starts the timeout only once the app is visible again', async () => {
      vi.useFakeTimers();
      try {
        const workers = workerFactory();
        const screen = visibility();
        const write = createWorkerWriter(workers.create, 1000, screen.watch);
        screen.set(false);
        const a = write('a.json', new Uint8Array([1])); // written while hidden: no timer yet
        await vi.advanceTimersByTimeAsync(60_000);
        expect(workers.started[0].terminated).toBe(false);
        screen.set(true);
        const rejected = expect(a).rejects.toThrow('did not answer');
        await vi.advanceTimersByTimeAsync(1000);
        await rejected;
        expect(workers.started[0].terminated).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });

    it('ignores visibility changes when no worker is running', () => {
      const workers = workerFactory();
      const screen = visibility();
      createWorkerWriter(workers.create, 1000, screen.watch);
      expect(() => screen.set(true)).not.toThrow();
      expect(workers.started).toHaveLength(0);
    });
  });
});

describe('documentVisibility', () => {
  it('reports whether the document is visible', () => {
    let onChange: () => void = () => undefined;
    const doc = {
      visibilityState: 'visible',
      addEventListener: (type: string, fn: () => void) => {
        if (type === 'visibilitychange') onChange = fn;
      },
    };
    vi.stubGlobal('document', doc);
    try {
      const seen: boolean[] = [];
      documentVisibility((visible) => seen.push(visible));
      doc.visibilityState = 'hidden';
      onChange();
      doc.visibilityState = 'visible';
      onChange();
      expect(seen).toEqual([false, true]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
