// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { NOW, closetWith, makeItem, makeOutfit, seededStore } from '../test/data';
import { MemoryFileStore, blobToText } from './fileStore';
import { CLOSET_FILES, ClosetCorruptedError, ClosetRepository } from './repository';

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
