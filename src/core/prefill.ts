import type { ItemAttributes } from './attributes';
import { COLOR_GROUPS, COLOR_INFO, OCCASIONS, type ColorGroup, type ItemType, type Occasion } from './model';

/**
 * Turns what the AI said about a new garment's photo into the add screen's fields, which she
 * then checks and saves (docs/ai-item-attributes.md decision 13). A field the AI's answer can't
 * fill is null or empty, and she fills it as before. The full answer is saved with the garment.
 */
export interface PrefillFields {
  type: ItemType | null;
  colorGroup: ColorGroup | null;
  occasions: Occasion[];
}

const LAYER_WORDS = /sweater|sweatshirt|hoodie|cardigan|jumper|pullover|fleece/i;
const SHORT_TOP_WORDS = /t-?shirt|\btee\b|tank|polo|crop/i;

export function typeFromAttributes(a: ItemAttributes): ItemType | null {
  switch (a.category) {
    case 'outerwear':
      return LAYER_WORDS.test(a.subcategory) || a.material_guess === 'knit' || a.material_guess === 'fleece' ? 'sweater' : 'jacket';
    case 'top':
      if (LAYER_WORDS.test(a.subcategory)) return 'sweater';
      if (a.sleeve_length === 'short' || a.sleeve_length === 'sleeveless') return 'tee';
      if (a.sleeve_length === 'long' || a.sleeve_length === 'three_quarter') return 'longTop';
      return SHORT_TOP_WORDS.test(a.subcategory) ? 'tee' : null;
    case 'bottom':
      // Skirts have no type in the app yet, like dresses: she picks one, or none fits.
      if (/\bskirts?\b|\bskorts?\b/i.test(a.subcategory)) return null;
      if (a.leg_length === 'shorts') return 'shorts';
      if (a.leg_length === 'capri' || a.leg_length === 'full') return 'pants';
      return /short/i.test(a.subcategory) ? 'shorts' : 'pants';
    default:
      // Dresses, shoes and accessories have no type in the app yet: she picks one, or none fits.
      return null;
  }
}

/** Whole words only, so "colored" is never red and "tangerine" never tan; "pinkish" still counts as pink. */
const words = (...list: string[]) => new RegExp(`\\b(?:${list.join('|')})(?:ish)?\\b`, 'i');

/** A print in many colours, whatever its busyness: what she calls "צבעוני". */
const MULTI_WORDS = words('multi-?colou?r(?:ed)?', 'rainbow', 'colou?rful', 'tie-?dye', 'patchwork');

/** Colour words the model may use, to her 12 groups. Checked in order, so "light blue" is blue and "off-white" white. */
const COLOR_WORDS: [RegExp, ColorGroup][] = [
  [words('black', 'charcoal', 'jet'), 'black'],
  [words('white', 'whitish', 'ivory', 'off-?white', 'snow'), 'white'],
  [words('gr[ae]y', 'silver', 'graphite'), 'gray'],
  [words('navy', 'blue', 'bluish', 'denim', 'indigo', 'azure', 'cobalt', 'sky', 'turquoise', 'aqua', 'cyan'), 'blue'],
  [words('pink', 'rose', 'fuchsia', 'magenta', 'blush', 'salmon', 'coral'), 'pink'],
  [words('red', 'reddish', 'burgundy', 'maroon', 'crimson', 'wine', 'cherry'), 'red'],
  [words('green', 'olive', 'mint', 'lime', 'emerald', 'sage', 'teal', 'forest'), 'green'],
  [words('purple', 'purplish', 'violet', 'lavender', 'lilac', 'plum', 'mauve'), 'purple'],
  [words('yellow', 'gold', 'golden', 'mustard', 'lemon', 'orange', 'tangerine', 'peach', 'apricot'), 'yellow'],
  [words('beige', 'tan', 'khaki', 'cream', 'sand', 'camel', 'nude', 'oatmeal'), 'beige'],
  [words('brown', 'chocolate', 'coffee', 'rust', 'copper', 'bronze'), 'brown'],
];

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** How much closer the nearest swatch must be than the next one to count as a match. */
const CLEAR_MARGIN = 1.3;

/**
 * The group whose swatch is clearly closest to the model's colour, or null for a near tie: an empty
 * colour she picks is better than a wrong one, because she matches real colours. 'multi' is never
 * a nearest colour.
 */
export function nearestGroup(hex: string): ColorGroup | null {
  const [r, g, b] = hexToRgb(hex);
  const distances = COLOR_GROUPS.filter((group) => group !== 'multi')
    .map((group) => {
      const [r2, g2, b2] = hexToRgb(COLOR_INFO[group].hex);
      // Weighted for how eyes see colour differences, enough to tell 11 far-apart swatches apart.
      return { group, d: 2 * (r - r2) ** 2 + 4 * (g - g2) ** 2 + 3 * (b - b2) ** 2 };
    })
    .sort((x, y) => x.d - y.d);
  const [best, next] = distances;
  return next.d >= best.d * CLEAR_MARGIN ? best.group : null;
}

export function colorFromAttributes(a: ItemAttributes): ColorGroup | null {
  // A busy print in several colours, or a colour the model itself calls many, is what she calls "צבעוני".
  if (MULTI_WORDS.test(a.primary_color)) return 'multi';
  if (a.busyness === 'high' && a.secondary_colors.length >= 2) return 'multi';
  for (const [words, group] of COLOR_WORDS) if (words.test(a.primary_color)) return group;
  return a.primary_color_hex ? nearestGroup(a.primary_color_hex) : null;
}

const OCCASION_FROM_FORMALITY: Record<ItemAttributes['formality'][number], Occasion> = {
  play: 'casual',
  sport: 'casual',
  school: 'school',
  party: 'party',
};

export function occasionsFromAttributes(a: ItemAttributes): Occasion[] {
  const picked = new Set(a.formality.map((f) => OCCASION_FROM_FORMALITY[f]));
  return OCCASIONS.filter((o) => picked.has(o));
}

export function prefillFromAttributes(a: ItemAttributes): PrefillFields {
  return { type: typeFromAttributes(a), colorGroup: colorFromAttributes(a), occasions: occasionsFromAttributes(a) };
}
