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

/** A store that already holds a saved closet (generation 1) and a photo per item. */
export function seededStore(data: ClosetData): MemoryFileStore {
  const store = new MemoryFileStore();
  store.files.set('closet-b.json', new Blob([JSON.stringify({ generation: 1, savedAt: NOW, closet: data })]));
  for (const item of data.items) store.files.set(item.image, new Blob(['img'], { type: 'image/webp' }));
  return store;
}

let idCounter = 0;
export function testIds(): () => string {
  return () => `id-${++idCounter}`;
}
