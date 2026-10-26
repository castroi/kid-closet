export type ItemType = 'tee' | 'longTop' | 'sweater' | 'jacket' | 'pants' | 'shorts';
export type Slot = 'layer' | 'top' | 'bottom';
export type Occasion = 'school' | 'casual' | 'party';
export type ItemStatus = 'active' | 'outgrown';
export type ColorGroup =
  | 'blue'
  | 'white'
  | 'gray'
  | 'pink'
  | 'red'
  | 'green'
  | 'purple'
  | 'yellow'
  | 'black'
  | 'beige'
  | 'brown'
  | 'multi';

export interface Item {
  id: string;
  name: string;
  type: ItemType;
  colorGroup: ColorGroup;
  occasions: Occasion[];
  status: ItemStatus;
  /** Path of the photo inside the app's private folder, e.g. "images/<id>.webp". */
  image: string;
  createdAt: string;
  updatedAt: string;
}

export interface Outfit {
  id: string;
  occasion: Occasion;
  layerId: string | null;
  topId: string;
  bottomId: string;
  createdAt: string;
}

/** The doll the AI dresses in a look. */
export interface Doll {
  /** DEFAULT_DOLL_ID for the picture bundled with the app; a new id every time the parent replaces it. */
  id: string;
  /** The parent's picture, always "images/doll-<id>.webp" (or .jpg); null for the bundled default. */
  image: string | null;
}

export const DEFAULT_DOLL_ID = 'default';

export const AI_PROVIDER_IDS = ['venice', 'openrouter'] as const;
export type AiProviderId = (typeof AI_PROVIDER_IDS)[number];

/**
 * How the parent set up AI looks. No secrets: the API key and this month's use stay on the
 * device (src/app/aiDevice.ts), so this can go into backups.
 */
export interface AiSettings {
  /** null until the parent picks one; the AI button stays hidden until then. */
  provider: AiProviderId | null;
  /** The provider's model name; empty means the provider's default. */
  model: string;
  /** null means the built-in prompt (src/ai/prompt.ts). */
  prompt: string | null;
  /** AI pictures per month on this phone, counting the parent's redos. */
  monthlyCap: number;
}

export const DEFAULT_MONTHLY_CAP = 100;
export const MAX_MONTHLY_CAP = 1000;

/**
 * A picture of the doll wearing a look, made by the AI. It is identified by what was sent:
 * the doll, the upper garment (the shirt, or the layer when there is one) and the trousers.
 * Outfits that differ only by a shirt under a layer share one picture.
 */
export interface AiLook {
  id: string;
  dollId: string;
  upperId: string;
  upperSlot: 'top' | 'layer';
  bottomId: string;
  /** Always "images/look-<id>.webp" (or .jpg), so deleting one look never removes another's picture. */
  image: string;
  provider: AiProviderId;
  model: string;
  /** Which prompt made it (a short hash), so a changed prompt can be told apart later. */
  promptHash: string;
  /** She tapped "לא דומה?"; the parent sees it in "לוקים לתיקון". */
  flagged: boolean;
  createdAt: string;
}

export interface ClosetData {
  schemaVersion: number;
  items: Item[];
  outfits: Outfit[];
  lastBackupAt: string | null;
  doll: Doll;
  ai: AiSettings;
  aiLooks: AiLook[];
}

/**
 * 2 added `doll`, 3 added `ai`, 4 added `aiLooks`. Older files and backups still load:
 * version 1 with the bundled doll, versions 1–2 with AI not set up, versions 1–3 with no looks.
 */
export const SCHEMA_VERSION = 4;

export const ITEM_TYPES: ItemType[] = ['tee', 'longTop', 'sweater', 'jacket', 'pants', 'shorts'];
export const SLOTS: Slot[] = ['layer', 'top', 'bottom'];
export const OCCASIONS: Occasion[] = ['school', 'casual', 'party'];

export const TYPE_INFO: Record<ItemType, { slot: Slot; label: string; short: string }> = {
  tee: { slot: 'top', label: 'חולצה קצרה', short: 'קצרה' },
  longTop: { slot: 'top', label: 'חולצה ארוכה', short: 'ארוכה' },
  sweater: { slot: 'layer', label: 'סוודר', short: 'סוודר' },
  jacket: { slot: 'layer', label: 'עליונית', short: 'עליונית' },
  pants: { slot: 'bottom', label: 'מכנסיים ארוכים', short: 'ארוכים' },
  shorts: { slot: 'bottom', label: 'מכנסיים קצרים', short: 'קצרים' },
};

export const SLOT_LABEL: Record<Slot, string> = {
  layer: 'שכבה עליונה',
  top: 'חולצה',
  bottom: 'מכנסיים',
};

export const OCCASION_LABEL: Record<Occasion, string> = {
  school: 'בית ספר',
  casual: 'יום רגיל',
  party: 'חגיגי',
};

export const COLOR_INFO: Record<ColorGroup, { label: string; hex: string }> = {
  blue: { label: 'כחול', hex: '#4A6FD1' },
  white: { label: 'לבן', hex: '#FFFFFF' },
  gray: { label: 'אפור', hex: '#A3A3B2' },
  pink: { label: 'ורוד', hex: '#F4A7B9' },
  red: { label: 'אדום', hex: '#D64545' },
  green: { label: 'ירוק', hex: '#7BC4A4' },
  purple: { label: 'סגול', hex: '#B79CEB' },
  yellow: { label: 'צהוב', hex: '#E3B23C' },
  black: { label: 'שחור', hex: '#2E2B38' },
  beige: { label: 'בז׳', hex: '#D9C3A0' },
  brown: { label: 'חום', hex: '#9C6B4E' },
  multi: { label: 'צבעוני', hex: '#E9E4F5' },
};

export const COLOR_GROUPS = Object.keys(COLOR_INFO) as ColorGroup[];

export function emptyCloset(): ClosetData {
  return {
    schemaVersion: SCHEMA_VERSION,
    items: [],
    outfits: [],
    lastBackupAt: null,
    doll: defaultDoll(),
    ai: defaultAiSettings(),
    aiLooks: [],
  };
}

export function defaultAiSettings(): AiSettings {
  return { provider: null, model: '', prompt: null, monthlyCap: DEFAULT_MONTHLY_CAP };
}

export function defaultDoll(): Doll {
  return { id: DEFAULT_DOLL_ID, image: null };
}

export function lookImagePath(id: string, ext: 'webp' | 'jpg'): string {
  return `images/look-${id}.${ext}`;
}

/** The parent's doll picture is named after the doll's id, like an item's photo. */
export function dollImagePath(id: string, ext: 'webp' | 'jpg'): string {
  return `images/doll-${id}.${ext}`;
}

export function slotOf(type: ItemType): Slot {
  return TYPE_INFO[type].slot;
}

export function defaultName(type: ItemType, color: ColorGroup): string {
  return `${TYPE_INFO[type].label} בצבע ${COLOR_INFO[color].label}`;
}
