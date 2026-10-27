// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { ItemAttributes } from './attributes';
import { colorFromAttributes, nearestGroup, occasionsFromAttributes, prefillFromAttributes, typeFromAttributes } from './prefill';
import { sampleAttributes } from '../test/data';

const attrs = (patch: Partial<ItemAttributes> = {}): ItemAttributes => ({ ...sampleAttributes(), ...patch });

describe('prefillFromAttributes', () => {
  it("fills the pink t-shirt from the owner's example", () => {
    expect(prefillFromAttributes(attrs())).toEqual({ type: 'tee', colorGroup: 'pink', occasions: ['school', 'casual'] });
  });

  it.each([
    [{ category: 'top', sleeve_length: 'short' }, 'tee'],
    [{ category: 'top', sleeve_length: 'sleeveless', subcategory: 'tank top' }, 'tee'],
    [{ category: 'top', sleeve_length: 'long', subcategory: 'shirt' }, 'longTop'],
    [{ category: 'top', sleeve_length: 'three_quarter', subcategory: 'blouse' }, 'longTop'],
    [{ category: 'top', sleeve_length: null, subcategory: 't-shirt' }, 'tee'],
    [{ category: 'top', sleeve_length: null, subcategory: 'blouse' }, null],
    [{ category: 'top', sleeve_length: 'long', subcategory: 'hoodie' }, 'sweater'],
    [{ category: 'outerwear', subcategory: 'cardigan' }, 'sweater'],
    [{ category: 'outerwear', subcategory: 'zip jacket', material_guess: 'fleece' }, 'sweater'],
    [{ category: 'outerwear', subcategory: 'raincoat', material_guess: 'synthetic' }, 'jacket'],
    [{ category: 'bottom', leg_length: 'shorts', subcategory: 'denim shorts' }, 'shorts'],
    [{ category: 'bottom', leg_length: 'full', subcategory: 'jeans' }, 'pants'],
    [{ category: 'bottom', leg_length: 'capri', subcategory: 'leggings' }, 'pants'],
    [{ category: 'bottom', leg_length: null, subcategory: 'bike shorts' }, 'shorts'],
    [{ category: 'bottom', leg_length: null, subcategory: 'joggers' }, 'pants'],
    [{ category: 'bottom', leg_length: null, subcategory: 'pleated skirt' }, null],
    [{ category: 'bottom', leg_length: 'shorts', subcategory: 'skort' }, null],
    [{ category: 'dress' }, null],
    [{ category: 'shoes' }, null],
    [{ category: 'accessory' }, null],
    [{ category: 'other' }, null],
  ] as const)('maps %o to type %s', (patch, type) => {
    expect(typeFromAttributes(attrs(patch as Partial<ItemAttributes>))).toBe(type);
  });

  it.each([
    ['navy', 'blue'],
    ['light blue', 'blue'],
    ['denim blue', 'blue'],
    ['off-white', 'white'],
    ['cream', 'beige'],
    ['heather grey', 'gray'],
    ['washed blue', 'blue'],
    ['hot pink', 'pink'],
    ['burgundy', 'red'],
    ['olive', 'green'],
    ['lavender', 'purple'],
    ['mustard', 'yellow'],
    ['orange', 'yellow'],
    ['khaki', 'beige'],
    ['chocolate brown', 'brown'],
    ['black', 'black'],
    ['tangerine', 'yellow'],
    ['cream-colored', 'beige'],
    ['golden', 'yellow'],
    ['bluish', 'blue'],
    ['reddish', 'red'],
    ['greyish', 'gray'],
    ['pinkish', 'pink'],
    ['greenish', 'green'],
    ['purplish', 'purple'],
    ['whitish', 'white'],
  ] as const)('maps the colour word "%s" to %s', (primary_color, group) => {
    expect(colorFromAttributes(attrs({ primary_color, busyness: 'low' }))).toBe(group);
  });

  it('never matches a colour inside another word', () => {
    expect(colorFromAttributes(attrs({ primary_color: 'colored', primary_color_hex: null, busyness: 'low' }))).toBeNull();
    expect(colorFromAttributes(attrs({ primary_color: 'stand', primary_color_hex: null, busyness: 'low' }))).toBeNull();
  });

  it.each(['multicolored', 'multi-colour', 'rainbow', 'colorful', 'tie-dye'])('calls "%s" צבעוני', (primary_color) => {
    expect(colorFromAttributes(attrs({ primary_color, busyness: 'low' }))).toBe('multi');
  });

  it('calls a busy print in several colours "צבעוני", but not a plain one', () => {
    expect(colorFromAttributes(attrs({ busyness: 'high', secondary_colors: ['yellow', 'green'] }))).toBe('multi');
    expect(colorFromAttributes(attrs({ busyness: 'high', secondary_colors: ['white'] }))).toBe('pink');
  });

  it('falls back to the nearest swatch for an unknown word, and leaves a near tie empty', () => {
    expect(colorFromAttributes(attrs({ primary_color: 'scarlet-ish', primary_color_hex: '#D64545' }))).toBe('red');
    expect(colorFromAttributes(attrs({ primary_color: 'mystery', primary_color_hex: null }))).toBeNull();
    expect(nearestGroup('#FFFFFF')).toBe('white');
    // The pink t-shirt's own code is almost as close to grey as to pink: no guess from the code alone,
    // which is why the colour word ("pink") is checked first.
    expect(nearestGroup('#D18197')).toBeNull();
    expect(colorFromAttributes(attrs({ primary_color: 'dusty', primary_color_hex: '#D18197' }))).toBeNull();
  });

  it('maps occasions, play and sport to a regular day, in the app order and without repeats', () => {
    expect(occasionsFromAttributes(attrs({ formality: ['party', 'play', 'sport'] }))).toEqual(['casual', 'party']);
    expect(occasionsFromAttributes(attrs({ formality: ['school'] }))).toEqual(['school']);
  });
});
