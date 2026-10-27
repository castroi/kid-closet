// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { makeAnalysis, sampleAttributes } from '../test/data';
import {
  ATTR_TEXT_LIMITS,
  AttributesAnswerError,
  MAX_ANSWER_BYTES,
  parseAttributesAnswer,
  parseStoredAnalysis,
} from './attributes';

/** A model's answer as the prompt asks for it: every field, plus valid_image. */
function answer(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return { valid_image: true, ...sampleAttributes(), ...patch };
}

function parse(patch: Record<string, unknown> = {}) {
  return parseAttributesAnswer(JSON.stringify(answer(patch)));
}

function attributesOf(patch: Record<string, unknown> = {}) {
  const parsed = parse(patch);
  if (parsed.result !== 'ok') throw new Error('expected attributes');
  return parsed.attributes;
}

describe('parseAttributesAnswer', () => {
  it('stores a valid answer as it came', () => {
    expect(parse()).toEqual({ result: 'ok', attributes: sampleAttributes() });
  });

  it('reads an answer wrapped in a code fence', () => {
    const fenced = '```json\n' + JSON.stringify(answer()) + '\n```';
    expect(parseAttributesAnswer(fenced)).toEqual({ result: 'ok', attributes: sampleAttributes() });
    expect(parseAttributesAnswer('```\n' + JSON.stringify(answer()) + '\n```').result).toBe('ok');
  });

  it('ignores fields the schema does not have', () => {
    expect(attributesOf({ brand: 'Acme' })).not.toHaveProperty('brand');
  });

  it('keeps only the notes of a photo that shows no single garment', () => {
    expect(parseAttributesAnswer(JSON.stringify({ valid_image: false, notes: '  Two items in the photo. ', category: 'nonsense' }))).toEqual({
      result: 'invalid-photo',
      notes: 'Two items in the photo.',
    });
    expect(parseAttributesAnswer(JSON.stringify({ valid_image: false }))).toEqual({ result: 'invalid-photo', notes: null });
  });

  it.each([
    ['not JSON', 'Sure! Here is the JSON:'],
    ['not an object', '[1, 2]'],
    ['valid_image', JSON.stringify({ ...answer(), valid_image: 'yes' })],
  ])('refuses an answer that is %s', (detail, text) => {
    expect(() => parseAttributesAnswer(text)).toThrow(new AttributesAnswerError(detail));
  });

  it('refuses an answer over the size limit before parsing it', () => {
    expect(() => parseAttributesAnswer(' '.repeat(MAX_ANSWER_BYTES + 1))).toThrow('answer too large');
    // Fewer characters than the limit, but more bytes: Hebrew letters take two bytes each.
    expect(() => parseAttributesAnswer('א'.repeat(MAX_ANSWER_BYTES / 2 + 1))).toThrow('answer too large');
  });

  it('cuts text by characters, never splitting an emoji', () => {
    const title = '🦖'.repeat(ATTR_TEXT_LIMITS.short_title + 5);
    expect(Array.from(attributesOf({ short_title: title }).short_title)).toEqual(Array(ATTR_TEXT_LIMITS.short_title).fill('🦖'));
  });

  it.each([
    ['category', { category: 'hat' }],
    ['category', { category: undefined }],
    ['subcategory', { subcategory: '   ' }],
    ['primary_color', { primary_color: 3 }],
    ['secondary_colors', { secondary_colors: 'white' }],
    ['secondary_colors', { secondary_colors: [1] }],
    ['color_family', { color_family: 'pastel' }],
    ['pattern', { pattern: null }],
    ['graphic_description', { graphic_description: 5 }],
    ['busyness', { busyness: 'very' }],
    ['formality', { formality: [] }],
    ['formality', { formality: ['play', 'church'] }],
    ['season', { season: 'summer' }],
    ['warmth', { warmth: null }],
    ['sleeve_length', { sleeve_length: 'cap' }],
    ['leg_length', { leg_length: 'knee' }],
    ['material_guess', { material_guess: 'silk' }],
    ['fit', { fit: 'tight' }],
    ['closure', { closure: 'snaps' }],
    ['style_tags', { style_tags: null }],
    ['short_title', { short_title: '' }],
    ['kid_friendly_description', { kid_friendly_description: null }],
    ['confidence', { confidence: 'sure' }],
    ['notes', { notes: 7 }],
  ])('fails the call on a bad %s', (field, patch) => {
    expect(() => parse(patch)).toThrow(new AttributesAnswerError(field));
  });

  it('cuts long text and long lists to their limits', () => {
    const attributes = attributesOf({
      short_title: 'x'.repeat(100),
      notes: 'n'.repeat(400),
      secondary_colors: ['white', 'red', 'blue', 'green', 'gold', 'black', 'gray'],
      style_tags: ['a', 'b', 'c', 'd', 'e', 'f'],
      subcategory: `  ${'s'.repeat(50)}  `,
    });
    expect(attributes.short_title).toHaveLength(ATTR_TEXT_LIMITS.short_title);
    expect(attributes.notes).toHaveLength(ATTR_TEXT_LIMITS.notes);
    expect(attributes.subcategory).toHaveLength(ATTR_TEXT_LIMITS.subcategory);
    expect(attributes.secondary_colors).toEqual(['white', 'red', 'blue', 'green', 'gold']);
    expect(attributes.style_tags).toHaveLength(5);
  });

  it('drops duplicates and empty entries from lists', () => {
    const attributes = attributesOf({ formality: ['play', 'play', 'school'], season: ['mid', 'mid'], secondary_colors: ['white', ' ', 'white'] });
    expect(attributes.formality).toEqual(['play', 'school']);
    expect(attributes.season).toEqual(['mid']);
    expect(attributes.secondary_colors).toEqual(['white']);
  });

  it('stores empty optional text as null', () => {
    expect(attributesOf({ text_on_item: '  ', graphic_description: '' })).toMatchObject({ text_on_item: null, graphic_description: null });
  });

  it('keeps a #RRGGBB colour in capitals and stores anything else as null', () => {
    expect(attributesOf({ primary_color_hex: '#d18197' }).primary_color_hex).toBe('#D18197');
    for (const bad of ['pink', '#FFF', 'D18197', null, 12]) {
      expect(attributesOf({ primary_color_hex: bad }).primary_color_hex).toBeNull();
    }
  });

  it('accepts null in every nullable field', () => {
    const attributes = attributesOf({ sleeve_length: null, material_guess: null, fit: null, closure: null, notes: null });
    expect(attributes).toMatchObject({ sleeve_length: null, material_guess: null, fit: null, closure: null, notes: null });
  });
});

describe('parseStoredAnalysis', () => {
  it('reads a stored analysis back unchanged', () => {
    const analysis = makeAnalysis();
    expect(parseStoredAnalysis(JSON.parse(JSON.stringify(analysis)))).toEqual(analysis);
  });

  it('reads a stored invalid photo', () => {
    const analysis = makeAnalysis({ result: 'invalid-photo', notes: 'No garment in the photo.', attributes: undefined } as never);
    const stored = JSON.parse(JSON.stringify(analysis));
    expect(parseStoredAnalysis(stored)).toEqual({ ...stored });
    expect(parseStoredAnalysis({ ...stored, notes: null })).toMatchObject({ result: 'invalid-photo', notes: null });
  });

  it.each([
    ['not an object', 'ok'],
    ['an unknown result', { ...makeAnalysis(), result: 'maybe' }],
    ['ok without attributes', { ...makeAnalysis(), attributes: null }],
    ['a negative photo revision', makeAnalysis({ photoRevision: -1 })],
    ['a fractional photo revision', makeAnalysis({ photoRevision: 1.5 })],
    ['an unknown provider', { ...makeAnalysis(), provider: 'acme' }],
    ['a model that is too long', makeAnalysis({ model: 'm'.repeat(201) })],
    ['a model that is not text', { ...makeAnalysis(), model: 3 }],
    ['prompt version 0', makeAnalysis({ promptVersion: 0 })],
    ['no date', { ...makeAnalysis(), analyzedAt: undefined }],
    ['a bad enum value', makeAnalysis({ attributes: { ...sampleAttributes(), pattern: 'paisley' as never } })],
    ['text over its limit', makeAnalysis({ attributes: { ...sampleAttributes(), short_title: 'x'.repeat(61) } })],
    ['too many style tags', makeAnalysis({ attributes: { ...sampleAttributes(), style_tags: ['a', 'b', 'c', 'd', 'e', 'f'] } })],
    ['a bad hex', makeAnalysis({ attributes: { ...sampleAttributes(), primary_color_hex: 'pink' } })],
    ['notes of an invalid photo that are not text', { ...makeAnalysis(), result: 'invalid-photo', notes: 4 }],
  ])('drops %s to null instead of failing the closet', (_, raw) => {
    expect(parseStoredAnalysis(JSON.parse(JSON.stringify(raw)))).toBeNull();
  });

  it('keeps a stored analysis whose colour is null', () => {
    const analysis = makeAnalysis({ attributes: { ...sampleAttributes(), primary_color_hex: null } });
    expect(parseStoredAnalysis(JSON.parse(JSON.stringify(analysis)))).toEqual(analysis);
  });
});
