// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { MemoryFileStore, blobToBytes, blobToText, splitPath } from './fileStore';

describe('splitPath', () => {
  it('splits root and one-level paths', () => {
    expect(splitPath('closet-a.json')).toEqual({ dir: null, name: 'closet-a.json' });
    expect(splitPath('images/a.webp')).toEqual({ dir: 'images', name: 'a.webp' });
  });

  it.each(['', 'a/b/c', '../x', 'images/..', '/abs', 'images/'])('rejects %j', (p) => {
    expect(() => splitPath(p)).toThrow('Invalid path');
  });
});

describe('MemoryFileStore', () => {
  it('writes, reads, lists and removes', async () => {
    const store = new MemoryFileStore();
    await store.write('images/a.webp', new Blob(['a']));
    await store.write('images/b.webp', new Blob(['b']));
    await store.write('closet-a.json', new Blob(['{}']));
    expect(await store.list('images')).toEqual(['a.webp', 'b.webp']);
    expect(await blobToText((await store.read('images/a.webp'))!)).toBe('a');
    await store.remove('images/a.webp');
    expect(await store.read('images/a.webp')).toBeNull();
    expect(await store.list('nothing')).toEqual([]);
  });
});

describe('blob helpers', () => {
  it('reads text and bytes', async () => {
    const blob = new Blob(['שלום']);
    expect(await blobToText(blob)).toBe('שלום');
    expect(await blobToBytes(blob)).toEqual(new TextEncoder().encode('שלום'));
  });

  it('falls back when Blob lacks text()/arrayBuffer()', async () => {
    const real = new Blob(['hi']);
    const legacy = Object.create(real, {
      text: { value: undefined },
      arrayBuffer: { value: undefined },
    }) as Blob;
    class FakeReader {
      result: ArrayBuffer | null = null;
      error = null;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      readAsArrayBuffer() {
        real.arrayBuffer().then((buf) => {
          this.result = buf;
          this.onload?.();
        });
      }
    }
    const original = globalThis.FileReader;
    globalThis.FileReader = FakeReader as unknown as typeof FileReader;
    try {
      expect(await blobToText(legacy)).toBe('hi');
    } finally {
      globalThis.FileReader = original;
    }
  });
});
