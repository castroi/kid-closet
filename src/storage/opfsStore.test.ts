// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { blobToText } from './fileStore';
import { OpfsFileStore, createWorkerWriter, type DirHandleLike, type FileHandleLike } from './opfsStore';

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
    return {
      posted,
      reply: (data: unknown) => listeners.get('message')?.({ data } as MessageEvent),
      crash: () => listeners.get('error')?.({} as MessageEvent),
      worker: {
        postMessage: (msg: { id: number; path: string }) => posted.push(msg),
        addEventListener: (type: string, fn: (e: MessageEvent) => void) => {
          listeners.set(type, fn);
        },
      } as unknown as Worker,
    };
  }

  it('fails waiting writes when the worker crashes', async () => {
    const fake = fakeWorker();
    const write = createWorkerWriter(fake.worker);
    const a = write('a.json', new Uint8Array([1]));
    const b = write('b.json', new Uint8Array([2]));
    fake.crash();
    await expect(a).rejects.toThrow('worker stopped');
    await expect(b).rejects.toThrow('worker stopped');
  });

  it('resolves and rejects by request id', async () => {
    const fake = fakeWorker();
    const write = createWorkerWriter(fake.worker);
    const first = write('a.json', new Uint8Array([1]));
    const second = write('b.json', new Uint8Array([2]));
    expect(fake.posted.map((m) => m.path)).toEqual(['a.json', 'b.json']);
    fake.reply({ id: 2, ok: false, error: 'nope' });
    fake.reply({ id: 1, ok: true });
    fake.reply({ id: 99, ok: true }); // unknown ids are ignored
    await expect(first).resolves.toBeUndefined();
    await expect(second).rejects.toThrow('nope');
  });

  it('uses a default error message', async () => {
    const fake = fakeWorker();
    const p = createWorkerWriter(fake.worker)('a.json', new Uint8Array([1]));
    fake.reply({ id: 1, ok: false });
    await expect(p).rejects.toThrow('Write failed');
  });
});
