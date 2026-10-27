// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { defaultAiSettings } from '../core/model';
import bundledDollDataUrl from '../assets/doll-default.webp?inline';
import sampleGarmentDataUrl from '../assets/sample-garment.webp?inline';
import { sampleAttributes } from '../test/data';
import { cleanWebp, gpsJpeg, gpsWebp } from '../test/photos';
import { ATTRIBUTES_PROMPT, ATTRIBUTES_PROMPT_VERSION, ATTRIBUTES_SCHEMA } from './attributesPrompt';
import { AI_PROVIDERS } from './catalog';
import { DEFAULT_PROMPT } from './prompt';
import type { FetchLike } from './providers';
import {
  ANALYSIS_TIMEOUT_MS,
  MAX_RESULT_BYTES,
  bytesToBase64,
  checkConnection,
  requestAttributes,
  requestLook,
  sniffImage,
  type AttributesRequest,
  type LookRequest,
} from './send';

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
const hangingFetch = vi.fn<FetchLike>(
  (_url, init) =>
    new Promise((_resolve, reject) => {
      const abort = () => reject(new DOMException('aborted', 'AbortError'));
      if (init.signal?.aborted) abort();
      init.signal?.addEventListener('abort', abort);
    }),
);

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

  it('sends the real bundled doll (lossy WebP) unchanged, as it has no metadata', async () => {
    const doll = Uint8Array.from(atob(bundledDollDataUrl.split(',')[1]), (c) => c.charCodeAt(0));
    expect(doll.length).toBeGreaterThan(1000);
    const fetch = vi.fn<FetchLike>().mockResolvedValue(new Response(PNG));
    await requestLook(request(fetch, { doll: { bytes: doll, ext: 'webp' } }));
    const body = JSON.parse(fetch.mock.calls[0][1].body as string) as { images: string[] };
    expect(body.images[0]).toBe(`data:image/webp;base64,${bytesToBase64(doll)}`);
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

  it('passes provider errors through unchanged', async () => {
    const fetch = vi.fn<FetchLike>().mockResolvedValue(new Response('', { status: 401 }));
    await expect(requestLook(request(fetch))).rejects.toMatchObject({ reason: 'unauthorized' });
  });
});

describe('checkConnection', () => {
  it('stops when cancelled, and never calls the provider when cancelled before it starts', async () => {
    const controller = new AbortController();
    const pending = checkConnection('venice', 'k', { fetch: hangingFetch, signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ reason: 'cancelled' });
    const already = new AbortController();
    already.abort();
    hangingFetch.mockClear();
    await expect(checkConnection('venice', 'k', { fetch: hangingFetch, signal: already.signal })).rejects.toMatchObject({
      reason: 'cancelled',
    });
    expect(hangingFetch).not.toHaveBeenCalled();
  });

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

describe('requestAttributes', () => {
  const answer = (patch: Record<string, unknown> = {}) =>
    Response.json({ choices: [{ message: { content: JSON.stringify({ valid_image: true, ...sampleAttributes(), ...patch }) } }] });

  function attributesRequest(fetch: FetchLike, overrides: Partial<AttributesRequest> = {}): AttributesRequest {
    return {
      provider: 'openrouter',
      settings: { ...defaultAiSettings(), provider: 'openrouter' },
      apiKey: 'sk-test-123',
      photo: { bytes: gpsJpeg, ext: 'jpg' },
      fetch,
      ...overrides,
    };
  }

  function sentPhoto(fetch: ReturnType<typeof vi.fn<FetchLike>>): string {
    const body = JSON.parse(fetch.mock.calls[0][1].body as string) as { messages: { content: unknown }[] };
    const parts = body.messages[1].content as { type: string; image_url?: { url: string } }[];
    return parts.find((p) => p.type === 'image_url')!.image_url!.url;
  }

  it('sends the photo without metadata, with the built-in prompt and schema, and returns the validated attributes', async () => {
    const fetch = vi.fn<FetchLike>().mockResolvedValue(answer());
    const result = await requestAttributes(attributesRequest(fetch));
    expect(result).toEqual({
      analysis: { result: 'ok', attributes: sampleAttributes() },
      model: AI_PROVIDERS.openrouter.defaultAnalysisModel,
      promptVersion: ATTRIBUTES_PROMPT_VERSION,
    });
    const url = sentPhoto(fetch);
    expect(url.startsWith('data:image/jpeg;base64,')).toBe(true);
    const sent = atob(url.split(',')[1]);
    expect(sent).not.toContain('Exif');
    expect(sent).not.toContain('GPSXMP');
    const body = JSON.parse(fetch.mock.calls[0][1].body as string) as { messages: { content: unknown }[]; response_format: unknown };
    expect(body.messages[0].content).toBe(ATTRIBUTES_PROMPT);
    expect(body.response_format).toMatchObject({ json_schema: { strict: true, schema: ATTRIBUTES_SCHEMA } });
  });

  it('sends the bundled sample photo unchanged, as it has no metadata', async () => {
    const sample = Uint8Array.from(atob(sampleGarmentDataUrl.split(',')[1]), (c) => c.charCodeAt(0));
    expect(sample.length).toBeGreaterThan(4096); // over Vite's inline limit, so the build keeps it a file
    const fetch = vi.fn<FetchLike>().mockResolvedValue(answer());
    await requestAttributes(attributesRequest(fetch, { photo: { bytes: sample, ext: 'webp' } }));
    expect(sentPhoto(fetch)).toBe(`data:image/webp;base64,${bytesToBase64(sample)}`);
  });

  it("uses the parent's analysis model, never the doll model", async () => {
    const fetch = vi.fn<FetchLike>().mockResolvedValue(answer());
    const settings = { ...defaultAiSettings(), provider: 'venice' as const, model: 'muse-image-edit', analysis: { enabled: true, model: ' my-vision ', monthlyCap: 9 } };
    const result = await requestAttributes(attributesRequest(fetch, { provider: 'venice', settings }));
    expect(result.model).toBe('my-vision');
    expect((JSON.parse(fetch.mock.calls[0][1].body as string) as { model: string }).model).toBe('my-vision');
  });

  it('returns an invalid photo as it is', async () => {
    const fetch = vi.fn<FetchLike>().mockResolvedValue(
      Response.json({ choices: [{ message: { content: '{"valid_image":false,"notes":"Two shirts."}' } }] }),
    );
    expect((await requestAttributes(attributesRequest(fetch))).analysis).toEqual({ result: 'invalid-photo', notes: 'Two shirts.' });
  });

  it('reports an answer that does not fit the schema as a bad response, naming the field', async () => {
    const fetch = vi.fn<FetchLike>().mockResolvedValue(answer({ pattern: 'paisley' }));
    await expect(requestAttributes(attributesRequest(fetch))).rejects.toMatchObject({ reason: 'bad-response', detail: 'pattern' });
  });

  it('refuses to send a photo that is not what its name says, and gives up after the time limit', async () => {
    const fetch = vi.fn<FetchLike>();
    await expect(requestAttributes(attributesRequest(fetch, { photo: { bytes: PNG, ext: 'jpg' } }))).rejects.toMatchObject({ reason: 'bad-photo' });
    expect(fetch).not.toHaveBeenCalled();
    await expect(requestAttributes(attributesRequest(hangingFetch, { timeoutMs: 20 }))).rejects.toMatchObject({ reason: 'timeout' });
    expect(ANALYSIS_TIMEOUT_MS).toBe(60_000);
  });
});
