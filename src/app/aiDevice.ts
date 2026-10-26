import type { AiProviderId, AiSettings } from '../core/model';

/**
 * What belongs to this phone only, never to the closet or its backups: the API keys
 * (backups go to iCloud and get shared) and how many AI pictures were made this month.
 */
export type DeviceStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;

export const AI_KEY_PREFIX = 'kid-closet:ai-key:';
export const AI_USAGE_KEY = 'kid-closet:ai-usage';
export const AI_CHECK_KEY = 'kid-closet:ai-check';

/** The last "בדיקת חיבור" on this phone, shown in the parent panel. */
export interface LastCheck {
  provider: AiProviderId;
  at: string;
  ok: boolean;
}

export function readLastCheck(storage: DeviceStorage, provider: AiProviderId): LastCheck | null {
  try {
    const raw = JSON.parse(storage?.getItem(AI_CHECK_KEY) ?? 'null') as Partial<LastCheck> | null;
    if (raw?.provider !== provider || typeof raw.at !== 'string' || typeof raw.ok !== 'boolean') return null;
    return { provider, at: raw.at, ok: raw.ok };
  } catch {
    return null;
  }
}

export function saveLastCheck(storage: DeviceStorage, check: LastCheck | null): void {
  try {
    if (check) storage?.setItem(AI_CHECK_KEY, JSON.stringify(check));
    else storage?.removeItem(AI_CHECK_KEY);
  } catch {
    // only the status line loses it
  }
}

export function browserDeviceStorage(): DeviceStorage {
  try {
    return window.localStorage;
  } catch {
    return null; // e.g. storage blocked; keys then can't be saved and AI stays off
  }
}

export function readApiKey(storage: DeviceStorage, provider: AiProviderId): string | null {
  try {
    return storage?.getItem(AI_KEY_PREFIX + provider) || null;
  } catch {
    return null;
  }
}

/** Returns false when the phone refused to store it. */
export function saveApiKey(storage: DeviceStorage, provider: AiProviderId, key: string): boolean {
  if (!storage) return false;
  try {
    storage.setItem(AI_KEY_PREFIX + provider, key);
    return true;
  } catch {
    return false;
  }
}

export function removeApiKey(storage: DeviceStorage, provider: AiProviderId): void {
  try {
    storage?.removeItem(AI_KEY_PREFIX + provider);
  } catch {
    // nothing to do: an unreadable key is treated as missing
  }
}

/**
 * API keys are long runs of printable characters without spaces. A pasted key with a
 * space, a line break or an invisible character would fail later with a confusing error.
 */
const API_KEY = /^[\x21-\x7e]{8,512}$/;

export function isValidApiKey(key: string): boolean {
  return API_KEY.test(key);
}

/** Shows only the end of a long key, so it can be recognised but not copied off the screen. */
export function maskKey(key: string): string {
  return key.length >= 12 ? `••••${key.slice(-4)}` : '••••';
}

/** AI looks can be made only with a provider picked and its key on this phone. The kid's button uses the same check. */
export function aiReady(ai: AiSettings, storage: DeviceStorage): boolean {
  return ai.provider !== null && readApiKey(storage, ai.provider) !== null;
}

/** The phone's local month, e.g. "2026-10"; usage starts again on the 1st. */
export function monthOf(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/** The 1st of next month, when the count starts again. */
export function nextResetDate(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 1);
}

export function readMonthlyUse(storage: DeviceStorage, now: Date): number {
  try {
    const raw = JSON.parse(storage?.getItem(AI_USAGE_KEY) ?? 'null') as { month?: unknown; count?: unknown } | null;
    if (raw?.month !== monthOf(now)) return 0;
    return typeof raw.count === 'number' && Number.isInteger(raw.count) && raw.count > 0 ? raw.count : 0;
  } catch {
    return 0;
  }
}
