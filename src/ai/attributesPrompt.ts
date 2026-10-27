import {
  ATTR_BUSYNESS,
  ATTR_CATEGORIES,
  ATTR_CLOSURES,
  ATTR_COLOR_FAMILIES,
  ATTR_CONFIDENCE,
  ATTR_FITS,
  ATTR_FORMALITY,
  ATTR_LEGS,
  ATTR_MATERIALS,
  ATTR_PATTERNS,
  ATTR_SEASONS,
  ATTR_SLEEVES,
  ATTR_WARMTH,
  MAX_STYLE_TAGS,
} from '../core/attributes';

/**
 * Raised whenever the prompt or the schema changes, and recorded with every analysis.
 * Older analyses still count as done (docs/ai-item-attributes.md §5).
 */
export const ATTRIBUTES_PROMPT_VERSION = 1;

/**
 * The instruction sent with one garment photo. Built in: the parent can't edit it,
 * because the answer is validated against ATTRIBUTES_SCHEMA (docs/ai-item-attributes.md §6).
 */
export const ATTRIBUTES_PROMPT = `You are a clothing-cataloging assistant for a children's closet app.
You will receive one photo of a single clothing item. Analyze the item
and return ONLY a JSON object that follows the schema below. No extra text.

RULES
- Describe only the clothing item. Never describe a person, face, body
  or background, even if visible.
- Use ONLY the allowed values listed for each enum field. For "category",
  "pattern" and "material_guess", use "other" when nothing fits and explain
  in "notes". For every other enum field, pick the closest value.
- Fields marked "| null" may be null when the detail is not visible or you
  are unsure. Fields without "| null" always need your best estimate.
- Colors: judge the true fabric color, correcting for lighting and shadows.
  Name colors with simple words a child understands.
- If the photo contains no clothing item, or more than one item, set
  "valid_image" to false, explain in "notes", and still fill every other
  field with your best guess (it will be ignored).

SCHEMA
{
  "valid_image": true | false,
  "category": "top" | "bottom" | "dress" | "outerwear" | "shoes" | "accessory" | "other",
  "subcategory": string,              // e.g. "t-shirt", "hoodie", "jeans", "leggings", "sneakers", "cap"
  "primary_color": string,            // e.g. "navy", "white", "red"
  "primary_color_hex": string,        // approximate, e.g. "#1F2A44"
  "secondary_colors": [string],       // empty array if none
  "color_family": "neutral" | "colorful",
                                      // neutral = black, white, gray, navy, beige, brown, denim blue
  "pattern": "solid" | "stripes" | "checks_plaid" | "dots" | "floral" | "graphic_print" | "character_print" | "camo" | "animal_print" | "other",
  "graphic_description": string | null, // short description of any print, e.g. "small dinosaur on chest"
  "text_on_item": string | null,      // any visible words or slogans
  "busyness": "low" | "medium" | "high",
                                      // low = plain or tiny detail; high = large or all-over bold print
  "formality": ["play", "school", "sport", "party"],
                                      // one or more suitable occasions
  "season": ["summer", "mid", "winter"],
                                      // one or more seasons it suits
  "warmth": "light" | "medium" | "heavy",
  "sleeve_length": "sleeveless" | "short" | "three_quarter" | "long" | null,
                                      // tops, dresses, outerwear only
  "leg_length": "shorts" | "capri" | "full" | null,
                                      // bottoms only
  "material_guess": "cotton" | "denim" | "knit" | "fleece" | "synthetic" | "wool" | "leather" | "other" | null,
  "fit": "slim" | "regular" | "loose" | null,
  "closure": "none" | "buttons" | "zipper" | "velcro" | "laces" | "elastic" | null,
  "style_tags": [string],             // up to 5, e.g. "sporty", "cozy", "dressy", "casual"
  "short_title": string,              // max 5 words, e.g. "Navy dinosaur t-shirt"
  "kid_friendly_description": string, // one sentence a child can read
  "confidence": "high" | "medium" | "low",
  "notes": string | null
}`;

type JsonSchema = Record<string, unknown>;

const str: JsonSchema = { type: 'string' };
const strOrNull: JsonSchema = { type: ['string', 'null'] };
const enumOf = (values: readonly string[]): JsonSchema => ({ type: 'string', enum: [...values] });
/** A strict schema needs null both in the type and in the enum list. */
const enumOrNull = (values: readonly string[]): JsonSchema => ({ type: ['string', 'null'], enum: [...values, null] });
const enumList = (values: readonly string[]): JsonSchema => ({ type: 'array', items: enumOf(values), minItems: 1 });

const properties: Record<string, JsonSchema> = {
  valid_image: { type: 'boolean' },
  category: enumOf(ATTR_CATEGORIES),
  subcategory: str,
  primary_color: str,
  primary_color_hex: str,
  secondary_colors: { type: 'array', items: str },
  color_family: enumOf(ATTR_COLOR_FAMILIES),
  pattern: enumOf(ATTR_PATTERNS),
  graphic_description: strOrNull,
  text_on_item: strOrNull,
  busyness: enumOf(ATTR_BUSYNESS),
  formality: enumList(ATTR_FORMALITY),
  season: enumList(ATTR_SEASONS),
  warmth: enumOf(ATTR_WARMTH),
  sleeve_length: enumOrNull(ATTR_SLEEVES),
  leg_length: enumOrNull(ATTR_LEGS),
  material_guess: enumOrNull(ATTR_MATERIALS),
  fit: enumOrNull(ATTR_FITS),
  closure: enumOrNull(ATTR_CLOSURES),
  style_tags: { type: 'array', items: str, maxItems: MAX_STYLE_TAGS },
  short_title: str,
  kid_friendly_description: str,
  confidence: enumOf(ATTR_CONFIDENCE),
  notes: strOrNull,
};

/**
 * The JSON schema for `response_format` (type json_schema, strict). Venice requires every
 * field in `required` and `additionalProperties: false`; nullable fields use a null type.
 * The app validates the answer itself either way (parseAttributesAnswer).
 */
export const ATTRIBUTES_SCHEMA: JsonSchema = {
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
};

export const ATTRIBUTES_SCHEMA_NAME = 'garment';
