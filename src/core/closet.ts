import {
  AI_PROVIDER_IDS,
  COLOR_GROUPS,
  DEFAULT_DOLL_ID,
  MAX_MONTHLY_CAP,
  ITEM_TYPES,
  OCCASIONS,
  SCHEMA_VERSION,
  defaultAiSettings,
  defaultDoll,
  dollImagePath,
  slotOf,
  type AiProviderId,
  type AiSettings,
  type ClosetData,
  type ColorGroup,
  type Doll,
  type Item,
  type ItemStatus,
  type ItemType,
  type Occasion,
  type Outfit,
  type Slot,
} from './model';

export interface SlotFilter {
  type: ItemType | null;
  color: ColorGroup | null;
}

export const NO_FILTER: SlotFilter = { type: null, color: null };

/** Items that can be worn in a slot for an occasion, before the user's type/colour filter. */
export function slotPool(items: Item[], slot: Slot, occasion: Occasion): Item[] {
  return items.filter(
    (it) => it.status === 'active' && slotOf(it.type) === slot && it.occasions.includes(occasion),
  );
}

export function applyFilter(items: Item[], filter: SlotFilter): Item[] {
  return items.filter(
    (it) =>
      (filter.type === null || it.type === filter.type) &&
      (filter.color === null || it.colorGroup === filter.color),
  );
}

/** Colour groups present in a list, in the fixed palette order. */
export function availableColors(items: Item[]): ColorGroup[] {
  const present = new Set(items.map((it) => it.colorGroup));
  return COLOR_GROUPS.filter((c) => present.has(c));
}

/** The selected item if it is still in the list, otherwise the first one. */
export function resolveSelection(list: Item[], selectedId: string | null): Item | null {
  if (list.length === 0) return null;
  return list.find((it) => it.id === selectedId) ?? list[0];
}

/** Move the selection forward (+1) or back (-1), wrapping around. */
export function stepSelection(list: Item[], selectedId: string | null, delta: 1 | -1): string | null {
  const current = resolveSelection(list, selectedId);
  if (!current) return null;
  const index = list.indexOf(current);
  const next = (index + delta + list.length) % list.length;
  return list[next].id;
}

export function findItem(data: ClosetData, id: string | null): Item | undefined {
  if (id === null) return undefined;
  return data.items.find((it) => it.id === id);
}

export function addItem(data: ClosetData, item: Item): ClosetData {
  if (data.items.some((it) => it.id === item.id)) {
    throw new Error(`Item ${item.id} already exists`);
  }
  return { ...data, items: [...data.items, item] };
}

export type ItemPatch = Partial<Pick<Item, 'name' | 'type' | 'colorGroup' | 'occasions' | 'status'>>;

export function updateItem(data: ClosetData, id: string, patch: ItemPatch, now: string): ClosetData {
  if (patch.occasions && patch.occasions.length === 0) {
    throw new Error('An item needs at least one occasion');
  }
  let found = false;
  const items = data.items.map((it) => {
    if (it.id !== id) return it;
    found = true;
    return { ...it, ...patch, updatedAt: now };
  });
  if (!found) throw new Error(`Item ${id} not found`);
  // A changed type can move an item to another slot; outfits that used it there are no longer valid.
  return { ...data, items, outfits: data.outfits.filter((o) => outfitIsValid(o, items)) };
}

export function setStatus(data: ClosetData, ids: string[], status: ItemStatus, now: string): ClosetData {
  const set = new Set(ids);
  return {
    ...data,
    items: data.items.map((it) => (set.has(it.id) ? { ...it, status, updatedAt: now } : it)),
  };
}

/** Removes items and every saved outfit that used one of them. */
export function removeItems(data: ClosetData, ids: string[]): ClosetData {
  const set = new Set(ids);
  return {
    ...data,
    items: data.items.filter((it) => !set.has(it.id)),
    outfits: data.outfits.filter(
      (o) => !set.has(o.topId) && !set.has(o.bottomId) && (o.layerId === null || !set.has(o.layerId)),
    ),
  };
}

export function sameOutfit(a: Omit<Outfit, 'id' | 'createdAt'>, b: Omit<Outfit, 'id' | 'createdAt'>): boolean {
  return a.occasion === b.occasion && a.layerId === b.layerId && a.topId === b.topId && a.bottomId === b.bottomId;
}

export function hasOutfit(data: ClosetData, outfit: Omit<Outfit, 'id' | 'createdAt'>): boolean {
  return data.outfits.some((o) => sameOutfit(o, outfit));
}

export function addOutfit(data: ClosetData, outfit: Outfit): ClosetData {
  if (hasOutfit(data, outfit)) return data;
  return { ...data, outfits: [outfit, ...data.outfits] };
}

export function removeOutfit(data: ClosetData, id: string): ClosetData {
  return { ...data, outfits: data.outfits.filter((o) => o.id !== id) };
}

function outfitIsValid(o: Outfit, items: Item[]): boolean {
  const bySlot = (id: string, slot: Slot) => items.some((it) => it.id === id && slotOf(it.type) === slot);
  return bySlot(o.topId, 'top') && bySlot(o.bottomId, 'bottom') && (o.layerId === null || bySlot(o.layerId, 'layer'));
}

export class InvalidClosetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidClosetError';
  }
}

function isString(v: unknown): v is string {
  return typeof v === 'string';
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Sanity limits for a backup being restored, far above real use (the name field
 * allows 60 characters). They stop a broken or hostile backup from freezing the
 * phone. They are not applied to the app's own closet files: the app doesn't cap
 * what it saves, so a limit there could one day lock the parent out of her data.
 */
export const MAX_ITEMS = 5000;
export const MAX_OUTFITS = 5000;
export const MAX_NAME_LENGTH = 200;

export function setAiSettings(data: ClosetData, patch: Partial<AiSettings>): ClosetData {
  return { ...data, ai: { ...data.ai, ...patch } };
}

/** Throws InvalidClosetError when restore data is far larger than any real closet. */
export function assertWithinRestoreLimits(raw: unknown): void {
  if (!isRecord(raw)) return; // parseCloset reports the shape error
  const { items, outfits } = raw;
  if (Array.isArray(items)) {
    if (items.length > MAX_ITEMS) throw new InvalidClosetError(`more than ${MAX_ITEMS} items`);
    items.forEach((it, i) => {
      if (isRecord(it) && isString(it.name) && it.name.length > MAX_NAME_LENGTH) {
        throw new InvalidClosetError(`items[${i}].name is too long`);
      }
    });
  }
  if (Array.isArray(outfits) && outfits.length > MAX_OUTFITS) {
    throw new InvalidClosetError(`more than ${MAX_OUTFITS} outfits`);
  }
}

const SAFE_IMAGE_PATH = /^images\/[A-Za-z0-9-]+\.(webp|jpg)$/;

export function isSafeImagePath(path: string): boolean {
  return SAFE_IMAGE_PATH.test(path);
}

function parseItem(raw: unknown, index: number): Item {
  const fail = (field: string) => new InvalidClosetError(`items[${index}].${field} is invalid`);
  if (!isRecord(raw)) throw fail('(item)');
  const { id, name, type, colorGroup, occasions, status, image, createdAt, updatedAt } = raw;
  if (!isString(id) || id.length === 0) throw fail('id');
  if (!isString(name)) throw fail('name');
  if (!ITEM_TYPES.includes(type as ItemType)) throw fail('type');
  if (!COLOR_GROUPS.includes(colorGroup as ColorGroup)) throw fail('colorGroup');
  if (
    !Array.isArray(occasions) ||
    occasions.length === 0 ||
    !occasions.every((o) => OCCASIONS.includes(o as Occasion))
  ) {
    throw fail('occasions');
  }
  if (status !== 'active' && status !== 'outgrown') throw fail('status');
  // Each item owns exactly one photo named after its id, so deleting one item can never remove another's photo.
  if (!isString(image) || !isSafeImagePath(image) || (image !== `images/${id}.webp` && image !== `images/${id}.jpg`)) {
    throw fail('image');
  }
  if (!isString(createdAt)) throw fail('createdAt');
  if (!isString(updatedAt)) throw fail('updatedAt');
  return {
    id,
    name,
    type: type as ItemType,
    colorGroup: colorGroup as ColorGroup,
    occasions: [...new Set(occasions as Occasion[])],
    status,
    image,
    createdAt,
    updatedAt,
  };
}

function parseOutfit(raw: unknown, index: number): Outfit {
  const fail = (field: string) => new InvalidClosetError(`outfits[${index}].${field} is invalid`);
  if (!isRecord(raw)) throw fail('(outfit)');
  const { id, occasion, layerId, topId, bottomId, createdAt } = raw;
  if (!isString(id)) throw fail('id');
  if (!OCCASIONS.includes(occasion as Occasion)) throw fail('occasion');
  if (layerId !== null && !isString(layerId)) throw fail('layerId');
  if (!isString(topId)) throw fail('topId');
  if (!isString(bottomId)) throw fail('bottomId');
  if (!isString(createdAt)) throw fail('createdAt');
  return { id, occasion: occasion as Occasion, layerId, topId, bottomId, createdAt };
}

const DOLL_ID = /^[A-Za-z0-9-]+$/;

function parseDoll(raw: unknown): Doll {
  const fail = (field: string) => new InvalidClosetError(`doll.${field} is invalid`);
  if (!isRecord(raw)) throw fail('(doll)');
  const { id, image } = raw;
  if (!isString(id) || !DOLL_ID.test(id)) throw fail('id');
  if (id === DEFAULT_DOLL_ID) {
    if (image !== null) throw fail('image');
    return defaultDoll();
  }
  // Like an item's photo, the doll's picture is named after its id, so replacing it can't touch another file.
  if (!isString(image) || (image !== dollImagePath(id, 'webp') && image !== dollImagePath(id, 'jpg'))) {
    throw fail('image');
  }
  return { id, image };
}

/** Generous limits; they only stop a broken or hostile file from holding huge text. */
export const MAX_MODEL_LENGTH = 200;
export const MAX_PROMPT_LENGTH = 4000;

function parseAi(raw: unknown): AiSettings {
  const fail = (field: string) => new InvalidClosetError(`ai.${field} is invalid`);
  if (!isRecord(raw)) throw fail('(ai)');
  const { provider, model, prompt, monthlyCap } = raw;
  if (provider !== null && !AI_PROVIDER_IDS.includes(provider as AiProviderId)) throw fail('provider');
  if (!isString(model) || model.length > MAX_MODEL_LENGTH) throw fail('model');
  if (prompt !== null && (!isString(prompt) || prompt.length > MAX_PROMPT_LENGTH)) throw fail('prompt');
  if (typeof monthlyCap !== 'number' || !Number.isInteger(monthlyCap) || monthlyCap < 0 || monthlyCap > MAX_MONTHLY_CAP) {
    throw fail('monthlyCap');
  }
  return { provider: provider as AiProviderId | null, model, prompt, monthlyCap };
}

/** Every photo file the closet uses: one per item, plus the parent's doll picture. */
export function closetImagePaths(data: ClosetData): string[] {
  const paths = data.items.map((it) => it.image);
  if (data.doll.image) paths.push(data.doll.image);
  return paths;
}

/** Validates data read from closet.json or a backup. Throws InvalidClosetError. */
export function parseCloset(raw: unknown): ClosetData {
  if (!isRecord(raw)) throw new InvalidClosetError('closet is not an object');
  // Every version up to this one loads; parts a version didn't have yet get their defaults.
  const version = raw.schemaVersion;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1 || version > SCHEMA_VERSION) {
    throw new InvalidClosetError(`unsupported schemaVersion ${String(version)}`);
  }
  if (!Array.isArray(raw.items)) throw new InvalidClosetError('items is not a list');
  if (!Array.isArray(raw.outfits)) throw new InvalidClosetError('outfits is not a list');
  if (raw.lastBackupAt !== null && !isString(raw.lastBackupAt)) {
    throw new InvalidClosetError('lastBackupAt is invalid');
  }
  const items = raw.items.map(parseItem);
  const ids = new Set<string>();
  for (const it of items) {
    if (ids.has(it.id)) throw new InvalidClosetError(`duplicate item id ${it.id}`);
    ids.add(it.id);
  }
  const outfits = raw.outfits.map(parseOutfit).filter((o) => outfitIsValid(o, items));
  const doll = version >= 2 ? parseDoll(raw.doll) : defaultDoll();
  if (doll.image && items.some((it) => it.image === doll.image)) {
    throw new InvalidClosetError('doll.image is used by an item');
  }
  const ai = version >= 3 ? parseAi(raw.ai) : defaultAiSettings();
  return { schemaVersion: SCHEMA_VERSION, items, outfits, lastBackupAt: raw.lastBackupAt, doll, ai };
}
