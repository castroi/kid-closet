// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  AI_CHECK_KEY,
  AI_KEY_PREFIX,
  AI_USAGE_KEY,
  aiReady,
  isValidApiKey,
  maskKey,
  monthOf,
  nextResetDate,
  readApiKey,
  readLastCheck,
  readMonthlyUse,
  recordUse,
  removeApiKey,
  saveApiKey,
  saveLastCheck,
  type DeviceStorage,
} from './aiDevice';
import { memoryStorage } from '../test/data';

const broken: DeviceStorage = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('blocked');
  },
  removeItem: () => {
    throw new Error('blocked');
  },
};

describe('API keys on the device', () => {
  it('keeps one key per provider', () => {
    const storage = memoryStorage();
    expect(saveApiKey(storage, 'venice', 'v-123')).toBe(true);
    expect(saveApiKey(storage, 'openrouter', 'o-456')).toBe(true);
    expect(readApiKey(storage, 'venice')).toBe('v-123');
    expect(storage.data.get(`${AI_KEY_PREFIX}openrouter`)).toBe('o-456');
    removeApiKey(storage, 'venice');
    expect(readApiKey(storage, 'venice')).toBeNull();
    expect(readApiKey(storage, 'openrouter')).toBe('o-456');
  });

  it('treats blocked or missing storage as "no key" and reports a failed save', () => {
    expect(readApiKey(null, 'venice')).toBeNull();
    expect(saveApiKey(null, 'venice', 'k')).toBe(false);
    expect(readApiKey(broken, 'venice')).toBeNull();
    expect(saveApiKey(broken, 'venice', 'k')).toBe(false);
    expect(() => removeApiKey(broken, 'venice')).not.toThrow();
    expect(readApiKey(memoryStorage({ [`${AI_KEY_PREFIX}venice`]: '' }), 'venice')).toBeNull();
  });

  it('shows only the last four characters of a long key, and nothing of a short one', () => {
    expect(maskKey('sk-or-v1-abcdef1234')).toBe('••••1234');
    expect(maskKey('abcdefgh')).toBe('••••');
  });

  it('accepts only printable keys without spaces, 8 to 512 characters', () => {
    expect(isValidApiKey('sk-or-v1-abc_DEF.123')).toBe(true);
    for (const bad of ['short', 'has space-in-it', 'tab\tinside-key', 'zero\u200bwidth-key', 'x'.repeat(513), 'עבריתעבריתע']) {
      expect(isValidApiKey(bad)).toBe(false);
    }
  });

  it('is ready only with a provider and its key on this phone', () => {
    const storage = memoryStorage({ [`${AI_KEY_PREFIX}venice`]: 'sk-venice-123' });
    const ai = { provider: null, model: '', prompt: null, monthlyCap: 100 };
    expect(aiReady(ai, storage)).toBe(false);
    expect(aiReady({ ...ai, provider: 'venice' }, storage)).toBe(true);
    expect(aiReady({ ...ai, provider: 'openrouter' }, storage)).toBe(false);
  });
});

describe('monthly use', () => {
  const oct = new Date(2026, 9, 26, 12);

  it('counts this local month only', () => {
    expect(monthOf(oct)).toBe('2026-10');
    expect(readMonthlyUse(memoryStorage({ [AI_USAGE_KEY]: '{"month":"2026-10","count":23}' }), oct)).toBe(23);
    expect(readMonthlyUse(memoryStorage({ [AI_USAGE_KEY]: '{"month":"2026-09","count":23}' }), oct)).toBe(0);
  });

  it('reads anything odd as zero', () => {
    for (const raw of ['oops', '{"month":"2026-10","count":-2}', '{"month":"2026-10","count":"5"}', 'null']) {
      expect(readMonthlyUse(memoryStorage({ [AI_USAGE_KEY]: raw }), oct)).toBe(0);
    }
    expect(readMonthlyUse(null, oct)).toBe(0);
    expect(readMonthlyUse(broken, oct)).toBe(0);
  });

  it('starts again on the 1st of next month, also across the year', () => {
    expect(nextResetDate(oct)).toEqual(new Date(2026, 10, 1));
    expect(nextResetDate(new Date(2026, 11, 31))).toEqual(new Date(2027, 0, 1));
  });
});

describe('last key check', () => {
  it("keeps the last result for the provider it was about, and can forget it", () => {
    const storage = memoryStorage();
    saveLastCheck(storage, { provider: 'venice', at: '2026-10-26T10:00:00.000Z', ok: true });
    expect(readLastCheck(storage, 'venice')).toEqual({ provider: 'venice', at: '2026-10-26T10:00:00.000Z', ok: true });
    expect(readLastCheck(storage, 'openrouter')).toBeNull();
    saveLastCheck(storage, null);
    expect(readLastCheck(storage, 'venice')).toBeNull();
  });

  it('reads anything odd as no check', () => {
    expect(readLastCheck(memoryStorage({ [AI_CHECK_KEY]: 'oops' }), 'venice')).toBeNull();
    expect(readLastCheck(memoryStorage({ [AI_CHECK_KEY]: '{"provider":"venice","at":1,"ok":true}' }), 'venice')).toBeNull();
    expect(readLastCheck(broken, 'venice')).toBeNull();
    expect(() => saveLastCheck(broken, null)).not.toThrow();
  });
});

describe('counting uses', () => {
  it('counts this month, starting again in a new month', () => {
    const storage = memoryStorage();
    recordUse(storage, new Date(2026, 9, 26));
    recordUse(storage, new Date(2026, 9, 27));
    expect(readMonthlyUse(storage, new Date(2026, 9, 28))).toBe(2);
    recordUse(storage, new Date(2026, 10, 1));
    expect(readMonthlyUse(storage, new Date(2026, 10, 1))).toBe(1);
    expect(() => recordUse(broken, new Date())).not.toThrow();
  });
});
