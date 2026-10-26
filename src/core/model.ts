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

export interface ClosetData {
  schemaVersion: number;
  items: Item[];
  outfits: Outfit[];
  lastBackupAt: string | null;
  doll: Doll;
}

/** 2 added `doll`. Version 1 files and backups still load, with the bundled doll. */
export const SCHEMA_VERSION = 2;

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
  return { schemaVersion: SCHEMA_VERSION, items: [], outfits: [], lastBackupAt: null, doll: defaultDoll() };
}

export function defaultDoll(): Doll {
  return { id: DEFAULT_DOLL_ID, image: null };
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
