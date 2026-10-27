import { AI_PROVIDER_IDS, MAX_MODEL_LENGTH, type AiProviderId } from './model';

/**
 * What a vision model says about one garment photo (docs/ai-item-attributes.md §5).
 * Field names stay snake_case, exactly as the prompt's schema sends them.
 */

export const ATTR_CATEGORIES = ['top', 'bottom', 'dress', 'outerwear', 'shoes', 'accessory', 'other'] as const;
export const ATTR_COLOR_FAMILIES = ['neutral', 'colorful'] as const;
export const ATTR_PATTERNS = [
  'solid',
  'stripes',
  'checks_plaid',
  'dots',
  'floral',
  'graphic_print',
  'character_print',
  'camo',
  'animal_print',
  'other',
] as const;
export const ATTR_BUSYNESS = ['low', 'medium', 'high'] as const;
export const ATTR_FORMALITY = ['play', 'school', 'sport', 'party'] as const;
export const ATTR_SEASONS = ['summer', 'mid', 'winter'] as const;
export const ATTR_WARMTH = ['light', 'medium', 'heavy'] as const;
export const ATTR_SLEEVES = ['sleeveless', 'short', 'three_quarter', 'long'] as const;
export const ATTR_LEGS = ['shorts', 'capri', 'full'] as const;
export const ATTR_MATERIALS = ['cotton', 'denim', 'knit', 'fleece', 'synthetic', 'wool', 'leather', 'other'] as const;
export const ATTR_FITS = ['slim', 'regular', 'loose'] as const;
export const ATTR_CLOSURES = ['none', 'buttons', 'zipper', 'velcro', 'laces', 'elastic'] as const;
export const ATTR_CONFIDENCE = ['high', 'medium', 'low'] as const;

export interface ItemAttributes {
  category: (typeof ATTR_CATEGORIES)[number];
  subcategory: string;
  primary_color: string;
  /** '#RRGGBB'; null when the model's value wasn't one. */
  primary_color_hex: string | null;
  secondary_colors: string[];
  color_family: (typeof ATTR_COLOR_FAMILIES)[number];
  pattern: (typeof ATTR_PATTERNS)[number];
  graphic_description: string | null;
  text_on_item: string | null;
  busyness: (typeof ATTR_BUSYNESS)[number];
  formality: (typeof ATTR_FORMALITY)[number][];
  season: (typeof ATTR_SEASONS)[number][];
  warmth: (typeof ATTR_WARMTH)[number];
  sleeve_length: (typeof ATTR_SLEEVES)[number] | null;
  leg_length: (typeof ATTR_LEGS)[number] | null;
  material_guess: (typeof ATTR_MATERIALS)[number] | null;
  fit: (typeof ATTR_FITS)[number] | null;
  closure: (typeof ATTR_CLOSURES)[number] | null;
  style_tags: string[];
  short_title: string;
  kid_friendly_description: string;
  confidence: (typeof ATTR_CONFIDENCE)[number];
  notes: string | null;
}

/** What made an analysis, and from which photo. */
export interface AnalysisMeta {
  /** The item's photoRevision when it was analysed; a replaced photo makes the analysis stale. */
  photoRevision: number;
  provider: AiProviderId;
  model: string;
  promptVersion: number;
  analyzedAt: string;
}

export type AnalysisResult = { result: 'ok'; attributes: ItemAttributes } | { result: 'invalid-photo'; notes: string | null };

export type ItemAnalysis = AnalysisResult & AnalysisMeta;

/** Text limits (plan §5). Answers are cut to them; a stored analysis over them is dropped. */
export const ATTR_TEXT_LIMITS = {
  short_title: 60,
  subcategory: 40,
  primary_color: 40,
  /** Each entry of secondary_colors and style_tags. */
  listEntry: 40,
  graphic_description: 200,
  text_on_item: 200,
  kid_friendly_description: 200,
  notes: 300,
} as const;
export const MAX_SECONDARY_COLORS = 5;
export const MAX_STYLE_TAGS = 5;
/** The answer is text; anything larger is broken or hostile and is refused before parsing. */
export const MAX_ANSWER_BYTES = 64 * 1024;

const HEX = /^#[0-9A-Fa-f]{6}$/;

/** A model's answer that can't be stored. The parent area shows the detail; the kid never does. */
export class AttributesAnswerError extends Error {
  constructor(readonly detail: string) {
    super(`bad attributes answer: ${detail}`);
    this.name = 'AttributesAnswerError';
  }
}

/**
 * How strings and lists over their limits are handled:
 * 'answer' (a model's answer being stored) cuts them; 'stored' (closet.json or a backup) rejects them,
 * because the app itself never saves anything over the limits.
 */
type Mode = 'answer' | 'stored';

class Invalid extends Error {}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function oneOf<T extends string>(values: readonly T[], v: unknown, field: string): T {
  if (typeof v !== 'string' || !(values as readonly string[]).includes(v)) throw new Invalid(field);
  return v as T;
}

function oneOfOrNull<T extends string>(values: readonly T[], v: unknown, field: string): T | null {
  return v === null ? null : oneOf(values, v, field);
}

/** Limits count characters (code points), so cutting never splits an emoji in half. */
function text(v: unknown, limit: number, mode: Mode, field: string): string {
  if (typeof v !== 'string') throw new Invalid(field);
  const trimmed = v.trim();
  const chars = Array.from(trimmed);
  if (chars.length > limit) {
    if (mode === 'stored') throw new Invalid(field);
    return chars.slice(0, limit).join('').trim();
  }
  return trimmed;
}

/** A required string: never empty. */
function requiredText(v: unknown, limit: number, mode: Mode, field: string): string {
  const value = text(v, limit, mode, field);
  if (value.length === 0) throw new Invalid(field);
  return value;
}

/** A nullable string: an empty one is stored as null. */
function optionalText(v: unknown, limit: number, mode: Mode, field: string): string | null {
  if (v === null) return null;
  return text(v, limit, mode, field) || null;
}

function textList(v: unknown, max: number, mode: Mode, field: string): string[] {
  if (!Array.isArray(v)) throw new Invalid(field);
  const values = [...new Set(v.map((entry) => text(entry, ATTR_TEXT_LIMITS.listEntry, mode, field)).filter(Boolean))];
  if (values.length > max) {
    if (mode === 'stored') throw new Invalid(field);
    return values.slice(0, max);
  }
  return values;
}

/** One or more values from a fixed list, without duplicates; an empty list is never valid. */
function enumList<T extends string>(values: readonly T[], v: unknown, field: string): T[] {
  if (!Array.isArray(v)) throw new Invalid(field);
  const picked = [...new Set(v.map((entry) => oneOf(values, entry, field)))];
  if (picked.length === 0) throw new Invalid(field);
  return picked;
}

function hex(v: unknown, mode: Mode): string | null {
  if (v === null && mode === 'stored') return null;
  if (typeof v === 'string' && HEX.test(v.trim())) return v.trim().toUpperCase();
  if (mode === 'stored') throw new Invalid('primary_color_hex');
  return null; // a model's approximate colour that isn't #RRGGBB isn't worth failing a paid call
}

function readAttributes(raw: Record<string, unknown>, mode: Mode): ItemAttributes {
  const L = ATTR_TEXT_LIMITS;
  return {
    category: oneOf(ATTR_CATEGORIES, raw.category, 'category'),
    subcategory: requiredText(raw.subcategory, L.subcategory, mode, 'subcategory'),
    primary_color: requiredText(raw.primary_color, L.primary_color, mode, 'primary_color'),
    primary_color_hex: hex(raw.primary_color_hex, mode),
    secondary_colors: textList(raw.secondary_colors, MAX_SECONDARY_COLORS, mode, 'secondary_colors'),
    color_family: oneOf(ATTR_COLOR_FAMILIES, raw.color_family, 'color_family'),
    pattern: oneOf(ATTR_PATTERNS, raw.pattern, 'pattern'),
    graphic_description: optionalText(raw.graphic_description, L.graphic_description, mode, 'graphic_description'),
    text_on_item: optionalText(raw.text_on_item, L.text_on_item, mode, 'text_on_item'),
    busyness: oneOf(ATTR_BUSYNESS, raw.busyness, 'busyness'),
    formality: enumList(ATTR_FORMALITY, raw.formality, 'formality'),
    season: enumList(ATTR_SEASONS, raw.season, 'season'),
    warmth: oneOf(ATTR_WARMTH, raw.warmth, 'warmth'),
    sleeve_length: oneOfOrNull(ATTR_SLEEVES, raw.sleeve_length, 'sleeve_length'),
    leg_length: oneOfOrNull(ATTR_LEGS, raw.leg_length, 'leg_length'),
    material_guess: oneOfOrNull(ATTR_MATERIALS, raw.material_guess, 'material_guess'),
    fit: oneOfOrNull(ATTR_FITS, raw.fit, 'fit'),
    closure: oneOfOrNull(ATTR_CLOSURES, raw.closure, 'closure'),
    style_tags: textList(raw.style_tags, MAX_STYLE_TAGS, mode, 'style_tags'),
    short_title: requiredText(raw.short_title, L.short_title, mode, 'short_title'),
    kid_friendly_description: requiredText(raw.kid_friendly_description, L.kid_friendly_description, mode, 'kid_friendly_description'),
    confidence: oneOf(ATTR_CONFIDENCE, raw.confidence, 'confidence'),
    notes: optionalText(raw.notes, L.notes, mode, 'notes'),
  };
}

/** Some models wrap JSON in a Markdown code fence even when told not to. */
function stripCodeFence(answer: string): string {
  const fenced = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i.exec(answer.trim());
  return fenced ? fenced[1] : answer;
}

/**
 * Turns a model's answer (the message text) into what is stored on the item.
 * Throws AttributesAnswerError when it can't be stored; that call still counted.
 * Fields the schema doesn't know are ignored.
 */
export function parseAttributesAnswer(answer: string): AnalysisResult {
  // Every UTF-16 unit is at least one byte, so a long string is refused before it is copied to count its bytes.
  if (answer.length > MAX_ANSWER_BYTES || new TextEncoder().encode(answer).length > MAX_ANSWER_BYTES) {
    throw new AttributesAnswerError('answer too large');
  }
  let raw: unknown;
  try {
    raw = JSON.parse(stripCodeFence(answer));
  } catch {
    throw new AttributesAnswerError('not JSON');
  }
  if (!isRecord(raw)) throw new AttributesAnswerError('not an object');
  if (typeof raw.valid_image !== 'boolean') throw new AttributesAnswerError('valid_image');
  try {
    // The other fields of an invalid photo are guesses the prompt says will be ignored.
    if (!raw.valid_image) return { result: 'invalid-photo', notes: optionalText(raw.notes ?? null, ATTR_TEXT_LIMITS.notes, 'answer', 'notes') };
    return { result: 'ok', attributes: readAttributes(raw, 'answer') };
  } catch (err) {
    if (err instanceof Invalid) throw new AttributesAnswerError(err.message);
    throw err;
  }
}

/**
 * Reads an item's analysis from closet.json or a backup. Anything that doesn't validate
 * comes back as null (not analysed): an analysis can be made again, so it must never
 * send her to the recovery screen.
 */
export function parseStoredAnalysis(raw: unknown): ItemAnalysis | null {
  if (!isRecord(raw)) return null;
  const { result, photoRevision, provider, model, promptVersion, analyzedAt } = raw;
  if (typeof photoRevision !== 'number' || !Number.isInteger(photoRevision) || photoRevision < 0) return null;
  if (!AI_PROVIDER_IDS.includes(provider as AiProviderId)) return null;
  if (typeof model !== 'string' || model.length > MAX_MODEL_LENGTH) return null;
  if (typeof promptVersion !== 'number' || !Number.isInteger(promptVersion) || promptVersion < 1) return null;
  if (typeof analyzedAt !== 'string') return null;
  const meta: AnalysisMeta = { photoRevision, provider: provider as AiProviderId, model, promptVersion, analyzedAt };
  try {
    if (result === 'invalid-photo') {
      return { result, notes: optionalText(raw.notes, ATTR_TEXT_LIMITS.notes, 'stored', 'notes'), ...meta };
    }
    if (result === 'ok' && isRecord(raw.attributes)) {
      return { result, attributes: readAttributes(raw.attributes, 'stored'), ...meta };
    }
    return null;
  } catch (err) {
    if (err instanceof Invalid) return null;
    throw err;
  }
}
