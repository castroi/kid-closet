// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { asVersion1, closetWith, makeAnalysis, makeItem, makeLook, makeOutfit, NOW } from '../test/data';
import {
  InvalidClosetError,
  NO_FILTER,
  addItem,
  addOutfit,
  applyFilter,
  availableColors,
  closetImagePaths,
  setAiSettings,
  findItem,
  hasOutfit,
  isAnalysed,
  isSafeImagePath,
  itemsToAnalyse,
  replaceItemPhoto,
  parseCloset,
  removeItems,
  removeOutfit,
  resolveSelection,
  setItemAnalysis,
  setStatus,
  slotPool,
  stepSelection,
  updateItem,
} from './closet';
import {
  DEFAULT_ANALYSIS_CAP,
  DEFAULT_DOLL_ID,
  DEFAULT_MONTHLY_CAP,
  MAX_ANALYSIS_CAP,
  MAX_MONTHLY_CAP,
  SCHEMA_VERSION,
  defaultAiSettings,
  defaultAnalysisSettings,
  defaultName,
  dollImagePath,
  emptyCloset,
  slotOf,
} from './model';

const items = [
  makeItem({ id: 'a', type: 'tee', colorGroup: 'blue', occasions: ['school'] }),
  makeItem({ id: 'b', type: 'longTop', colorGroup: 'white', occasions: ['school', 'party'] }),
  makeItem({ id: 'c', type: 'tee', colorGroup: 'blue', occasions: ['casual'] }),
  makeItem({ id: 'd', type: 'tee', colorGroup: 'pink', occasions: ['school'], status: 'outgrown' }),
  makeItem({ id: 'p', type: 'pants', colorGroup: 'black', occasions: ['school'] }),
  makeItem({ id: 's', type: 'sweater', colorGroup: 'yellow', occasions: ['school'] }),
];

describe('model helpers', () => {
  it('maps types to slots and builds default names', () => {
    expect(slotOf('sweater')).toBe('layer');
    expect(slotOf('shorts')).toBe('bottom');
    expect(defaultName('tee', 'blue')).toBe('חולצה קצרה בצבע כחול');
    expect(emptyCloset()).toEqual({
      schemaVersion: SCHEMA_VERSION,
      items: [],
      outfits: [],
      lastBackupAt: null,
      doll: { id: DEFAULT_DOLL_ID, image: null },
      ai: {
        provider: null,
        model: '',
        prompt: null,
        monthlyCap: DEFAULT_MONTHLY_CAP,
        analysis: { enabled: false, model: '', monthlyCap: DEFAULT_ANALYSIS_CAP },
      },
      aiLooks: [],
    });
    expect(dollImagePath('d1', 'webp')).toBe('images/doll-d1.webp');
  });
});

describe('slotPool and filters', () => {
  it('keeps active items of the slot that fit the occasion', () => {
    expect(slotPool(items, 'top', 'school').map((i) => i.id)).toEqual(['a', 'b']);
    expect(slotPool(items, 'top', 'party').map((i) => i.id)).toEqual(['b']);
    expect(slotPool(items, 'layer', 'school').map((i) => i.id)).toEqual(['s']);
  });

  it('filters by type and colour', () => {
    const pool = slotPool(items, 'top', 'school');
    expect(applyFilter(pool, NO_FILTER)).toHaveLength(2);
    expect(applyFilter(pool, { type: 'tee', color: null }).map((i) => i.id)).toEqual(['a']);
    expect(applyFilter(pool, { type: null, color: 'white' }).map((i) => i.id)).toEqual(['b']);
    expect(applyFilter(pool, { type: 'tee', color: 'white' })).toEqual([]);
  });

  it('lists colours in palette order without duplicates', () => {
    expect(availableColors(items)).toEqual(['blue', 'white', 'pink', 'yellow', 'black']);
  });
});

describe('selection', () => {
  const list = items.slice(0, 3);

  it('falls back to the first item when the selection is gone', () => {
    expect(resolveSelection(list, 'zzz')?.id).toBe('a');
    expect(resolveSelection(list, 'b')?.id).toBe('b');
    expect(resolveSelection([], 'a')).toBeNull();
  });

  it('steps forward and back with wrap-around', () => {
    expect(stepSelection(list, 'a', 1)).toBe('b');
    expect(stepSelection(list, 'c', 1)).toBe('a');
    expect(stepSelection(list, 'a', -1)).toBe('c');
    expect(stepSelection(list, null, 1)).toBe('b');
    expect(stepSelection([], null, 1)).toBeNull();
  });
});

describe('item changes', () => {
  const base = closetWith(items, [makeOutfit({ id: 'o1', topId: 'a', bottomId: 'p', layerId: 's' })]);

  it('adds an item and rejects duplicate ids', () => {
    const next = addItem(base, makeItem({ id: 'new' }));
    expect(findItem(next, 'new')).toBeDefined();
    expect(() => addItem(next, makeItem({ id: 'new' }))).toThrow('already exists');
    expect(findItem(base, null)).toBeUndefined();
  });

  it('updates an item and stamps updatedAt', () => {
    const next = updateItem(base, 'a', { name: 'חדש', occasions: ['party'] }, '2027-01-01');
    expect(findItem(next, 'a')).toMatchObject({ name: 'חדש', occasions: ['party'], updatedAt: '2027-01-01' });
    expect(next.outfits).toHaveLength(1);
  });

  it('drops outfits that become invalid when an item changes slot', () => {
    const next = updateItem(base, 'a', { type: 'sweater' }, NOW);
    expect(next.outfits).toEqual([]);
  });

  it('refuses unknown items and empty occasions', () => {
    expect(() => updateItem(base, 'nope', { name: 'x' }, NOW)).toThrow('not found');
    expect(() => updateItem(base, 'a', { occasions: [] }, NOW)).toThrow('at least one occasion');
  });

  it('sets status for several items', () => {
    const next = setStatus(base, ['a', 'b'], 'outgrown', NOW);
    expect(next.items.filter((i) => i.status === 'outgrown').map((i) => i.id)).toEqual(['a', 'b', 'd']);
  });

  it('removes items and outfits that used them', () => {
    expect(removeItems(base, ['s']).outfits).toEqual([]);
    expect(removeItems(base, ['a']).outfits).toEqual([]);
    expect(removeItems(base, ['p']).outfits).toEqual([]);
    const kept = removeItems(base, ['c']);
    expect(kept.items.map((i) => i.id)).not.toContain('c');
    expect(kept.outfits).toHaveLength(1);
  });
});

describe('outfits', () => {
  const base = closetWith(items);
  const outfit = makeOutfit({ id: 'o1', topId: 'a', bottomId: 'p' });

  it('adds once and removes by id', () => {
    const one = addOutfit(base, outfit);
    expect(hasOutfit(one, outfit)).toBe(true);
    expect(addOutfit(one, { ...outfit, id: 'o2' })).toBe(one);
    expect(removeOutfit(one, 'o1').outfits).toEqual([]);
  });
});

describe('parseCloset', () => {
  const valid = closetWith(items, [makeOutfit({ id: 'o1', topId: 'a', bottomId: 'p' })]);

  it('accepts valid data and removes duplicate occasions', () => {
    const raw = JSON.parse(JSON.stringify(valid));
    raw.items[0].occasions = ['school', 'school'];
    const parsed = parseCloset(raw);
    expect(parsed.items[0].occasions).toEqual(['school']);
    expect(parsed.outfits).toHaveLength(1);
  });

  it('drops outfits that point at missing items', () => {
    const raw = { ...valid, outfits: [makeOutfit({ id: 'x', topId: 'gone', bottomId: 'p' })] };
    expect(parseCloset(raw).outfits).toEqual([]);
  });

  it.each([
    ['not an object', null, 'not an object'],
    ['wrong version', { ...valid, schemaVersion: 99 }, 'schemaVersion'],
    ['items missing', { ...valid, items: 'x' }, 'items'],
    ['outfits missing', { ...valid, outfits: {} }, 'outfits'],
    ['bad backup date', { ...valid, lastBackupAt: 5 }, 'lastBackupAt'],
    ['duplicate ids', { ...valid, items: [items[0], items[0]] }, 'duplicate'],
  ])('rejects %s', (_label, raw, message) => {
    expect(() => parseCloset(raw)).toThrow(InvalidClosetError);
    expect(() => parseCloset(raw)).toThrow(message);
  });

  it.each([
    ['item', 'x'],
    ['id', { id: '' }],
    ['name', { name: 3 }],
    ['type', { type: 'hat' }],
    ['colorGroup', { colorGroup: 'teal' }],
    ['occasions', { occasions: [] }],
    ['occasions', { occasions: ['beach'] }],
    ['status', { status: 'lost' }],
    ['image', { image: '../etc/passwd' }],
    ['image', { image: 'images/someone-else.webp' }],
    ['createdAt', { createdAt: 1 }],
    ['updatedAt', { updatedAt: null }],
  ])('rejects an item with a bad %s', (field, patch) => {
    const bad = typeof patch === 'string' ? patch : { ...items[0], ...patch };
    expect(() => parseCloset({ ...valid, items: [bad], outfits: [] })).toThrow(field === 'item' ? '(item)' : field);
  });

  it.each([
    ['(outfit)', 'x'],
    ['id', { id: 1 }],
    ['occasion', { occasion: 'beach' }],
    ['layerId', { layerId: 3 }],
    ['topId', { topId: null }],
    ['bottomId', { bottomId: 4 }],
    ['createdAt', { createdAt: undefined }],
  ])('rejects an outfit with a bad %s', (field, patch) => {
    const good = makeOutfit({ id: 'o1', topId: 'a', bottomId: 'p' });
    const bad = typeof patch === 'string' ? patch : { ...good, ...patch };
    expect(() => parseCloset({ ...valid, outfits: [bad] })).toThrow(field);
  });

  it('loads a version 1 closet with the bundled doll and saves it as the current version', () => {
    const v1 = asVersion1(valid);
    const parsed = parseCloset(v1);
    expect(parsed.schemaVersion).toBe(SCHEMA_VERSION);
    expect(parsed.doll).toEqual({ id: DEFAULT_DOLL_ID, image: null });
    expect(parsed.items).toHaveLength(items.length);
  });

  it('loads a version 2 closet keeping its doll, with AI not set up', () => {
    const raw: Record<string, unknown> = { ...JSON.parse(JSON.stringify(valid)), schemaVersion: 2 };
    raw.doll = { id: 'd1', image: 'images/doll-d1.webp' };
    delete raw.ai;
    const parsed = parseCloset(raw);
    expect(parsed.schemaVersion).toBe(SCHEMA_VERSION);
    expect(parsed.doll.id).toBe('d1');
    expect(parsed.ai).toEqual(defaultAiSettings());
  });

  it('reads a version 3 file as written, so a later version keeps its AI settings', () => {
    const ai = { provider: 'venice', model: 'm', prompt: null, monthlyCap: 12 };
    const raw = { ...JSON.parse(JSON.stringify(valid)), schemaVersion: 3, ai };
    expect(parseCloset(raw).ai).toEqual({ ...ai, analysis: defaultAnalysisSettings() });
  });

  it.each([0, 2.5, '3', null])('rejects schemaVersion %s', (schemaVersion) => {
    expect(() => parseCloset({ ...valid, schemaVersion })).toThrow('schemaVersion');
  });

  it('keeps the AI settings', () => {
    const ai = {
      provider: 'openrouter',
      model: 'meta/muse-image',
      prompt: 'Dress the doll.',
      monthlyCap: 0,
      analysis: { enabled: true, model: 'deepseek/deepseek-v4.1-flash', monthlyCap: 300 },
    };
    expect(parseCloset({ ...valid, ai }).ai).toEqual(ai);
  });

  it.each([
    ['(ai)', undefined],
    ['provider', { provider: 'acme' }],
    ['model', { model: null }],
    ['model', { model: 'x'.repeat(201) }],
    ['prompt', { prompt: 3 }],
    ['prompt', { prompt: 'x'.repeat(4001) }],
    ['monthlyCap', { monthlyCap: -1 }],
    ['monthlyCap', { monthlyCap: 2.5 }],
    ['monthlyCap', { monthlyCap: MAX_MONTHLY_CAP + 1 }],
    ['monthlyCap', { monthlyCap: '100' }],
  ])('rejects AI settings with a bad %s', (field, patch) => {
    const ai = patch === undefined ? undefined : { ...defaultAiSettings(), ...patch };
    expect(() => parseCloset({ ...valid, ai })).toThrow(`ai.${field}`);
  });

  it('changes only the given AI settings', () => {
    const next = setAiSettings(valid, { provider: 'venice' });
    expect(next.ai).toEqual({ ...defaultAiSettings(), provider: 'venice' });
    expect(next.items).toBe(valid.items);
  });

  it("accepts the parent's doll picture named after the doll's id", () => {
    for (const ext of ['webp', 'jpg'] as const) {
      const doll = { id: 'd1', image: `images/doll-d1.${ext}` };
      expect(parseCloset({ ...valid, doll }).doll).toEqual(doll);
    }
  });

  it.each([
    ['(doll)', undefined],
    ['(doll)', 'x'],
    ['id', { id: '', image: null }],
    ['id', { id: '../x', image: null }],
    ['id', { id: 3, image: null }],
    ['image', { id: DEFAULT_DOLL_ID, image: 'images/doll-default.webp' }],
    ['image', { id: 'd1', image: null }],
    ['image', { id: 'd1', image: 'images/doll-d2.webp' }],
    ['image', { id: 'd1', image: 'images/d1.webp' }],
    ['image', { id: 'd1', image: 'images/doll-d1.png' }],
  ])('rejects a doll with a bad %s', (field, doll) => {
    expect(() => parseCloset({ ...valid, doll })).toThrow(InvalidClosetError);
    expect(() => parseCloset({ ...valid, doll })).toThrow(`doll.${field}`);
  });

  it("rejects a doll picture that is also an item's photo", () => {
    const item = makeItem({ id: 'doll-d1', type: 'tee' });
    const raw = { ...valid, items: [item], outfits: [], doll: { id: 'd1', image: 'images/doll-d1.webp' } };
    expect(() => parseCloset(raw)).toThrow('doll.image is used by an item');
  });

  it("lists every photo the closet uses, the doll's last", () => {
    expect(closetImagePaths(closetWith([items[0]]))).toEqual(['images/a.webp']);
    const withDoll = { ...closetWith([items[0]]), doll: { id: 'd1', image: 'images/doll-d1.jpg' } };
    expect(closetImagePaths(withDoll)).toEqual(['images/a.webp', 'images/doll-d1.jpg']);
  });

  it('only allows image paths inside the images folder', () => {
    expect(isSafeImagePath('images/abc-1.webp')).toBe(true);
    expect(isSafeImagePath('images/abc.jpg')).toBe(true);
    expect(isSafeImagePath('images/../x.webp')).toBe(false);
    expect(isSafeImagePath('closet-a.json')).toBe(false);
  });
});

describe('item analysis (schema 5)', () => {
  const base = closetWith([makeItem({ id: 'a', analysis: makeAnalysis() }), makeItem({ id: 'b' })]);

  function stored(patch: (raw: { items: Record<string, unknown>[] } & Record<string, unknown>) => void = () => undefined) {
    const raw = JSON.parse(JSON.stringify(base));
    patch(raw);
    return raw;
  }

  it('keeps analyses and photo revisions', () => {
    const parsed = parseCloset(
      stored((raw) => {
        raw.items[1].photoRevision = 2;
        raw.items[1].image = 'images/b-r2.webp';
      }),
    );
    expect(parsed.items[0].analysis).toEqual(makeAnalysis());
    expect(parsed.items[1]).toMatchObject({ photoRevision: 2, image: 'images/b-r2.webp', analysis: null });
  });

  it('refuses two items sharing one photo file', () => {
    const raw = JSON.parse(
      JSON.stringify(closetWith([makeItem({ id: 'x', photoRevision: 1 }), makeItem({ id: 'x-r1' })])),
    );
    expect(raw.items.map((it: { image: string }) => it.image)).toEqual(['images/x-r1.webp', 'images/x-r1.webp']);
    expect(() => parseCloset(raw)).toThrow('duplicate photo images/x-r1.webp');
  });

  it('refuses a photo whose name does not match its revision', () => {
    for (const [revision, image] of [
      [2, 'images/b.webp'],
      [0, 'images/b-r1.webp'],
      [1, 'images/b-r2.jpg'],
      [1, 'images/a-r1.webp'],
    ] as const) {
      const raw = stored((r) => {
        r.items[1].photoRevision = revision;
        r.items[1].image = image;
      });
      expect(() => parseCloset(raw), `${revision} ${image}`).toThrow('items[1].image');
    }
  });

  it('loads a version 4 file with photo revision 0, nothing analysed and analysis off', () => {
    const raw = stored((r) => {
      r.schemaVersion = 4;
      r.ai = { provider: 'venice', model: '', prompt: null, monthlyCap: 100 };
      for (const it of r.items) {
        delete it.photoRevision;
        delete it.analysis;
      }
    });
    const parsed = parseCloset(raw);
    expect(parsed.schemaVersion).toBe(SCHEMA_VERSION);
    expect(parsed.items.map((it) => [it.photoRevision, it.analysis])).toEqual([
      [0, null],
      [0, null],
    ]);
    expect(parsed.ai.analysis).toEqual(defaultAnalysisSettings());
  });

  it('ignores analysis fields in an older file', () => {
    const parsed = parseCloset(stored((r) => (r.schemaVersion = 4)));
    expect(parsed.items[0]).toMatchObject({ photoRevision: 0, analysis: null });
  });

  it('loads a broken analysis as not analysed instead of refusing the closet', () => {
    const parsed = parseCloset(stored((r) => (r.items[0].analysis = { result: 'ok', attributes: { category: 'hat' } })));
    expect(parsed.items[0].analysis).toBeNull();
    expect(parsed.items).toHaveLength(2);
  });

  it.each([undefined, -1, 1.5, '1'])('refuses photoRevision %s', (photoRevision) => {
    expect(() => parseCloset(stored((r) => (r.items[0].photoRevision = photoRevision)))).toThrow('items[0].photoRevision');
  });

  it.each([
    ['(analysis)', undefined],
    ['enabled', { enabled: 'yes' }],
    ['model', { model: null }],
    ['model', { model: 'x'.repeat(201) }],
    ['monthlyCap', { monthlyCap: -1 }],
    ['monthlyCap', { monthlyCap: 2.5 }],
    ['monthlyCap', { monthlyCap: MAX_ANALYSIS_CAP + 1 }],
  ])('rejects analysis settings with a bad %s', (field, patch) => {
    const analysis = patch === undefined ? undefined : { ...defaultAnalysisSettings(), ...patch };
    expect(() => parseCloset({ ...base, ai: { ...defaultAiSettings(), analysis } })).toThrow(`ai.analysis.${field}`);
  });

  it('counts an item as analysed only for its current photo', () => {
    expect(isAnalysed(makeItem({ id: 'x' }))).toBe(false);
    expect(isAnalysed(makeItem({ id: 'x', analysis: makeAnalysis() }))).toBe(true);
    expect(isAnalysed(makeItem({ id: 'x', photoRevision: 1, analysis: makeAnalysis({ photoRevision: 0 }) }))).toBe(false);
  });

  it('stores an analysis on its item and leaves the others alone', () => {
    const next = setItemAnalysis(base, 'b', makeAnalysis({ model: 'm2' }));
    expect(findItem(next, 'b')?.analysis?.model).toBe('m2');
    expect(findItem(next, 'a')?.analysis).toEqual(makeAnalysis());
  });

  it('drops an answer that arrives after the item was deleted or its photo replaced', () => {
    expect(setItemAnalysis(base, 'gone', makeAnalysis())).toBe(base);
    const replaced = closetWith([makeItem({ id: 'a', photoRevision: 1 })]);
    expect(setItemAnalysis(replaced, 'a', makeAnalysis({ photoRevision: 0 }))).toBe(replaced);
  });

  it('picks for a bulk run the garments she wears that are not analysed for their current photo', () => {
    const list = [
      makeItem({ id: 'new' }),
      makeItem({ id: 'done', analysis: makeAnalysis() }),
      makeItem({ id: 'unclear', analysis: makeAnalysis({ result: 'invalid-photo', notes: null, attributes: undefined } as never) }),
      makeItem({ id: 'replaced', photoRevision: 2, analysis: makeAnalysis({ photoRevision: 1 }) }),
      makeItem({ id: 'outgrown', status: 'outgrown' }),
    ];
    expect(itemsToAnalyse(list).map((it) => it.id)).toEqual(['new', 'replaced']);
  });

  it('gives an item a new photo: new revision, no analysis, and its looks marked for the parent', () => {
    const data = {
      ...closetWith([makeItem({ id: 'a', analysis: makeAnalysis() }), makeItem({ id: 'p', type: 'pants' })]),
      aiLooks: [makeLook({ id: 'l1', upperId: 'a', bottomId: 'p' }), makeLook({ id: 'l2', upperId: 'x', bottomId: 'y' })],
    };
    const next = replaceItemPhoto(data, 'a', 'images/a-r1.jpg', '2027-01-01');
    expect(findItem(next, 'a')).toMatchObject({ image: 'images/a-r1.jpg', photoRevision: 1, analysis: null, updatedAt: '2027-01-01' });
    expect(next.aiLooks.map((l) => l.flagged)).toEqual([true, false]);
    expect(isAnalysed(findItem(next, 'a')!)).toBe(false);
    expect(() => replaceItemPhoto(data, 'gone', 'images/gone.webp', NOW)).toThrow('not found');
    // A new file named after its own id and next revision; never the old name, never another item's.
    for (const bad of ['images/a.webp', 'images/a-r2.webp', 'images/p-r1.webp']) {
      expect(() => replaceItemPhoto(data, 'a', bad, NOW)).toThrow('Bad photo path');
    }
  });

  it('removes the analysis with its item', () => {
    expect(removeItems(base, ['a']).items.map((it) => it.id)).toEqual(['b']);
  });
});
