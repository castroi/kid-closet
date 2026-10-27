// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { AI_PROVIDERS } from './catalog';
import {
  ADAPTERS,
  AiError,
  MAX_CHAT_RESPONSE_BYTES,
  MAX_RESULT_BYTES,
  base64ToBytes,
  countsTowardCap,
  type AnalyzeCall,
  type FetchLike,
  type LookCall,
} from './providers';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const images = { doll: 'data:image/webp;base64,RE9MTA==', upper: 'data:image/jpeg;base64,VE9Q', bottom: 'data:image/webp;base64,Qk9U' };

function fetchReturning(response: Response) {
  return vi.fn<FetchLike>().mockResolvedValue(response);
}

function lookCall(fetch: FetchLike, overrides: Partial<LookCall> = {}): LookCall {
  return { images, prompt: 'Dress the doll.', model: 'm-1', apiKey: 'sk-test-123', signal: new AbortController().signal, fetch, ...overrides };
}

function sentBody(fetch: ReturnType<typeof vi.fn<FetchLike>>) {
  const [, init] = fetch.mock.calls[0];
  return JSON.parse(init.body as string) as Record<string, unknown>;
}

describe('Venice adapter', () => {
  it('sends the three pictures to multi-edit, doll first, with safe mode on', async () => {
    const fetch = fetchReturning(new Response(PNG, { status: 200, headers: { 'Content-Type': 'image/png' } }));
    const bytes = await ADAPTERS.venice.generateLook(lookCall(fetch));
    expect(bytes).toEqual(PNG);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(AI_PROVIDERS.venice.endpoints.look);
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ Authorization: 'Bearer sk-test-123', 'Content-Type': 'application/json' });
    expect(sentBody(fetch)).toEqual({ modelId: 'm-1', prompt: 'Dress the doll.', images: [images.doll, images.upper, images.bottom], safe_mode: true });
  });

  it.each(['x-venice-is-content-violation', 'x-venice-is-blurred'])('treats %s as a refusal', async (header) => {
    const fetch = fetchReturning(new Response(PNG, { status: 200, headers: { [header]: 'true' } }));
    await expect(ADAPTERS.venice.generateLook(lookCall(fetch))).rejects.toMatchObject({ reason: 'refused' });
  });

  it('checks the key with the rate limits endpoint', async () => {
    const fetch = fetchReturning(new Response('{}', { status: 200 }));
    await expect(ADAPTERS.venice.checkKey({ apiKey: 'k', signal: new AbortController().signal, fetch })).resolves.toBeNull();
    expect(fetch.mock.calls[0][0]).toBe(AI_PROVIDERS.venice.endpoints.check);
    expect(fetch.mock.calls[0][1].headers).toEqual({ Authorization: 'Bearer k' });
  });
});

describe('OpenRouter adapter', () => {
  it('sends the three pictures as references and decodes the base64 answer', async () => {
    const b64 = btoa(String.fromCharCode(...PNG));
    const fetch = fetchReturning(Response.json({ created: 1, data: [{ b64_json: b64, media_type: 'image/png' }] }));
    expect(await ADAPTERS.openrouter.generateLook(lookCall(fetch))).toEqual(PNG);
    expect(fetch.mock.calls[0][0]).toBe(AI_PROVIDERS.openrouter.endpoints.look);
    expect(sentBody(fetch)).toEqual({
      model: 'm-1',
      prompt: 'Dress the doll.',
      n: 1,
      input_references: [images.doll, images.upper, images.bottom].map((url) => ({ type: 'image_url', image_url: { url } })),
    });
  });

  it.each([
    ['no picture', Response.json({ data: [] })],
    ['not JSON', new Response('oops', { status: 200 })],
    ['broken base64', Response.json({ data: [{ b64_json: '%%%' }] })],
  ])('reports an answer with %s as a bad response', async (_label, response) => {
    await expect(ADAPTERS.openrouter.generateLook(lookCall(fetchReturning(response)))).rejects.toMatchObject({ reason: 'bad-response' });
  });

  it("checks the key and tells how much of the key's limit is left", async () => {
    const fetch = fetchReturning(Response.json({ data: { label: 'kid', limit: 5, limit_remaining: 4.2 } }));
    await expect(ADAPTERS.openrouter.checkKey({ apiKey: 'k', signal: new AbortController().signal, fetch })).resolves.toBe(
      'נשארו USD 4.20 במגבלה של המפתח',
    );
    expect(fetch.mock.calls[0][0]).toBe(AI_PROVIDERS.openrouter.endpoints.check);
    const noLimit = fetchReturning(Response.json({ data: { limit_remaining: null } }));
    await expect(ADAPTERS.openrouter.checkKey({ apiKey: 'k', signal: new AbortController().signal, fetch: noLimit })).resolves.toBeNull();
  });
});

describe('errors from either provider', () => {
  it.each([
    [400, 'bad-request'],
    [401, 'unauthorized'],
    [402, 'no-credit'],
    [403, 'unauthorized'],
    [404, 'bad-request'],
    [413, 'bad-request'],
    [429, 'rate-limited'],
    [500, 'provider-down'],
    [503, 'provider-down'],
    [529, 'provider-down'],
  ])('maps HTTP %i to %s', async (status, reason) => {
    for (const id of ['venice', 'openrouter'] as const) {
      const fetch = fetchReturning(new Response('not json', { status }));
      await expect(ADAPTERS[id].generateLook(lookCall(fetch))).rejects.toMatchObject({ reason });
    }
  });

  it("keeps the provider's message for the parent, in either error shape", async () => {
    const venice = fetchReturning(Response.json({ error: 'Invalid modelId' }, { status: 400 }));
    await expect(ADAPTERS.venice.generateLook(lookCall(venice))).rejects.toMatchObject({ detail: '400 Invalid modelId' });
    const openrouter = fetchReturning(Response.json({ error: { code: 402, message: 'Insufficient credits' } }, { status: 402 }));
    await expect(ADAPTERS.openrouter.generateLook(lookCall(openrouter))).rejects.toMatchObject({
      reason: 'no-credit',
      detail: '402 Insufficient credits',
    });
  });

  it('calls it a network problem when there is no answer at all (offline or CORS)', async () => {
    const fetch = vi.fn<FetchLike>().mockRejectedValue(new TypeError('Load failed'));
    const err = await ADAPTERS.venice.checkKey({ apiKey: 'k', signal: new AbortController().signal, fetch }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiError);
    expect(err).toMatchObject({ reason: 'network', detail: 'Load failed' });
  });

  it('lets an abort through untouched, for send.ts to name', async () => {
    const controller = new AbortController();
    controller.abort();
    const abort = new DOMException('aborted', 'AbortError');
    const fetch = vi.fn<FetchLike>().mockRejectedValue(abort);
    await expect(ADAPTERS.openrouter.generateLook(lookCall(fetch, { signal: controller.signal }))).rejects.toBe(abort);
  });
});

describe('safety of what comes back', () => {
  it('never keeps the API key in an error, even when the provider repeats it', async () => {
    const venice = fetchReturning(Response.json({ error: 'Invalid key sk-test-123 for this route' }, { status: 401 }));
    const err = (await ADAPTERS.venice.generateLook(lookCall(venice)).catch((e: unknown) => e)) as AiError;
    expect(err.detail).toBe('401 Invalid key •••• for this route');
    expect(err.message).not.toContain('sk-test-123');
    const network = vi.fn<FetchLike>().mockRejectedValue(new TypeError('failed for sk-test-123'));
    const err2 = (await ADAPTERS.openrouter.generateLook(lookCall(network)).catch((e: unknown) => e)) as AiError;
    expect(err2.detail).not.toContain('sk-test-123');
  });

  it('refuses an answer that says it is too large before downloading it', async () => {
    const big = String(MAX_RESULT_BYTES + 1);
    const venice = fetchReturning(new Response(PNG, { headers: { 'Content-Length': big } }));
    await expect(ADAPTERS.venice.generateLook(lookCall(venice))).rejects.toMatchObject({ reason: 'bad-response' });
    const b64 = String(Math.ceil(((MAX_RESULT_BYTES + 1) * 4) / 3));
    const openrouter = fetchReturning(new Response('{}', { headers: { 'Content-Length': b64 } }));
    await expect(ADAPTERS.openrouter.generateLook(lookCall(openrouter))).rejects.toMatchObject({ reason: 'bad-response' });
  });

  it('reports a download cut off by the deadline as an abort, not a broken answer or a working key', async () => {
    const controller = new AbortController();
    const abort = new DOMException('aborted', 'AbortError');
    const cutOff = () => {
      const response = Response.json({});
      vi.spyOn(response, 'json').mockImplementation(() => {
        controller.abort();
        return Promise.reject(abort);
      });
      return vi.fn<FetchLike>().mockResolvedValue(response);
    };
    await expect(ADAPTERS.openrouter.generateLook(lookCall(cutOff(), { signal: controller.signal }))).rejects.toBe(abort);
    await expect(ADAPTERS.openrouter.checkKey({ apiKey: 'k', signal: controller.signal, fetch: cutOff() })).rejects.toBe(abort);
  });
});

describe('base64ToBytes', () => {
  it('decodes plain base64 and data URLs, ignoring line breaks', () => {
    expect(base64ToBytes('AQID')).toEqual(new Uint8Array([1, 2, 3]));
    expect(base64ToBytes('data:image/png;base64,AQ\nID')).toEqual(new Uint8Array([1, 2, 3]));
  });
});

describe('garment analysis (chat completions)', () => {
  const photo = 'data:image/webp;base64,U0hJUlQ=';
  const schema = { name: 'garment', schema: { type: 'object' } };

  function analyzeCall(fetch: FetchLike, overrides: Partial<AnalyzeCall> = {}): AnalyzeCall {
    return { photo, prompt: 'Describe it.', schema, model: 'deepseek', apiKey: 'sk-test-123', signal: new AbortController().signal, fetch, ...overrides };
  }

  function answering(content: unknown, extra: Record<string, unknown> = {}) {
    return fetchReturning(Response.json({ choices: [{ message: { role: 'assistant', content, ...extra } }] }));
  }

  it('sends the prompt, then the photo, with the strict schema and temperature 0, plus each provider\'s own option', async () => {
    const extras = {
      venice: { venice_parameters: { include_venice_system_prompt: false } },
      openrouter: { provider: { require_parameters: true } },
    };
    for (const id of ['venice', 'openrouter'] as const) {
      const fetch = answering('{"valid_image":true}');
      await expect(ADAPTERS[id].analyzeItem(analyzeCall(fetch))).resolves.toBe('{"valid_image":true}');
      const [url, init] = fetch.mock.calls[0];
      expect(url).toBe(AI_PROVIDERS[id].endpoints.analyze);
      expect(init.method).toBe('POST');
      expect(init.headers).toEqual({ Authorization: 'Bearer sk-test-123', 'Content-Type': 'application/json' });
      expect(sentBody(fetch)).toEqual({
        model: 'deepseek',
        messages: [
          { role: 'system', content: 'Describe it.' },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Describe the clothing item in this photo.' },
              { type: 'image_url', image_url: { url: photo } },
            ],
          },
        ],
        temperature: 0,
        response_format: { type: 'json_schema', json_schema: { name: 'garment', strict: true, schema: { type: 'object' } } },
        ...extras[id],
      });
    }
  });

  it("reports the model's refusal, without the key", async () => {
    const fetch = answering(null, { refusal: 'I cannot help with sk-test-123.' });
    await expect(ADAPTERS.venice.analyzeItem(analyzeCall(fetch))).rejects.toMatchObject({ reason: 'refused', detail: 'I cannot help with ••••.' });
  });

  it.each([
    ['no answer text', Response.json({ choices: [{ message: { content: '' } }] })],
    ['no choices', Response.json({ choices: [] })],
    ['not JSON', new Response('oops', { status: 200 })],
  ])('reports an answer with %s as a bad response', async (_label, response) => {
    await expect(ADAPTERS.openrouter.analyzeItem(analyzeCall(fetchReturning(response)))).rejects.toMatchObject({ reason: 'bad-response' });
  });

  it('maps HTTP errors like a look does', async () => {
    const fetch = fetchReturning(Response.json({ error: { message: 'No endpoints support response_format' } }, { status: 404 }));
    await expect(ADAPTERS.openrouter.analyzeItem(analyzeCall(fetch))).rejects.toMatchObject({
      reason: 'bad-request',
      detail: '404 No endpoints support response_format',
    });
  });

  it('refuses an answer that says it is too large before downloading it', async () => {
    const fetch = fetchReturning(new Response('{}', { headers: { 'Content-Length': String(MAX_CHAT_RESPONSE_BYTES + 1) } }));
    await expect(ADAPTERS.venice.analyzeItem(analyzeCall(fetch))).rejects.toMatchObject({ reason: 'bad-response', detail: 'answer too large' });
  });

  it('reports a download cut off by the deadline as an abort', async () => {
    const controller = new AbortController();
    const abort = new DOMException('aborted', 'AbortError');
    const response = Response.json({});
    vi.spyOn(response, 'json').mockImplementation(() => {
      controller.abort();
      return Promise.reject(abort);
    });
    const fetch = vi.fn<FetchLike>().mockResolvedValue(response);
    await expect(ADAPTERS.venice.analyzeItem(analyzeCall(fetch, { signal: controller.signal }))).rejects.toBe(abort);
  });
});

describe('countsTowardCap', () => {
  it('counts calls that reached the provider and may cost money, nothing else', () => {
    for (const reason of ['timeout', 'refused', 'provider-down', 'bad-response'] as const) expect(countsTowardCap(new AiError(reason))).toBe(true);
    for (const reason of ['unauthorized', 'no-credit', 'rate-limited', 'bad-request', 'network', 'cancelled', 'bad-photo'] as const) {
      expect(countsTowardCap(new AiError(reason))).toBe(false);
    }
    expect(countsTowardCap(new Error('x'))).toBe(false);
  });
});
