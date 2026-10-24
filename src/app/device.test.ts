import { describe, expect, it, vi } from 'vitest';
import { browserShareEnv, daysSince, formatBytes, readStorageStatus, requestPersistence, shareOrDownload } from './device';

describe('requestPersistence', () => {
  it('returns null when the API is missing', async () => {
    expect(await requestPersistence(undefined)).toBeNull();
    expect(await requestPersistence({})).toBeNull();
  });

  it('does not ask again when already persisted', async () => {
    const persist = vi.fn();
    expect(await requestPersistence({ persisted: async () => true, persist })).toBe(true);
    expect(persist).not.toHaveBeenCalled();
  });

  it('asks when not yet persisted', async () => {
    expect(await requestPersistence({ persisted: async () => false, persist: async () => false })).toBe(false);
  });

  it('swallows errors', async () => {
    expect(
      await requestPersistence({
        persisted: async () => {
          throw new Error('x');
        },
        persist: async () => true,
      }),
    ).toBeNull();
  });
});

describe('readStorageStatus', () => {
  it('reads persisted state and usage', async () => {
    expect(await readStorageStatus({ persisted: async () => true, estimate: async () => ({ usage: 2048 }) })).toEqual({
      persisted: true,
      usageBytes: 2048,
    });
  });

  it('handles missing APIs and errors', async () => {
    expect(await readStorageStatus(undefined)).toEqual({ persisted: null, usageBytes: null });
    expect(await readStorageStatus({ estimate: async () => ({}) })).toEqual({ persisted: null, usageBytes: null });
    const failing = {
      persisted: async () => {
        throw new Error('a');
      },
      estimate: async () => {
        throw new Error('b');
      },
    };
    expect(await readStorageStatus(failing)).toEqual({ persisted: null, usageBytes: null });
  });
});

describe('formatBytes', () => {
  it('uses B, KB and MB with two decimals', () => {
    expect(formatBytes(500)).toBe('500 B');
    expect(formatBytes(1536)).toBe('1.50 KB');
    expect(formatBytes(7_864_320)).toBe('7.50 MB');
  });
});

describe('daysSince', () => {
  const now = new Date('2026-10-24T12:00:00Z');
  it('counts whole days', () => {
    expect(daysSince('2026-10-10T12:00:00Z', now)).toBe(14);
    expect(daysSince(null, now)).toBeNull();
    expect(daysSince('not a date', now)).toBeNull();
  });
});

describe('shareOrDownload', () => {
  const bytes = new Uint8Array([1, 2]);

  it('uses the share sheet when files can be shared', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const download = vi.fn();
    expect(await shareOrDownload(bytes, 'b.zip', { canShare: () => true, share, download })).toBe(true);
    expect(share).toHaveBeenCalledWith(expect.objectContaining({ title: 'b.zip' }));
    expect(download).not.toHaveBeenCalled();
  });

  it('reports a cancelled share', async () => {
    const abort = Object.assign(new Error('cancel'), { name: 'AbortError' });
    const env = { canShare: () => true, share: vi.fn().mockRejectedValue(abort), download: vi.fn() };
    expect(await shareOrDownload(bytes, 'b.zip', env)).toBe(false);
  });

  it('rethrows other share errors', async () => {
    const env = { canShare: () => true, share: vi.fn().mockRejectedValue(new Error('boom')), download: vi.fn() };
    await expect(shareOrDownload(bytes, 'b.zip', env)).rejects.toThrow('boom');
  });

  it('downloads when sharing files is not possible', async () => {
    const download = vi.fn();
    await shareOrDownload(bytes, 'b.zip', { canShare: () => false, share: vi.fn(), download });
    expect(download).toHaveBeenCalledWith(expect.objectContaining({ name: 'b.zip' }));
  });

  it('browser download clicks a temporary link', () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const env = browserShareEnv();
    env.download(new File(['x'], 'b.zip'));
    expect(click).toHaveBeenCalled();
    expect(document.querySelector('a[download]')).toBeNull();
    click.mockRestore();
  });
});
