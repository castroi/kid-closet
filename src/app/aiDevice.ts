import type { AiProviderId } from '../core/model';

/**
 * What belongs to this phone only, never to the closet or its backups: the API keys
 * (backups go to iCloud and get shared) and how many AI pictures were made this month.
 */
export type DeviceStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;

export const AI_KEY_PREFIX = 'kid-closet:ai-key:';
export const AI_USAGE_KEY = 'kid-closet:ai-usage';

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

/** Shows only the end of a key, so it can be recognised but not copied off the screen. */
export function maskKey(key: string): string {
  return `••••${key.slice(-4)}`;
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
