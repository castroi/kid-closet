import { closetImagePaths } from '../core/closet';
import { emptyCloset, type ClosetData, type Item, type Outfit } from '../core/model';
import { MemoryFileStore } from '../storage/fileStore';

export const NOW = '2026-10-24T08:00:00.000Z';

export function makeItem(partial: Partial<Item> & Pick<Item, 'id'>): Item {
  return {
    name: partial.id,
    type: 'tee',
    colorGroup: 'blue',
    occasions: ['school'],
    status: 'active',
    image: `images/${partial.id}.webp`,
    createdAt: NOW,
    updatedAt: NOW,
    ...partial,
  };
}

export function makeOutfit(partial: Partial<Outfit> & Pick<Outfit, 'id' | 'topId' | 'bottomId'>): Outfit {
  return { occasion: 'school', layerId: null, createdAt: NOW, ...partial };
}

export function closetWith(items: Item[], outfits: Outfit[] = []): ClosetData {
  return { ...emptyCloset(), items, outfits };
}

/**
 * The smallest well-formed photo files: correct structure and no metadata, so a
 * restore keeps them byte for byte. They are not decodable pictures.
 */
export function testPhoto(ext: 'webp' | 'jpg'): Uint8Array {
  if (ext === 'jpg') {
    // SOI, APP0 (length 4), SOS (length 2), two bytes of image data, EOI
    return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xda, 0x00, 0x02, 0x11, 0x22, 0xff, 0xd9]);
  }
  // "RIFF", size 18, "WEBP", then a VP8L chunk of 5 bytes plus one padding byte
  return new Uint8Array([
    0x52, 0x49, 0x46, 0x46, 18, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
    0x56, 0x50, 0x38, 0x4c, 5, 0, 0, 0, 0x2f, 0, 0, 0, 0, 0,
  ]);
}

/** A store that already holds a saved closet (generation 1) and every photo it uses (items and doll). */
export function seededStore(data: ClosetData): MemoryFileStore {
  const store = new MemoryFileStore();
  store.files.set('closet-b.json', new Blob([JSON.stringify({ generation: 1, savedAt: NOW, closet: data })]));
  for (const path of closetImagePaths(data)) {
    const jpg = path.endsWith('.jpg');
    store.files.set(path, new Blob([testPhoto(jpg ? 'jpg' : 'webp') as BlobPart], { type: jpg ? 'image/jpeg' : 'image/webp' }));
  }
  return store;
}

/** A closet whose doll is the parent's own picture. */
export function withDoll(data: ClosetData, id = 'd1', ext: 'webp' | 'jpg' = 'webp'): ClosetData {
  return { ...data, doll: { id, image: `images/doll-${id}.${ext}` } };
}

let idCounter = 0;
export function testIds(): () => string {
  return () => `id-${++idCounter}`;
}

/** The same closet as a version 1 file wrote it: before the doll existed. */
export function asVersion1(data: ClosetData): Record<string, unknown> {
  const raw: Record<string, unknown> = { ...JSON.parse(JSON.stringify(data)), schemaVersion: 1 };
  delete raw.doll;
  return raw;
}
