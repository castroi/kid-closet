// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { NO_FILTER } from './closet';
import { galleryCount, galleryTitle, isFiltered, noMatchLabel, showAllLabel } from './gallery';
import { COLOR_GROUPS, ITEM_TYPES } from './model';

describe('gallery labels', () => {
  it('names the row when there is no filter', () => {
    expect(galleryTitle('top', NO_FILTER)).toBe('חולצות');
    expect(galleryTitle('bottom', NO_FILTER)).toBe('מכנסיים');
    expect(galleryTitle('layer', NO_FILTER)).toBe('שכבות עליונות');
  });

  it('makes colours agree with the noun', () => {
    expect(galleryTitle('top', { type: null, color: 'blue' })).toBe('חולצות כחולות');
    expect(galleryTitle('bottom', { type: null, color: 'blue' })).toBe('מכנסיים כחולים');
    expect(galleryTitle('layer', { type: 'sweater', color: 'yellow' })).toBe('סוודרים צהובים');
    expect(galleryTitle('layer', { type: 'jacket', color: 'black' })).toBe('עליוניות שחורות');
    expect(galleryTitle('top', { type: null, color: 'beige' })).toBe('חולצות בז׳');
  });

  it('adds the type, then the colour', () => {
    expect(galleryTitle('top', { type: 'longTop', color: null })).toBe('חולצות ארוכות');
    expect(galleryTitle('top', { type: 'tee', color: 'white' })).toBe('חולצות קצרות לבנות');
    expect(galleryTitle('bottom', { type: 'shorts', color: 'gray' })).toBe('מכנסיים קצרים אפורים');
    expect(galleryTitle('bottom', { type: 'pants', color: null })).toBe('מכנסיים ארוכים');
  });

  it('has a title for every type and colour', () => {
    for (const type of ITEM_TYPES) {
      for (const color of COLOR_GROUPS) {
        for (const slot of ['layer', 'top', 'bottom'] as const) {
          expect(galleryTitle(slot, { type, color })).not.toMatch(/undefined/);
        }
      }
    }
  });

  it('counts, and says how many there are in all', () => {
    expect(galleryCount(3, 8, true)).toBe('3 מתוך 8');
    expect(galleryCount(8, 8, false)).toBe('8 בסך הכל');
    expect(showAllLabel('top', 8)).toBe('להציג את כל 8 החולצות');
    expect(showAllLabel('bottom', 2)).toBe('להציג את כל 2 המכנסיים');
    expect(showAllLabel('layer', 4)).toBe('להציג את כל 4 השכבות העליונות');
    expect(noMatchLabel('top')).toBe('אין חולצות כאלה');
  });

  it('knows when a filter is on', () => {
    expect(isFiltered(NO_FILTER)).toBe(false);
    expect(isFiltered({ type: 'tee', color: null })).toBe(true);
    expect(isFiltered({ type: null, color: 'red' })).toBe(true);
  });
});
