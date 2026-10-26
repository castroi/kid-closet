import type { AiProviderId } from '../core/model';
import { AI_PROVIDERS } from './catalog';

/**
 * One adapter per provider: how to ask for a look and how to check a key. Everything
 * else (metadata stripping, the timeout, checking the picture that comes back) is
 * shared in src/ai/send.ts, so a new provider only describes its own request and response.
 * Docs: Venice https://docs.venice.ai/api-reference/endpoint/image/multi-edit,
 * OpenRouter https://openrouter.ai/docs/api/api-reference/images/generate-an-image.
 */

/** Why a call failed. The kid sees one friendly line; the parent area shows the reason. */
export type AiErrorReason =
  | 'unauthorized' // 401/403: wrong, disabled or restricted key
  | 'no-credit' // 402
  | 'rate-limited' // 429
  | 'bad-request' // 400/404/413/415: model name or request the provider doesn't accept
  | 'provider-down' // 5xx, 524, 529
  | 'refused' // the provider's content filter
  | 'network' // no answer: offline, or the provider doesn't allow calls from a web page (CORS)
  | 'timeout'
  | 'cancelled'
  | 'bad-response' // not a usable picture
  | 'bad-photo'; // one of our own pictures couldn't be read before sending

export class AiError extends Error {
  constructor(
    readonly reason: AiErrorReason,
    /** The provider's own message, for the parent; never shown to the kid. */
    readonly detail = '',
  ) {
    super(detail ? `${reason}: ${detail}` : reason);
    this.name = 'AiError';
  }
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** Far above a 1–2K picture; stops a broken answer from filling the phone's memory. */
export const MAX_RESULT_BYTES = 20 * 1024 * 1024;

/** Refuses an answer that says up front it is too large, before downloading it. */
function refuseIfTooLarge(response: Response, factor = 1): void {
  const length = Number(response.headers.get('content-length'));
  if (Number.isFinite(length) && length * factor > MAX_RESULT_BYTES) throw new AiError('bad-response', 'picture too large');
}

/** Some providers repeat the key in an auth error; it must never reach the screen or storage. */
function redact(text: string, apiKey: string): string {
  return apiKey ? text.split(apiKey).join('••••') : text;
}

export interface LookImages {
  /** data: URLs, in the order the prompt names them: 1 doll, 2 upper garment, 3 trousers. */
  doll: string;
  upper: string;
  bottom: string;
}

export interface LookCall {
  images: LookImages;
  prompt: string;
  model: string;
  apiKey: string;
  signal: AbortSignal;
  fetch: FetchLike;
}

export interface ProviderAdapter {
  /** Returns the picture's bytes as the provider sent them; send.ts checks they are an image. */
  generateLook(call: LookCall): Promise<Uint8Array>;
  /** Resolves when the key works; the text, if any, is shown to the parent (e.g. credit left). */
  checkKey(call: { apiKey: string; signal: AbortSignal; fetch: FetchLike }): Promise<string | null>;
}

function reasonForStatus(status: number): AiErrorReason {
  if (status === 401 || status === 403) return 'unauthorized';
  if (status === 402) return 'no-credit';
  if (status === 429) return 'rate-limited';
  if (status >= 500) return 'provider-down';
  return 'bad-request';
}

/** Turns a failed response into an AiError, with the provider's message (without the key) when it sent one. */
async function failure(response: Response, apiKey: string): Promise<AiError> {
  let detail = '';
  try {
    const body = (await response.json()) as { error?: unknown };
    const error = body?.error;
    if (typeof error === 'string') detail = error;
    else if (error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string') {
      detail = (error as { message: string }).message;
    }
  } catch {
    // not JSON; the status says enough
  }
  return new AiError(reasonForStatus(response.status), `${response.status}${detail ? ` ${redact(detail, apiKey).slice(0, 300)}` : ''}`);
}

/** Calls fetch and maps "no answer at all" to `network` (offline, blocked by CORS, or the connection dropped). */
async function call(fetchFn: FetchLike, url: string, init: RequestInit, apiKey: string): Promise<Response> {
  try {
    return await fetchFn(url, init);
  } catch (err) {
    if (init.signal?.aborted) throw err; // send.ts tells a timeout from a cancel
    throw new AiError('network', redact(err instanceof Error ? err.message : String(err), apiKey));
  }
}

function headers(apiKey: string, json: boolean): Record<string, string> {
  return json ? { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' } : { Authorization: `Bearer ${apiKey}` };
}

const venice: ProviderAdapter = {
  async generateLook({ images, prompt, model, apiKey, signal, fetch }) {
    const init: RequestInit = {
      method: 'POST',
      headers: headers(apiKey, true),
      // The first image is the base the others are put on. safe_mode stays on (Venice's default): it's a kid's app.
      body: JSON.stringify({ modelId: model, prompt, images: [images.doll, images.upper, images.bottom], safe_mode: true }),
      signal,
    };
    const response = await call(fetch, AI_PROVIDERS.venice.endpoints.look, init, apiKey);
    if (!response.ok) throw await failure(response, apiKey);
    // Readable only if Venice exposes these headers to web pages (CORS); checked on her iPhone (plan §3).
    if (response.headers.get('x-venice-is-content-violation') === 'true' || response.headers.get('x-venice-is-blurred') === 'true') {
      throw new AiError('refused');
    }
    refuseIfTooLarge(response);
    return new Uint8Array(await response.arrayBuffer());
  },
  async checkKey({ apiKey, signal, fetch }) {
    const response = await call(fetch, AI_PROVIDERS.venice.endpoints.check, { method: 'GET', headers: headers(apiKey, false), signal }, apiKey);
    if (!response.ok) throw await failure(response, apiKey);
    return null;
  },
};

const openrouter: ProviderAdapter = {
  async generateLook({ images, prompt, model, apiKey, signal, fetch }) {
    const init: RequestInit = {
      method: 'POST',
      headers: headers(apiKey, true),
      body: JSON.stringify({
        model,
        prompt,
        n: 1,
        input_references: [images.doll, images.upper, images.bottom].map((url) => ({ type: 'image_url', image_url: { url } })),
      }),
      signal,
    };
    const response = await call(fetch, AI_PROVIDERS.openrouter.endpoints.look, init, apiKey);
    if (!response.ok) throw await failure(response, apiKey);
    refuseIfTooLarge(response, 0.75); // base64 is 4/3 the size of the picture
    let b64: unknown;
    try {
      const body = (await response.json()) as { data?: { b64_json?: unknown }[] };
      b64 = body?.data?.[0]?.b64_json;
    } catch (err) {
      if (signal.aborted) throw err; // cut off while downloading: a timeout, not a broken answer
      throw new AiError('bad-response', 'not JSON');
    }
    if (typeof b64 !== 'string' || b64.length === 0) throw new AiError('bad-response', 'no picture in the answer');
    // Decoded here: fetching a data: URL would be blocked by the CSP's connect-src.
    return base64ToBytes(b64);
  },
  async checkKey({ apiKey, signal, fetch }) {
    const response = await call(fetch, AI_PROVIDERS.openrouter.endpoints.check, { method: 'GET', headers: headers(apiKey, false), signal }, apiKey);
    if (!response.ok) throw await failure(response, apiKey);
    try {
      const body = (await response.json()) as { data?: { limit_remaining?: unknown } };
      const left = body?.data?.limit_remaining;
      return typeof left === 'number' ? `נשארו USD ${left.toFixed(2)} במגבלה של המפתח` : null;
    } catch (err) {
      if (signal.aborted) throw err; // a timeout must not read as "the key works"
      return null;
    }
  },
};

export const ADAPTERS: Record<AiProviderId, ProviderAdapter> = { venice, openrouter };

export function base64ToBytes(b64: string): Uint8Array {
  let binary: string;
  try {
    binary = atob(b64.replace(/^data:[^,]*,/, '').replace(/\s/g, ''));
  } catch {
    throw new AiError('bad-response', 'broken base64');
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
