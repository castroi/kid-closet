// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { NOW, asVersion1, closetWith, makeItem, makeOutfit, seededStore, withDoll } from '../test/data';
import { MemoryFileStore, blobToText } from './fileStore';
import {
  CLOSET_FILES,
  ClosetChangedElsewhereError,
  ClosetCorruptedError,
  ClosetRepository,
  WRITE_LOCK_WAIT_MS,
  webWriteLock,
  type WriteLock,
} from './repository';

const image = { blob: new Blob(['photo'], { type: 'image/webp' }), ext: 'webp' as const };
const newItem = { name: 'חולצה', type: 'tee' as const, colorGroup: 'blue' as const, occasions: ['school' as const] };

function sequentialIds() {
  let n = 0;
  return () => `item${++n}`;
}

async function savedGeneration(store: MemoryFileStore, file: string): Promise<number | null> {
  const blob = store.files.get(file);
  return blob ? (JSON.parse(await blobToText(blob)) as { generation: number }).generation : null;
}

describe('ClosetRepository', () => {
  it('starts empty when nothing is saved', async () => {
    const repo = new ClosetRepository(new MemoryFileStore(), () => NOW);
    const data = await repo.load();
    expect(data.items).toEqual([]);
    expect(repo.getData()).toBe(data);
  });

  it('adds an item: writes the photo, then the closet file', async () => {
    const store = new MemoryFileStore();
    const repo = new ClosetRepository(store, () => NOW, sequentialIds());
    await repo.load();
    const item = await repo.addItem(newItem, image);
    expect(item).toMatchObject({ id: 'item1', image: 'images/item1.webp', status: 'active', createdAt: NOW });
    expect(store.files.has('images/item1.webp')).toBe(true);
    expect(await savedGeneration(store, 'closet-b.json')).toBe(1);

    const reloaded = new ClosetRepository(store, () => NOW);
    expect((await reloaded.load()).items.map((i) => i.id)).toEqual(['item1']);
  });

  it('alternates between the two closet files and loads the newest', async () => {
    const store = new MemoryFileStore();
    const repo = new ClosetRepository(store, () => NOW, sequentialIds());
    await repo.load();
    await repo.addItem(newItem, image); // generation 1 -> closet-b
    await repo.addItem(newItem, image); // generation 2 -> closet-a
    await repo.update((d) => ({ ...d, lastBackupAt: NOW })); // generation 3 -> closet-b
    expect(await savedGeneration(store, 'closet-a.json')).toBe(2);
    expect(await savedGeneration(store, 'closet-b.json')).toBe(3);

    const reloaded = new ClosetRepository(store, () => NOW);
    const data = await reloaded.load();
    expect(data.items).toHaveLength(2);
    expect(data.lastBackupAt).toBe(NOW);
  });

  it('falls back to the older file when the newest one is damaged', async () => {
    const store = seededStore(closetWith([makeItem({ id: 'a' })]));
    store.files.set('closet-a.json', new Blob(['{"generation": 2, "closet": {broken']));
    const data = await new ClosetRepository(store).load();
    expect(data.items.map((i) => i.id)).toEqual(['a']);
  });

  it.each([
    ['no generation', { closet: {} }],
    ['zero generation', { generation: 0, closet: {} }],
  ])('ignores an envelope with %s', async (_label, envelope) => {
    const store = seededStore(closetWith([makeItem({ id: 'a' })]));
    store.files.set('closet-a.json', new Blob([JSON.stringify(envelope)]));
    expect((await new ClosetRepository(store).load()).items).toHaveLength(1);
  });

  it('refuses to start empty when every closet file is damaged', async () => {
    const store = new MemoryFileStore();
    for (const f of CLOSET_FILES) store.files.set(f, new Blob(['garbage']));
    await expect(new ClosetRepository(store).load()).rejects.toBeInstanceOf(ClosetCorruptedError);
    // Nothing was overwritten.
    expect(await blobToText(store.files.get('closet-a.json')!)).toBe('garbage');
  });

  it('saves above a newer generation it cannot read', async () => {
    const store = new MemoryFileStore();
    // A newer app version wrote generation 7 in a format this version rejects.
    store.files.set('closet-a.json', new Blob([JSON.stringify({ generation: 7, closet: { schemaVersion: 99 } })]));
    const repo = new ClosetRepository(store, () => NOW);
    await expect(repo.load()).rejects.toBeInstanceOf(ClosetCorruptedError);
    await repo.replaceAll(closetWith([makeItem({ id: 'r' })]), new Map([['images/r.webp', new Blob(['r'])]]));
    expect(await savedGeneration(store, 'closet-a.json')).toBe(8);
    expect((await new ClosetRepository(store).load()).items.map((i) => i.id)).toEqual(['r']);
  });

  it('removes orphan photos on load', async () => {
    const store = seededStore(closetWith([makeItem({ id: 'a' })]));
    store.files.set('images/orphan.webp', new Blob(['x']));
    await new ClosetRepository(store).load();
    expect(store.files.has('images/orphan.webp')).toBe(false);
    expect(store.files.has('images/a.webp')).toBe(true);
  });

  it('keeps the photos of a newer generation it cannot read', async () => {
    const store = seededStore(closetWith([makeItem({ id: 'a' })])); // generation 1 in closet-b
    // A newer app version wrote generation 2 with a photo this version does not know about.
    store.files.set('closet-a.json', new Blob([JSON.stringify({ generation: 2, closet: { schemaVersion: 99 } })]));
    store.files.set('images/b.webp', new Blob(['newer']));
    const repo = new ClosetRepository(store, () => NOW);
    const data = await repo.load();
    expect(data.items.map((i) => i.id)).toEqual(['a']);
    expect(store.files.has('images/b.webp')).toBe(true);
    expect(store.files.has('images/a.webp')).toBe(true);
    // Saving still goes above the generation it could not read.
    await repo.update((d) => ({ ...d, lastBackupAt: NOW }));
    expect(await savedGeneration(store, 'closet-b.json')).toBe(3);
    // The unreadable file is still on disk, so the next launch keeps its photo too.
    await new ClosetRepository(store).load();
    expect(store.files.has('images/b.webp')).toBe(true);
  });

  it('keeps photos when a closet file cannot even be parsed', async () => {
    const store = seededStore(closetWith([makeItem({ id: 'a' })]));
    store.files.set('closet-a.json', new Blob(['{"generation": 2, "closet": {broken']));
    store.files.set('images/b.webp', new Blob(['maybe the newer closet']));
    await new ClosetRepository(store).load();
    expect(store.files.has('images/b.webp')).toBe(true);
  });

  it('removes orphans again once saves have replaced the unreadable file', async () => {
    const store = seededStore(closetWith([makeItem({ id: 'a' })])); // generation 1 in closet-b
    store.files.set('closet-a.json', new Blob(['garbage']));
    store.files.set('images/orphan.webp', new Blob(['x']));
    const repo = new ClosetRepository(store, () => NOW);
    await repo.load();
    await repo.update((d) => ({ ...d, lastBackupAt: NOW })); // generation 2 -> closet-a
    expect(store.files.has('images/orphan.webp')).toBe(true);
    await new ClosetRepository(store).load();
    expect(store.files.has('images/orphan.webp')).toBe(false);
  });

  it('opens the closet even when photo cleanup fails', async () => {
    const store = seededStore(closetWith([makeItem({ id: 'a' })]));
    vi.spyOn(store, 'list').mockRejectedValue(new Error('listing failed'));
    const data = await new ClosetRepository(store).load();
    expect(data.items.map((i) => i.id)).toEqual(['a']);
  });

  it('finishes a restore even when photo cleanup fails', async () => {
    const store = new MemoryFileStore();
    const repo = new ClosetRepository(store, () => NOW);
    await repo.load();
    vi.spyOn(store, 'list').mockRejectedValue(new Error('listing failed'));
    const saved = await repo.replaceAll(closetWith([makeItem({ id: 'r' })]), new Map([['images/r.webp', new Blob(['r'])]]));
    expect(saved.items.map((i) => i.id)).toEqual(['r']);
    expect(store.files.has('images/r.webp')).toBe(true);
  });

  it('cleans up the photo when saving the closet fails', async () => {
    const store = new MemoryFileStore();
    const repo = new ClosetRepository(store, () => NOW, sequentialIds());
    await repo.load();
    const write = store.write.bind(store);
    vi.spyOn(store, 'write').mockImplementation(async (path, data) => {
      if (path.endsWith('.json')) throw new Error('disk full');
      return write(path, data);
    });
    await expect(repo.addItem(newItem, image)).rejects.toThrow('disk full');
    expect(store.files.has('images/item1.webp')).toBe(false);
    expect(repo.getData().items).toEqual([]);
  });

  it("replaces the doll: writes the new picture, saves, then deletes the old one", async () => {
    const store = seededStore(withDoll(closetWith([makeItem({ id: 'a' })]), 'old'));
    const repo = new ClosetRepository(store, () => NOW, () => 'new');
    await repo.load();
    const data = await repo.setDoll({ blob: new Blob(['doll'], { type: 'image/jpeg' }), ext: 'jpg' });
    expect(data.doll).toEqual({ id: 'new', image: 'images/doll-new.jpg' });
    expect(store.files.has('images/doll-new.jpg')).toBe(true);
    expect(store.files.has('images/doll-old.webp')).toBe(false);
    expect(store.files.has('images/a.webp')).toBe(true);
    expect((await new ClosetRepository(store).load()).doll.id).toBe('new');
  });

  it('goes back to the bundled doll and deletes the parent picture', async () => {
    const store = seededStore(withDoll(closetWith([])));
    const repo = new ClosetRepository(store, () => NOW);
    await repo.load();
    const data = await repo.resetDoll();
    expect(data.doll).toEqual({ id: 'default', image: null });
    expect(store.files.has('images/doll-d1.webp')).toBe(false);
  });

  it('keeps the doll picture when cleaning up orphan photos', async () => {
    const store = seededStore(withDoll(closetWith([])));
    store.files.set('images/orphan.webp', new Blob(['x']));
    await new ClosetRepository(store, () => NOW).load();
    expect(store.files.has('images/doll-d1.webp')).toBe(true);
    expect(store.files.has('images/orphan.webp')).toBe(false);
  });

  it('keeps the old doll and removes the new picture when saving fails', async () => {
    const store = seededStore(withDoll(closetWith([]), 'old'));
    const repo = new ClosetRepository(store, () => NOW, () => 'new');
    await repo.load();
    const write = store.write.bind(store);
    vi.spyOn(store, 'write').mockImplementation(async (path, data) => {
      if (path.endsWith('.json')) throw new Error('disk full');
      return write(path, data);
    });
    await expect(repo.setDoll(image)).rejects.toThrow('disk full');
    expect(store.files.has('images/doll-new.webp')).toBe(false);
    expect(store.files.has('images/doll-old.webp')).toBe(true);
    expect(repo.getData().doll.id).toBe('old');
  });

  it('saves a version 1 closet as the current version, keeping everything', async () => {
    const v1 = asVersion1(closetWith([makeItem({ id: 'a' })]));
    const store = new MemoryFileStore();
    store.files.set('closet-b.json', new Blob([JSON.stringify({ generation: 1, savedAt: NOW, closet: v1 })]));
    store.files.set('images/a.webp', new Blob(['a']));
    const repo = new ClosetRepository(store, () => NOW);
    await repo.load();
    await repo.update((d) => d);
    const saved = JSON.parse(await blobToText(store.files.get('closet-a.json')!)) as { closet: { schemaVersion: number } };
    expect(saved.closet.schemaVersion).toBe(2);
    expect(store.files.has('images/a.webp')).toBe(true);
  });

  it('keeps working after a failed operation', async () => {
    const repo = new ClosetRepository(new MemoryFileStore(), () => NOW, sequentialIds());
    await repo.load();
    await expect(
      repo.update(() => {
        throw new Error('bad change');
      }),
    ).rejects.toThrow('bad change');
    await repo.addItem(newItem, image);
    expect(repo.getData().items).toHaveLength(1);
  });

  it('deletes items, their photos and outfits that used them', async () => {
    const data = closetWith(
      [makeItem({ id: 't' }), makeItem({ id: 'b', type: 'pants' }), makeItem({ id: 'keep' })],
      [makeOutfit({ id: 'o', topId: 't', bottomId: 'b' })],
    );
    const store = seededStore(data);
    const repo = new ClosetRepository(store, () => NOW);
    await repo.load();
    const next = await repo.deleteItems(['t']);
    expect(next.items.map((i) => i.id)).toEqual(['b', 'keep']);
    expect(next.outfits).toEqual([]);
    expect(store.files.has('images/t.webp')).toBe(false);
    expect(store.files.has('images/keep.webp')).toBe(true);
  });

  it('serialises concurrent writes', async () => {
    const store = new MemoryFileStore();
    const repo = new ClosetRepository(store, () => NOW, sequentialIds());
    await repo.load();
    await Promise.all([repo.addItem(newItem, image), repo.addItem(newItem, image), repo.addItem(newItem, image)]);
    const reloaded = await new ClosetRepository(store).load();
    expect(reloaded.items.map((i) => i.id)).toEqual(['item1', 'item2', 'item3']);
  });

  it('replaces everything from a backup and removes photos no longer used', async () => {
    const store = seededStore(closetWith([makeItem({ id: 'old' })]));
    const repo = new ClosetRepository(store, () => NOW);
    await repo.load();
    const incoming = closetWith([makeItem({ id: 'new' })]);
    await repo.replaceAll(incoming, new Map([['images/new.webp', new Blob(['n'])]]));
    expect(repo.getData().items.map((i) => i.id)).toEqual(['new']);
    expect(store.files.has('images/old.webp')).toBe(false);
    expect(store.files.has('images/new.webp')).toBe(true);
  });

  it('refuses a restore with a missing photo', async () => {
    const repo = new ClosetRepository(new MemoryFileStore(), () => NOW);
    await repo.load();
    await expect(repo.replaceAll(closetWith([makeItem({ id: 'x' })]), new Map())).rejects.toThrow('Missing photo');
  });

  it('reads photos through the store', async () => {
    const store = seededStore(closetWith([makeItem({ id: 'a' })]));
    const repo = new ClosetRepository(store);
    expect(await repo.readImage('images/a.webp')).not.toBeNull();
    expect(await repo.readImage('images/none.webp')).toBeNull();
  });
});

describe('two open copies of the app', () => {
  async function twoCopies() {
    const store = seededStore(closetWith([makeItem({ id: 'a' })]));
    const first = new ClosetRepository(store, () => NOW, () => 'fromFirst');
    const second = new ClosetRepository(store, () => NOW, () => 'fromSecond');
    await first.load();
    await second.load();
    return { store, first, second };
  }

  it('refuses a save that would overwrite the other copy, and keeps its change', async () => {
    const { store, first, second } = await twoCopies();
    await second.addItem(newItem, image);
    await expect(first.update((d) => ({ ...d, lastBackupAt: NOW }))).rejects.toBeInstanceOf(ClosetChangedElsewhereError);
    const onDisk = await new ClosetRepository(store).load();
    expect(onDisk.items.map((i) => i.id)).toEqual(['a', 'fromSecond']);
    expect(onDisk.lastBackupAt).toBeNull();
  });

  it('saves again once it has reloaded the newer closet', async () => {
    const { store, first, second } = await twoCopies();
    await second.update((d) => ({ ...d, lastBackupAt: NOW }));
    await expect(first.update((d) => d)).rejects.toBeInstanceOf(ClosetChangedElsewhereError);
    await first.load();
    await first.addItem(newItem, image);
    const onDisk = await new ClosetRepository(store).load();
    expect(onDisk.items.map((i) => i.id).sort()).toEqual(['a', 'fromFirst']);
    expect(onDisk.lastBackupAt).toBe(NOW);
  });

  it('removes the photo of a refused new item', async () => {
    const { store, first, second } = await twoCopies();
    await second.update((d) => d);
    await expect(first.addItem(newItem, image)).rejects.toBeInstanceOf(ClosetChangedElsewhereError);
    expect(store.files.has('images/fromFirst.webp')).toBe(false);
    expect(first.getData().items.map((i) => i.id)).toEqual(['a']);
  });

  it('keeps the photos of a refused delete', async () => {
    const { store, first, second } = await twoCopies();
    await second.update((d) => d);
    await expect(first.deleteItems(['a'])).rejects.toBeInstanceOf(ClosetChangedElsewhereError);
    expect(store.files.has('images/a.webp')).toBe(true);
  });

  it('lets a restore replace the closet, saving above the other copy', async () => {
    const { store, first, second } = await twoCopies();
    await second.update((d) => d); // generation 2
    await second.update((d) => d); // generation 3
    await first.replaceAll(closetWith([makeItem({ id: 'r' })]), new Map([['images/r.webp', new Blob(['r'])]]));
    expect(await savedGeneration(store, CLOSET_FILES[0])).toBe(4);
    expect((await new ClosetRepository(store).load()).items.map((i) => i.id)).toEqual(['r']);
  });

  it('runs every file access of every operation inside the shared write lock', async () => {
    const store = seededStore(closetWith([makeItem({ id: 'a' })]));
    let inside = false;
    const outside: string[] = [];
    const lock: WriteLock = async (fn) => {
      inside = true;
      try {
        return await fn();
      } finally {
        inside = false;
      }
    };
    for (const method of ['read', 'write', 'remove', 'list'] as const) {
      const original = store[method].bind(store) as unknown as (...args: unknown[]) => Promise<unknown>;
      vi.spyOn(store, method).mockImplementation((async (...args: unknown[]) => {
        if (!inside) outside.push(`${method} ${String(args[0])}`);
        return original(...args);
      }) as never);
    }
    const repo = new ClosetRepository(store, () => NOW, () => 'x', lock);
    await repo.load(); // reads both closet files, lists photos
    await repo.addItem(newItem, image); // photo write, generation check, closet write
    await repo.update((d) => d);
    await repo.snapshot();
    await repo.deleteItems(['a']); // closet write, then photo removal
    await repo.setDoll(image); // picture write, closet write
    await repo.resetDoll(); // closet write, then picture removal
    await repo.replaceAll(closetWith([makeItem({ id: 'r' })]), new Map([['images/r.webp', new Blob(['r'])]]));
    expect(outside).toEqual([]);
  });

  it('never takes the lock twice in one operation (it is not re-entrant)', async () => {
    let depth = 0;
    let deepest = 0;
    const lock: WriteLock = async (fn) => {
      depth += 1;
      deepest = Math.max(deepest, depth);
      try {
        return await fn();
      } finally {
        depth -= 1;
      }
    };
    const repo = new ClosetRepository(seededStore(closetWith([makeItem({ id: 'a' })])), () => NOW, () => 'x', lock);
    await repo.load();
    await repo.addItem(newItem, image);
    await repo.deleteItems(['a']);
    await repo.setDoll(image);
    await repo.resetDoll();
    await repo.replaceAll(closetWith([]), new Map());
    expect(deepest).toBe(1);
  });
});

describe('webWriteLock', () => {
  it('is missing where the phone has no Web Locks', () => {
    expect(webWriteLock(undefined)).toBeUndefined();
  });

  it('runs the operation under one lock name, gives up waiting after a while, and returns its result', async () => {
    const request = vi.fn((_name: string, _options: LockOptions, callback: () => unknown) => Promise.resolve(callback()));
    const signal = new AbortController().signal;
    const timeoutSignal = vi.fn(() => signal);
    const lock = webWriteLock({ request } as unknown as Pick<LockManager, 'request'>, timeoutSignal)!;
    await expect(lock(async () => 42)).resolves.toBe(42);
    expect(request).toHaveBeenCalledWith('kid-closet-write', { signal }, expect.any(Function));
    expect(timeoutSignal).toHaveBeenCalledWith(WRITE_LOCK_WAIT_MS);
  });

  it('waits without a limit where the phone has no AbortSignal.timeout', async () => {
    const request = vi.fn((_name: string, _options: LockOptions, callback: () => unknown) => Promise.resolve(callback()));
    const lock = webWriteLock({ request } as unknown as Pick<LockManager, 'request'>, null)!;
    await expect(lock(async () => 'ok')).resolves.toBe('ok');
    expect(request).toHaveBeenCalledWith('kid-closet-write', {}, expect.any(Function));
  });

  it('reports a timed-out wait as an error', async () => {
    const request = vi.fn(() => Promise.reject(new DOMException('timed out', 'AbortError')));
    const lock = webWriteLock({ request } as unknown as Pick<LockManager, 'request'>, () => new AbortController().signal)!;
    await expect(lock(async () => 1)).rejects.toThrow('timed out');
  });
});
