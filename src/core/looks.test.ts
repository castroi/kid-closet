// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { NOW, closetWith, makeItem, makeOutfit } from '../test/data';
import {
  findLook,
  lookPartsFor,
  parseCloset,
  promptHash,
  putLook,
  removeItems,
  setLookFlagged,
  storedImagePaths,
} from './closet';
import { dollsLeftText } from './gallery';
import { lookImagePath, type AiLook } from './model';

const items = [
  makeItem({ id: 'shirt', type: 'tee' }),
  makeItem({ id: 'shirt2', type: 'tee' }),
  makeItem({ id: 'jacket', type: 'jacket' }),
  makeItem({ id: 'jeans', type: 'pants' }),
];

function look(partial: Partial<AiLook> & Pick<AiLook, 'id'>): AiLook {
  return {
    dollId: 'default',
    upperId: 'shirt',
    upperSlot: 'top',
    bottomId: 'jeans',
    image: lookImagePath(partial.id, 'webp'),
    provider: 'venice',
    model: 'muse-image-edit',
    promptHash: 'abc',
    flagged: false,
    createdAt: NOW,
    ...partial,
  };
}

describe('what a look is made from', () => {
  it('sends the shirt, or the layer instead when there is one', () => {
    expect(lookPartsFor('d', { layerId: null, topId: 'shirt', bottomId: 'jeans' })).toEqual({
      dollId: 'd',
      upperId: 'shirt',
      upperSlot: 'top',
      bottomId: 'jeans',
    });
    expect(lookPartsFor('d', { layerId: 'jacket', topId: 'shirt', bottomId: 'jeans' })).toEqual({
      dollId: 'd',
      upperId: 'jacket',
      upperSlot: 'layer',
      bottomId: 'jeans',
    });
  });

  it('finds one picture for any shirt under the same layer, and none after the doll changes', () => {
    const data = { ...closetWith(items), aiLooks: [look({ id: 'l1', upperId: 'jacket', upperSlot: 'layer' })] };
    const withShirt = (topId: string) => lookPartsFor('default', { layerId: 'jacket', topId, bottomId: 'jeans' });
    expect(findLook(data, withShirt('shirt'))?.id).toBe('l1');
    expect(findLook(data, withShirt('shirt2'))?.id).toBe('l1');
    expect(findLook(data, lookPartsFor('d2', { layerId: 'jacket', topId: 'shirt', bottomId: 'jeans' }))).toBeUndefined();
  });

  it("replaces an older look for the same parts, and marks one for the parent", () => {
    const data = { ...closetWith(items), aiLooks: [look({ id: 'old' }), look({ id: 'other', upperId: 'shirt2' })] };
    const next = putLook(data, look({ id: 'new' }));
    expect(next.aiLooks.map((l) => l.id)).toEqual(['other', 'new']);
    expect(setLookFlagged(next, 'new', true).aiLooks.find((l) => l.id === 'new')?.flagged).toBe(true);
  });

  it('removes the looks of a deleted garment, and lists their pictures as stored', () => {
    const data = { ...closetWith(items), aiLooks: [look({ id: 'a' }), look({ id: 'b', upperId: 'shirt2' })] };
    expect(storedImagePaths(data)).toContain('images/look-a.webp');
    expect(removeItems(data, ['shirt']).aiLooks.map((l) => l.id)).toEqual(['b']);
    expect(removeItems(data, ['jeans']).aiLooks).toEqual([]);
  });

  it('gives a short, stable id per prompt', () => {
    expect(promptHash('Dress the doll.')).toBe(promptHash('Dress the doll.'));
    expect(promptHash('Dress the doll.')).not.toBe(promptHash('Dress the doll!'));
    expect(promptHash('x'.repeat(4000)).length).toBeLessThanOrEqual(7);
  });
});

describe('reading looks from closet.json', () => {
  const valid = { ...closetWith(items, [makeOutfit({ id: 'o', topId: 'shirt', bottomId: 'jeans' })]), aiLooks: [look({ id: 'l1' })] };

  it('keeps valid looks and drops ones whose garments are gone', () => {
    const raw = JSON.parse(JSON.stringify({ ...valid, aiLooks: [look({ id: 'l1' }), look({ id: 'l2', bottomId: 'gone' })] }));
    expect(parseCloset(raw).aiLooks.map((l) => l.id)).toEqual(['l1']);
  });

  it('loads a version 3 file with no looks', () => {
    const raw: Record<string, unknown> = { ...JSON.parse(JSON.stringify(valid)), schemaVersion: 3 };
    delete raw.aiLooks;
    expect(parseCloset(raw).aiLooks).toEqual([]);
  });

  it.each([
    ['aiLooks is not a list', { aiLooks: {} }],
    ['aiLooks[0].(look)', { aiLooks: ['x'] }],
    ['aiLooks[0].id', { aiLooks: [{ ...look({ id: 'l1' }), id: '../x' }] }],
    ['aiLooks[0].dollId', { aiLooks: [look({ id: 'l1', dollId: '' })] }],
    ['aiLooks[0].upperSlot', { aiLooks: [{ ...look({ id: 'l1' }), upperSlot: 'hat' }] }],
    ['aiLooks[0].image', { aiLooks: [look({ id: 'l1', image: 'images/look-l2.webp' })] }],
    ['aiLooks[0].image', { aiLooks: [look({ id: 'l1', image: 'images/shirt.webp' })] }],
    ['aiLooks[0].provider', { aiLooks: [{ ...look({ id: 'l1' }), provider: 'acme' }] }],
    ['aiLooks[0].promptHash', { aiLooks: [look({ id: 'l1', promptHash: 'x'.repeat(21) })] }],
    ['aiLooks[0].flagged', { aiLooks: [{ ...look({ id: 'l1' }), flagged: 'no' }] }],
    ['duplicate picture', { aiLooks: [look({ id: 'l1' }), look({ id: 'l1', upperId: 'shirt2' })] }],
  ])('rejects %s', (message, patch) => {
    expect(() => parseCloset({ ...valid, ...patch })).toThrow(message);
  });
});

describe('dollsLeftText', () => {
  it('agrees with the number', () => {
    expect(dollsLeftText(1)).toBe('נשארה עוד בובה אחת החודש');
    expect(dollsLeftText(12)).toBe('נשארו עוד 12 בובות החודש');
  });
});
