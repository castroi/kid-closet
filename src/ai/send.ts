import type { AiProviderId, AiSettings } from '../core/model';
import { stripPhotoMetadata } from '../image/metadata';
import { effectiveModel } from './catalog';
import { effectivePrompt } from './prompt';
import { ADAPTERS, AiError, type FetchLike } from './providers';

/** A stored picture: the doll, or a garment photo. */
export interface StoredPicture {
  bytes: Uint8Array;
  ext: 'webp' | 'jpg';
}

export interface LookResult {
  bytes: Uint8Array;
  mime: 'image/png' | 'image/jpeg' | 'image/webp';
  /** What made it, recorded with the saved look (PR 4). */
  model: string;
  prompt: string;
}

/** Image models take 10–60 s; past this the kid gets "try again later" and her try is kept. */
export const LOOK_TIMEOUT_MS = 90_000;
export const CHECK_TIMEOUT_MS = 20_000;
/** Far above a 1–2K picture; stops a broken answer from filling the phone's memory. */
export const MAX_RESULT_BYTES = 20 * 1024 * 1024;

const defaultFetch: FetchLike = (url, init) => fetch(url, init);

/**
 * Runs `work` with a signal that aborts on the caller's cancel or after `timeoutMs`,
 * and reports which of the two happened.
 */
async function withDeadline<T>(signal: AbortSignal | undefined, timeoutMs: number, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  // Cancelled before it started: don't call the provider at all.
  if (signal?.aborted) throw new AiError('cancelled');
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onCancel = () => controller.abort();
  signal?.addEventListener('abort', onCancel);
  try {
    return await work(controller.signal);
  } catch (err) {
    // An abort makes fetch (or reading the body) fail with a plain AbortError; say which abort it was.
    if (controller.signal.aborted && !(err instanceof AiError)) {
      throw new AiError(timedOut ? 'timeout' : 'cancelled');
    }
    throw err;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onCancel);
  }
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000; // String.fromCharCode takes a limited number of arguments
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Drops EXIF, GPS and other metadata (and checks the type) before a picture leaves the phone. */
function toCleanDataUrl(picture: StoredPicture): string {
  let clean: Uint8Array;
  try {
    clean = stripPhotoMetadata(picture.bytes, picture.ext);
  } catch (err) {
    throw new AiError('bad-photo', err instanceof Error ? err.message : String(err));
  }
  return `data:${picture.ext === 'webp' ? 'image/webp' : 'image/jpeg'};base64,${bytesToBase64(clean)}`;
}

/** The picture type from its first bytes; the provider's own label isn't trusted. */
export function sniffImage(bytes: Uint8Array): LookResult['mime'] | null {
  const at = (i: number, ...values: number[]) => values.every((v, k) => bytes[i + k] === v);
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
  if (at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'image/webp';
  return null;
}

export interface LookRequest {
  provider: AiProviderId;
  settings: AiSettings;
  apiKey: string;
  doll: StoredPicture;
  /** The shirt, or the layer when the outfit has one. */
  upper: StoredPicture;
  bottom: StoredPicture;
  signal?: AbortSignal;
  fetch?: FetchLike;
  timeoutMs?: number;
}

/**
 * Sends the doll and the two garments to the provider the parent picked and returns the
 * picture it made. Throws AiError with a reason the UI can explain.
 */
export async function requestLook(req: LookRequest): Promise<LookResult> {
  const model = effectiveModel(req.provider, req.settings.model);
  const prompt = effectivePrompt(req.settings.prompt);
  const images = { doll: toCleanDataUrl(req.doll), upper: toCleanDataUrl(req.upper), bottom: toCleanDataUrl(req.bottom) };
  const bytes = await withDeadline(req.signal, req.timeoutMs ?? LOOK_TIMEOUT_MS, (signal) =>
    ADAPTERS[req.provider].generateLook({ images, prompt, model, apiKey: req.apiKey, signal, fetch: req.fetch ?? defaultFetch }),
  );
  if (bytes.length > MAX_RESULT_BYTES) throw new AiError('bad-response', 'picture too large');
  const mime = sniffImage(bytes);
  if (!mime) throw new AiError('bad-response', 'not a picture');
  return { bytes, mime, model, prompt };
}

/** Checks the parent's key against the provider ("בדיקת חיבור"). Resolves with a note to show, if any. */
export function checkConnection(
  provider: AiProviderId,
  apiKey: string,
  options: { signal?: AbortSignal; fetch?: FetchLike; timeoutMs?: number } = {},
): Promise<string | null> {
  return withDeadline(options.signal, options.timeoutMs ?? CHECK_TIMEOUT_MS, (signal) =>
    ADAPTERS[provider].checkKey({ apiKey, signal, fetch: options.fetch ?? defaultFetch }),
  );
}
