// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { closetWith, makeItem, makeOutfit, NOW } from '../test/data';
import {
  InvalidClosetError,
  NO_FILTER,
  addItem,
  addOutfit,
  applyFilter,
  availableColors,
  findItem,
  hasOutfit,
  isSafeImagePath,
  parseCloset,
  removeItems,
  removeOutfit,
  resolveSelection,
  setStatus,
  slotPool,
  stepSelection,
  updateItem,
} from './closet';
import { SCHEMA_VERSION, defaultName, emptyCloset, slotOf } from './model';

const items = [
  makeItem({ id: 'a', type: 'tee', colorGroup: 'blue', occasions: ['school'] }),
  makeItem({ id: 'b', type: 'longTop', colorGroup: 'white', occasions: ['school', 'party'] }),
  makeItem({ id: 'c', type: 'tee', colorGroup: 'blue', occasions: ['casual'] }),
  makeItem({ id: 'd', type: 'tee', colorGroup: 'pink', occasions: ['school'], status: 'outgrown' }),
  makeItem({ id: 'p', type: 'pants', colorGroup: 'black', occasions: ['school'] }),
  makeItem({ id: 's', type: 'sweater', colorGroup: 'yellow', occasions: ['school'] }),
];

describe('model helpers', () => {
  it('maps types to slots and builds default names', () => {
    expect(slotOf('sweater')).toBe('layer');
    expect(slotOf('shorts')).toBe('bottom');
    expect(defaultName('tee', 'blue')).toBe('חולצה קצרה בצבע כחול');
    expect(emptyCloset()).toEqual({ schemaVersion: SCHEMA_VERSION, items: [], outfits: [], lastBackupAt: null });
  });
});

describe('slotPool and filters', () => {
  it('keeps active items of the slot that fit the occasion', () => {
    expect(slotPool(items, 'top', 'school').map((i) => i.id)).toEqual(['a', 'b']);
    expect(slotPool(items, 'top', 'party').map((i) => i.id)).toEqual(['b']);
    expect(slotPool(items, 'layer', 'school').map((i) => i.id)).toEqual(['s']);
  });

  it('filters by type and colour', () => {
    const pool = slotPool(items, 'top', 'school');
    expect(applyFilter(pool, NO_FILTER)).toHaveLength(2);
    expect(applyFilter(pool, { type: 'tee', color: null }).map((i) => i.id)).toEqual(['a']);
    expect(applyFilter(pool, { type: null, color: 'white' }).map((i) => i.id)).toEqual(['b']);
    expect(applyFilter(pool, { type: 'tee', color: 'white' })).toEqual([]);
  });

  it('lists colours in palette order without duplicates', () => {
    expect(availableColors(items)).toEqual(['blue', 'white', 'pink', 'yellow', 'black']);
  });
});

describe('selection', () => {
  const list = items.slice(0, 3);

  it('falls back to the first item when the selection is gone', () => {
    expect(resolveSelection(list, 'zzz')?.id).toBe('a');
    expect(resolveSelection(list, 'b')?.id).toBe('b');
    expect(resolveSelection([], 'a')).toBeNull();
  });

  it('steps forward and back with wrap-around', () => {
    expect(stepSelection(list, 'a', 1)).toBe('b');
    expect(stepSelection(list, 'c', 1)).toBe('a');
    expect(stepSelection(list, 'a', -1)).toBe('c');
    expect(stepSelection(list, null, 1)).toBe('b');
    expect(stepSelection([], null, 1)).toBeNull();
  });
});

describe('item changes', () => {
  const base = closetWith(items, [makeOutfit({ id: 'o1', topId: 'a', bottomId: 'p', layerId: 's' })]);

  it('adds an item and rejects duplicate ids', () => {
    const next = addItem(base, makeItem({ id: 'new' }));
    expect(findItem(next, 'new')).toBeDefined();
    expect(() => addItem(next, makeItem({ id: 'new' }))).toThrow('already exists');
    expect(findItem(base, null)).toBeUndefined();
  });

  it('updates an item and stamps updatedAt', () => {
    const next = updateItem(base, 'a', { name: 'חדש', occasions: ['party'] }, '2027-01-01');
    expect(findItem(next, 'a')).toMatchObject({ name: 'חדש', occasions: ['party'], updatedAt: '2027-01-01' });
    expect(next.outfits).toHaveLength(1);
  });

  it('drops outfits that become invalid when an item changes slot', () => {
    const next = updateItem(base, 'a', { type: 'sweater' }, NOW);
    expect(next.outfits).toEqual([]);
  });

  it('refuses unknown items and empty occasions', () => {
    expect(() => updateItem(base, 'nope', { name: 'x' }, NOW)).toThrow('not found');
    expect(() => updateItem(base, 'a', { occasions: [] }, NOW)).toThrow('at least one occasion');
  });

  it('sets status for several items', () => {
    const next = setStatus(base, ['a', 'b'], 'outgrown', NOW);
    expect(next.items.filter((i) => i.status === 'outgrown').map((i) => i.id)).toEqual(['a', 'b', 'd']);
  });

  it('removes items and outfits that used them', () => {
    expect(removeItems(base, ['s']).outfits).toEqual([]);
    expect(removeItems(base, ['a']).outfits).toEqual([]);
    expect(removeItems(base, ['p']).outfits).toEqual([]);
    const kept = removeItems(base, ['c']);
    expect(kept.items.map((i) => i.id)).not.toContain('c');
    expect(kept.outfits).toHaveLength(1);
  });
});

describe('outfits', () => {
  const base = closetWith(items);
  const outfit = makeOutfit({ id: 'o1', topId: 'a', bottomId: 'p' });

  it('adds once and removes by id', () => {
    const one = addOutfit(base, outfit);
    expect(hasOutfit(one, outfit)).toBe(true);
    expect(addOutfit(one, { ...outfit, id: 'o2' })).toBe(one);
    expect(removeOutfit(one, 'o1').outfits).toEqual([]);
  });
});

describe('parseCloset', () => {
  const valid = closetWith(items, [makeOutfit({ id: 'o1', topId: 'a', bottomId: 'p' })]);

  it('accepts valid data and removes duplicate occasions', () => {
    const raw = JSON.parse(JSON.stringify(valid));
    raw.items[0].occasions = ['school', 'school'];
    const parsed = parseCloset(raw);
    expect(parsed.items[0].occasions).toEqual(['school']);
    expect(parsed.outfits).toHaveLength(1);
  });

  it('drops outfits that point at missing items', () => {
    const raw = { ...valid, outfits: [makeOutfit({ id: 'x', topId: 'gone', bottomId: 'p' })] };
    expect(parseCloset(raw).outfits).toEqual([]);
  });

  it.each([
    ['not an object', null, 'not an object'],
    ['wrong version', { ...valid, schemaVersion: 99 }, 'schemaVersion'],
    ['items missing', { ...valid, items: 'x' }, 'items'],
    ['outfits missing', { ...valid, outfits: {} }, 'outfits'],
    ['bad backup date', { ...valid, lastBackupAt: 5 }, 'lastBackupAt'],
    ['duplicate ids', { ...valid, items: [items[0], items[0]] }, 'duplicate'],
  ])('rejects %s', (_label, raw, message) => {
    expect(() => parseCloset(raw)).toThrow(InvalidClosetError);
    expect(() => parseCloset(raw)).toThrow(message);
  });

  it.each([
    ['item', 'x'],
    ['id', { id: '' }],
    ['name', { name: 3 }],
    ['type', { type: 'hat' }],
    ['colorGroup', { colorGroup: 'teal' }],
    ['occasions', { occasions: [] }],
    ['occasions', { occasions: ['beach'] }],
    ['status', { status: 'lost' }],
    ['image', { image: '../etc/passwd' }],
    ['image', { image: 'images/someone-else.webp' }],
    ['createdAt', { createdAt: 1 }],
    ['updatedAt', { updatedAt: null }],
  ])('rejects an item with a bad %s', (field, patch) => {
    const bad = typeof patch === 'string' ? patch : { ...items[0], ...patch };
    expect(() => parseCloset({ ...valid, items: [bad], outfits: [] })).toThrow(field === 'item' ? '(item)' : field);
  });

  it.each([
    ['(outfit)', 'x'],
    ['id', { id: 1 }],
    ['occasion', { occasion: 'beach' }],
    ['layerId', { layerId: 3 }],
    ['topId', { topId: null }],
    ['bottomId', { bottomId: 4 }],
    ['createdAt', { createdAt: undefined }],
  ])('rejects an outfit with a bad %s', (field, patch) => {
    const good = makeOutfit({ id: 'o1', topId: 'a', bottomId: 'p' });
    const bad = typeof patch === 'string' ? patch : { ...good, ...patch };
    expect(() => parseCloset({ ...valid, outfits: [bad] })).toThrow(field);
  });

  it('only allows image paths inside the images folder', () => {
    expect(isSafeImagePath('images/abc-1.webp')).toBe(true);
    expect(isSafeImagePath('images/abc.jpg')).toBe(true);
    expect(isSafeImagePath('images/../x.webp')).toBe(false);
    expect(isSafeImagePath('closet-a.json')).toBe(false);
  });
});
