import type { SlotFilter } from './closet';
import { COLOR_INFO, TYPE_INFO, type ColorGroup, type ItemType, type Slot } from './model';

/** Hebrew plural noun for a row, with its grammatical gender (adjectives must agree). */
type Noun = { word: string; definite: string; gender: 'f' | 'm' };

const SLOT_NOUN: Record<Slot, Noun> = {
  layer: { word: 'שכבות עליונות', definite: 'השכבות העליונות', gender: 'f' },
  top: { word: 'חולצות', definite: 'החולצות', gender: 'f' },
  bottom: { word: 'מכנסיים', definite: 'המכנסיים', gender: 'm' },
};

/** A type filter either replaces the noun (סוודרים) or adds an adjective (חולצות ארוכות). */
const TYPE_TITLE: Record<ItemType, { noun?: Noun; adjective?: string }> = {
  tee: { adjective: 'קצרות' },
  longTop: { adjective: 'ארוכות' },
  sweater: { noun: { word: 'סוודרים', definite: 'הסוודרים', gender: 'm' } },
  jacket: { noun: { word: 'עליוניות', definite: 'העליוניות', gender: 'f' } },
  pants: { adjective: 'ארוכים' },
  shorts: { adjective: 'קצרים' },
};

/** Plural colour adjectives: [feminine, masculine]. */
const COLOR_PLURAL: Record<ColorGroup, [string, string]> = {
  blue: ['כחולות', 'כחולים'],
  white: ['לבנות', 'לבנים'],
  gray: ['אפורות', 'אפורים'],
  pink: ['ורודות', 'ורודים'],
  red: ['אדומות', 'אדומים'],
  green: ['ירוקות', 'ירוקים'],
  purple: ['סגולות', 'סגולים'],
  yellow: ['צהובות', 'צהובים'],
  black: ['שחורות', 'שחורים'],
  beige: ['בז׳', 'בז׳'],
  brown: ['חומות', 'חומים'],
  multi: ['צבעוניות', 'צבעוניים'],
};

/** The words for an active filter, e.g. ["ארוכה", "כחול"]; empty when no filter is on. Shared by the row button and the gallery chip. */
export function filterParts(filter: SlotFilter): string[] {
  const parts: string[] = [];
  if (filter.type) parts.push(TYPE_INFO[filter.type].short);
  if (filter.color) parts.push(COLOR_INFO[filter.color].label);
  return parts;
}

export function isFiltered(filter: SlotFilter): boolean {
  return filter.type !== null || filter.color !== null;
}

/** "חולצות", "חולצות כחולות", "מכנסיים ארוכים שחורים", "סוודרים צהובים". */
export function galleryTitle(slot: Slot, filter: SlotFilter): string {
  let noun = SLOT_NOUN[slot];
  const adjectives: string[] = [];
  if (filter.type) {
    const t = TYPE_TITLE[filter.type];
    if (t.noun) noun = t.noun;
    if (t.adjective) adjectives.push(t.adjective);
  }
  if (filter.color) adjectives.push(COLOR_PLURAL[filter.color][noun.gender === 'f' ? 0 : 1]);
  return [noun.word, ...adjectives].join(' ');
}

/** "3 מתוך 8" when filtered, so she knows more exist; otherwise "8 בסך הכל". */
export function galleryCount(shown: number, total: number, filtered: boolean): string {
  return filtered ? `${shown} מתוך ${total}` : `${total} בסך הכל`;
}

/** "להציג את כל 8 החולצות". */
export function showAllLabel(slot: Slot, total: number): string {
  return `להציג את כל ${total} ${SLOT_NOUN[slot].definite}`;
}

/** "אין חולצות כאלה". */
export function noMatchLabel(slot: Slot): string {
  return `אין ${SLOT_NOUN[slot].word} כאלה`;
}
