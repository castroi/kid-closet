import { parseStoredAnalysis, type ItemAnalysis } from './attributes';
import {
  AI_PROVIDER_IDS,
  COLOR_GROUPS,
  DEFAULT_DOLL_ID,
  MAX_ANALYSIS_CAP,
  MAX_MODEL_LENGTH,
  MAX_MONTHLY_CAP,
  ITEM_TYPES,
  OCCASIONS,
  SCHEMA_VERSION,
  defaultAiSettings,
  defaultAnalysisSettings,
  defaultDoll,
  dollImagePath,
  itemImagePath,
  lookImagePath,
  slotOf,
  type AiLook,
  type AiProviderId,
  type AiSettings,
  type AnalysisSettings,
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

/**
 * True when the item has an analysis of its current photo (not stale after a replacement), including an
 * "invalid photo" answer: either way it isn't sent again automatically (docs/ai-item-attributes.md §7).
 */
export function isAnalysed(item: Item): boolean {
  return item.analysis !== null && item.analysis.photoRevision === item.photoRevision;
}

/**
 * Gives an item a new photo (docs/ai-item-attributes.md §7, PR 4): a new file named after the item
 * and its next revision, and no analysis, so the AI is asked again. The AI looks that
 * used the garment show the old photo, so they are marked for the parent in "לוקים לתיקון"; deleting
 * stays hers to decide.
 */
export function replaceItemPhoto(data: ClosetData, id: string, image: string, now: string): ClosetData {
  const item = data.items.find((it) => it.id === id);
  if (!item) throw new Error(`Item ${id} not found`);
  const revision = item.photoRevision + 1;
  if (image !== itemImagePath(id, revision, 'webp') && image !== itemImagePath(id, revision, 'jpg')) throw new Error(`Bad photo path ${image}`);
  return {
    ...data,
    items: data.items.map((it) => (it.id === id ? { ...it, image, photoRevision: revision, analysis: null, updatedAt: now } : it)),
    aiLooks: data.aiLooks.map((l) => (l.upperId === id || l.bottomId === id ? { ...l, flagged: true } : l)),
  };
}

/** What the parent's bulk run sends: garments she wears that aren't analysed for their current photo. */
export function itemsToAnalyse(items: Item[]): Item[] {
  return items.filter((it) => it.status === 'active' && !isAnalysed(it));
}

/**
 * Stores an analysis on its item. An answer that arrives late is dropped (the data comes back
 * unchanged) when the item was deleted or its photo replaced while the call ran.
 */
export function setItemAnalysis(data: ClosetData, id: string, analysis: ItemAnalysis): ClosetData {
  const item = data.items.find((it) => it.id === id);
  if (!item || item.photoRevision !== analysis.photoRevision) return data;
  return { ...data, items: data.items.map((it) => (it.id === id ? { ...it, analysis } : it)) };
}

/** Removes items, every saved outfit that used one of them, and their AI looks. */
export function removeItems(data: ClosetData, ids: string[]): ClosetData {
  const set = new Set(ids);
  return {
    ...data,
    items: data.items.filter((it) => !set.has(it.id)),
    outfits: data.outfits.filter(
      (o) => !set.has(o.topId) && !set.has(o.bottomId) && (o.layerId === null || !set.has(o.layerId)),
    ),
    aiLooks: data.aiLooks.filter((l) => !set.has(l.upperId) && !set.has(l.bottomId)),
  };
}

/** What a look is made from: exactly what was sent to the AI. */
export interface LookParts {
  dollId: string;
  upperId: string;
  upperSlot: 'top' | 'layer';
  bottomId: string;
}

/** The upper garment that goes to the AI: the layer when the outfit has one, otherwise the shirt. */
export function lookPartsFor(dollId: string, outfit: { layerId: string | null; topId: string; bottomId: string }): LookParts {
  return outfit.layerId
    ? { dollId, upperId: outfit.layerId, upperSlot: 'layer', bottomId: outfit.bottomId }
    : { dollId, upperId: outfit.topId, upperSlot: 'top', bottomId: outfit.bottomId };
}

function sameParts(look: LookParts, parts: LookParts): boolean {
  return look.dollId === parts.dollId && look.upperId === parts.upperId && look.bottomId === parts.bottomId;
}

/** The saved look for these parts, if the AI already made one. */
export function findLook(data: ClosetData, parts: LookParts): AiLook | undefined {
  return data.aiLooks.find((l) => sameParts(l, parts));
}

/** Adds a look, replacing an older one for the same parts (a redo by the parent). */
export function putLook(data: ClosetData, look: AiLook): ClosetData {
  return { ...data, aiLooks: [...data.aiLooks.filter((l) => !sameParts(l, look) && l.id !== look.id), look] };
}

export function removeLooks(data: ClosetData, ids: string[]): ClosetData {
  const set = new Set(ids);
  return { ...data, aiLooks: data.aiLooks.filter((l) => !set.has(l.id)) };
}

export function setLookFlagged(data: ClosetData, id: string, flagged: boolean): ClosetData {
  return { ...data, aiLooks: data.aiLooks.map((l) => (l.id === id ? { ...l, flagged } : l)) };
}

/** A short, stable id for a prompt (FNV-1a), recorded with each look. */
export function promptHash(prompt: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < prompt.length; i++) {
    hash ^= prompt.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
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
export const MAX_LOOKS = 5000;

export function setAiSettings(data: ClosetData, patch: Partial<AiSettings>): ClosetData {
  return { ...data, ai: { ...data.ai, ...patch } };
}

/** Throws InvalidClosetError when restore data is far larger than any real closet. */
export function assertWithinRestoreLimits(raw: unknown): void {
  if (!isRecord(raw)) return; // parseCloset reports the shape error
  const { items, outfits, aiLooks } = raw;
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
  if (Array.isArray(aiLooks) && aiLooks.length > MAX_LOOKS) {
    throw new InvalidClosetError(`more than ${MAX_LOOKS} AI looks`);
  }
}

const SAFE_IMAGE_PATH = /^images\/[A-Za-z0-9-]+\.(webp|jpg)$/;

export function isSafeImagePath(path: string): boolean {
  return SAFE_IMAGE_PATH.test(path);
}

function parseItem(raw: unknown, index: number, version: number): Item {
  const fail = (field: string) => new InvalidClosetError(`items[${index}].${field} is invalid`);
  if (!isRecord(raw)) throw fail('(item)');
  const { id, name, type, colorGroup, occasions, status, image, photoRevision, analysis, createdAt, updatedAt } = raw;
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
  let revision = 0;
  if (version >= 5) {
    if (typeof photoRevision !== 'number' || !Number.isInteger(photoRevision) || photoRevision < 0) throw fail('photoRevision');
    revision = photoRevision;
  }
  // Each item owns exactly one photo named after its id and photo revision, so deleting one item can never remove another's photo.
  if (!isString(image) || !isSafeImagePath(image) || (image !== itemImagePath(id, revision, 'webp') && image !== itemImagePath(id, revision, 'jpg'))) {
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
    photoRevision: revision,
    // A bad analysis is dropped, never fatal: it can be made again (docs/ai-item-attributes.md §5).
    analysis: version >= 5 ? parseStoredAnalysis(analysis) : null,
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
export { MAX_MODEL_LENGTH };
export const MAX_PROMPT_LENGTH = 4000;

function parseAnalysisSettings(raw: unknown): AnalysisSettings {
  const fail = (field: string) => new InvalidClosetError(`ai.analysis.${field} is invalid`);
  if (!isRecord(raw)) throw fail('(analysis)');
  const { enabled, model, monthlyCap } = raw;
  if (typeof enabled !== 'boolean') throw fail('enabled');
  if (!isString(model) || model.length > MAX_MODEL_LENGTH) throw fail('model');
  if (typeof monthlyCap !== 'number' || !Number.isInteger(monthlyCap) || monthlyCap < 0 || monthlyCap > MAX_ANALYSIS_CAP) {
    throw fail('monthlyCap');
  }
  return { enabled, model, monthlyCap };
}

function parseAi(raw: unknown, version: number): AiSettings {
  const fail = (field: string) => new InvalidClosetError(`ai.${field} is invalid`);
  if (!isRecord(raw)) throw fail('(ai)');
  const { provider, model, prompt, monthlyCap } = raw;
  if (provider !== null && !AI_PROVIDER_IDS.includes(provider as AiProviderId)) throw fail('provider');
  if (!isString(model) || model.length > MAX_MODEL_LENGTH) throw fail('model');
  if (prompt !== null && (!isString(prompt) || prompt.length > MAX_PROMPT_LENGTH)) throw fail('prompt');
  if (typeof monthlyCap !== 'number' || !Number.isInteger(monthlyCap) || monthlyCap < 0 || monthlyCap > MAX_MONTHLY_CAP) {
    throw fail('monthlyCap');
  }
  const analysis = version >= 5 ? parseAnalysisSettings(raw.analysis) : defaultAnalysisSettings();
  return { provider: provider as AiProviderId | null, model, prompt, monthlyCap, analysis };
}

function parseLook(raw: unknown, index: number): AiLook {
  const fail = (field: string) => new InvalidClosetError(`aiLooks[${index}].${field} is invalid`);
  if (!isRecord(raw)) throw fail('(look)');
  const { id, dollId, upperId, upperSlot, bottomId, image, provider, model, promptHash: hash, flagged, createdAt } = raw;
  if (!isString(id) || !DOLL_ID.test(id)) throw fail('id');
  if (!isString(dollId) || !DOLL_ID.test(dollId)) throw fail('dollId');
  if (!isString(upperId)) throw fail('upperId');
  if (upperSlot !== 'top' && upperSlot !== 'layer') throw fail('upperSlot');
  if (!isString(bottomId)) throw fail('bottomId');
  if (!isString(image) || (image !== lookImagePath(id, 'webp') && image !== lookImagePath(id, 'jpg'))) throw fail('image');
  if (!AI_PROVIDER_IDS.includes(provider as AiProviderId)) throw fail('provider');
  if (!isString(model) || model.length > MAX_MODEL_LENGTH) throw fail('model');
  if (!isString(hash) || hash.length > 20) throw fail('promptHash');
  if (typeof flagged !== 'boolean') throw fail('flagged');
  if (!isString(createdAt)) throw fail('createdAt');
  return { id, dollId, upperId, upperSlot, bottomId, image, provider: provider as AiProviderId, model, promptHash: hash, flagged, createdAt };
}

/** The photos a closet can't do without, so every backup has them: one per item, plus the parent's doll picture. */
export function closetImagePaths(data: ClosetData): string[] {
  const paths = data.items.map((it) => it.image);
  if (data.doll.image) paths.push(data.doll.image);
  return paths;
}

/** Every picture file the closet uses: the photos it can't do without plus the AI looks (which a backup may leave out). */
export function storedImagePaths(data: ClosetData): string[] {
  return [...closetImagePaths(data), ...data.aiLooks.map((l) => l.image)];
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
  const items = raw.items.map((it, i) => parseItem(it, i, version));
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
  const ai = version >= 3 ? parseAi(raw.ai, version) : defaultAiSettings();
  let aiLooks: AiLook[] = [];
  if (version >= 4) {
    if (!Array.isArray(raw.aiLooks)) throw new InvalidClosetError('aiLooks is not a list');
    const itemIds = new Set(items.map((it) => it.id));
    const used = new Set(items.map((it) => it.image));
    if (doll.image) used.add(doll.image);
    aiLooks = raw.aiLooks.map(parseLook).filter((l) => itemIds.has(l.upperId) && itemIds.has(l.bottomId));
    // One look per parts: a file with two (e.g. from an interrupted redo) keeps the later one; the other's picture is cleaned up.
    const seen = new Set<string>();
    aiLooks = aiLooks
      .reverse()
      .filter((l) => {
        const key = `${l.dollId}|${l.upperId}|${l.bottomId}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .reverse();
    for (const l of aiLooks) {
      if (used.has(l.image)) throw new InvalidClosetError(`duplicate picture ${l.image}`);
      used.add(l.image);
    }
  }
  return { schemaVersion: SCHEMA_VERSION, items, outfits, lastBackupAt: raw.lastBackupAt, doll, ai, aiLooks };
}
