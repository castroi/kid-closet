// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  AI_KEY_PREFIX,
  AI_USAGE_KEY,
  maskKey,
  monthOf,
  nextResetDate,
  readApiKey,
  readMonthlyUse,
  removeApiKey,
  saveApiKey,
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

  it('shows only the last four characters', () => {
    expect(maskKey('sk-or-v1-abcdef1234')).toBe('••••1234');
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
