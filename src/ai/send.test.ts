// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { defaultAiSettings } from '../core/model';
import { cleanWebp, gpsJpeg, gpsWebp } from '../test/photos';
import { AI_PROVIDERS } from './catalog';
import { DEFAULT_PROMPT } from './prompt';
import type { FetchLike } from './providers';
import { MAX_RESULT_BYTES, bytesToBase64, checkConnection, requestLook, sniffImage, type LookRequest } from './send';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);

function request(fetch: FetchLike, overrides: Partial<LookRequest> = {}): LookRequest {
  return {
    provider: 'venice',
    settings: { ...defaultAiSettings(), provider: 'venice' },
    apiKey: 'sk-test-123',
    doll: { bytes: cleanWebp, ext: 'webp' },
    upper: { bytes: gpsJpeg, ext: 'jpg' },
    bottom: { bytes: gpsWebp, ext: 'webp' },
    fetch,
    ...overrides,
  };
}

/** A fetch that never answers, but stops when its signal aborts, like the real one. */
const hangingFetch: FetchLike = (_url, init) =>
  new Promise((_resolve, reject) => {
    init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
  });

describe('requestLook', () => {
  it("removes every photo's location and other metadata before it leaves the phone", async () => {
    const fetch = vi.fn<FetchLike>().mockResolvedValue(new Response(PNG));
    await requestLook(request(fetch));
    const body = JSON.parse(fetch.mock.calls[0][1].body as string) as { images: string[] };
    const sent = body.images.map((url) => atob(url.split(',')[1]));
    expect(body.images[0].startsWith('data:image/webp;base64,')).toBe(true);
    expect(body.images[1].startsWith('data:image/jpeg;base64,')).toBe(true);
    for (const text of sent) {
      expect(text).not.toContain('Exif');
      expect(text).not.toContain('GPSXMP');
      expect(text).not.toContain('COMMENT-ME');
    }
  });

  it("uses the provider's default model and the built-in prompt when none are set, and reports them", async () => {
    const fetch = vi.fn<FetchLike>().mockResolvedValue(new Response(JPEG));
    const result = await requestLook(request(fetch));
    expect(result).toMatchObject({ mime: 'image/jpeg', model: AI_PROVIDERS.venice.defaultModel, prompt: DEFAULT_PROMPT });
    const custom = await requestLook(
      request(vi.fn<FetchLike>().mockResolvedValue(new Response(WEBP)), {
        settings: { ...defaultAiSettings(), provider: 'venice', model: 'nano-banana-2-1-edit', prompt: 'Mine.' },
      }),
    );
    expect(custom).toMatchObject({ mime: 'image/webp', model: 'nano-banana-2-1-edit', prompt: 'Mine.' });
  });

  it('refuses an answer that is not a picture, or far too large', async () => {
    await expect(requestLook(request(vi.fn<FetchLike>().mockResolvedValue(new Response('<html>'))))).rejects.toMatchObject({
      reason: 'bad-response',
    });
    const huge = new Uint8Array(MAX_RESULT_BYTES + 1);
    huge.set(PNG);
    await expect(requestLook(request(vi.fn<FetchLike>().mockResolvedValue(new Response(huge))))).rejects.toMatchObject({
      reason: 'bad-response',
    });
  });

  it('refuses to send a stored picture that is not what its name says', async () => {
    const fetch = vi.fn<FetchLike>();
    await expect(requestLook(request(fetch, { upper: { bytes: PNG, ext: 'jpg' } }))).rejects.toMatchObject({ reason: 'bad-photo' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('gives up after the time limit', async () => {
    await expect(requestLook(request(hangingFetch, { timeoutMs: 20 }))).rejects.toMatchObject({ reason: 'timeout' });
  });

  it('stops when cancelled, and says so', async () => {
    const controller = new AbortController();
    const pending = requestLook(request(hangingFetch, { signal: controller.signal }));
    controller.abort();
    await expect(pending).rejects.toMatchObject({ reason: 'cancelled' });
    const already = new AbortController();
    already.abort();
    await expect(requestLook(request(hangingFetch, { signal: already.signal }))).rejects.toMatchObject({ reason: 'cancelled' });
  });

  it('passes provider errors through unchanged', async () => {
    const fetch = vi.fn<FetchLike>().mockResolvedValue(new Response('', { status: 401 }));
    await expect(requestLook(request(fetch))).rejects.toMatchObject({ reason: 'unauthorized' });
  });
});

describe('checkConnection', () => {
  it("returns the provider's note, and times out like a look", async () => {
    const fetch = vi.fn<FetchLike>().mockResolvedValue(Response.json({ data: { limit_remaining: 1 } }));
    await expect(checkConnection('openrouter', 'k', { fetch })).resolves.toBe('נשארו USD 1.00 במגבלה של המפתח');
    await expect(checkConnection('venice', 'k', { fetch: hangingFetch, timeoutMs: 20 })).rejects.toMatchObject({ reason: 'timeout' });
  });
});

describe('helpers', () => {
  it('tells the picture type from its first bytes', () => {
    expect(sniffImage(PNG)).toBe('image/png');
    expect(sniffImage(JPEG)).toBe('image/jpeg');
    expect(sniffImage(WEBP)).toBe('image/webp');
    expect(sniffImage(new Uint8Array([1, 2, 3]))).toBeNull();
  });

  it('encodes large byte arrays to base64 without overflowing', () => {
    const big = new Uint8Array(200_000).map((_, i) => i % 256);
    expect(atob(bytesToBase64(big)).length).toBe(big.length);
    expect(bytesToBase64(new Uint8Array([1, 2, 3]))).toBe('AQID');
  });
});
