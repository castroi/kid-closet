import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { requestLook, type LookResult } from '../ai/send';
import { AiError, type FetchLike } from '../ai/providers';
import { findLook, lookPartsFor, promptHash, type LookParts } from '../core/closet';
import type { Occasion } from '../core/model';
import { stripPhotoMetadata } from '../image/metadata';
import { DOLL_MAX_SIDE, processImage, type ImageDeps } from '../image/processImage';
import { blobToBytes } from '../storage/fileStore';
import type { StoredImage } from '../storage/repository';
import { aiReady, readApiKey, readMonthlyUse, recordUse, type DeviceStorage } from './aiDevice';
import { useCloset } from './ClosetContext';
import { DEFAULT_DOLL_URL } from './doll';

/** The outfit a look was asked for, so "לראות" can open it again. */
export interface LookOutfit {
  occasion: Occasion;
  layerId: string | null;
  topId: string;
  bottomId: string;
}

export type LookJob =
  /** `detached`: she pressed "ביטול"; the request goes on, only the waiting screen is gone. */
  | { kind: 'waiting'; detached: boolean; counted?: boolean }
  | { kind: 'failed'; error: unknown };

export interface StartOptions {
  /** The parent's "ליצור מחדש": replace a look that exists. */
  redo?: boolean;
  /** No "הבובה מוכנה" toast (the parent watches the result where she asked for it). */
  quiet?: boolean;
}

/** Why start() didn't send anything. */
export type StartRefusal = 'not-ready' | 'busy' | 'exists' | 'cap';

export interface AiLookApi {
  deviceStorage: DeviceStorage;
  /** A provider and its key are set; otherwise the button isn't shown at all. Read live: the key lives outside React. */
  isReady(): boolean;
  /** Pictures counted this month, plus requests still running (they will probably count). */
  monthlyUse(): number;
  /** Changes after each counted use, so screens that show the count render again. */
  usageVersion: number;
  jobs: Readonly<Record<string, LookJob>>;
  /**
   * The only way to ask for a look. Sends nothing when AI isn't set up, a request for this look is
   * already running, a look already exists (unless `redo`, for the parent in PR 5), or the cap is reached.
   */
  start(outfit: LookOutfit, options?: StartOptions): StartRefusal | null;
  detach(key: string): void;
  /** The look on screen right now, so a finished one only gets a toast when she isn't looking at it. */
  setVisibleKey(key: string | null): void;
  /** A look that finished while she was elsewhere; App shows "הבובה מוכנה · לראות". */
  finished: LookOutfit | null;
  clearFinished(): void;
}

export function lookKey(parts: LookParts): string {
  return `${parts.dollId}|${parts.upperId}|${parts.bottomId}`;
}

/** Plan §8: a call counts when it reached the provider and may cost money. */
function counts(err: unknown): boolean {
  return err instanceof AiError && ['timeout', 'refused', 'provider-down', 'bad-response'].includes(err.reason);
}

/** How long "הבובה מוכנה" stays when she doesn't tap it. */
export const FINISHED_TOAST_MS = 10_000;

const AiLookContext = createContext<AiLookApi | null>(null);

export function useAiLooks(): AiLookApi {
  const api = useContext(AiLookContext);
  if (!api) throw new Error('useAiLooks must be used inside AiLookProvider');
  return api;
}

const defaultFetch: FetchLike = (url, init) => fetch(url, init);
const defaultNow = () => new Date();

interface Props {
  deviceStorage: DeviceStorage;
  imageDeps: ImageDeps;
  children: ReactNode;
  now?: () => Date;
  /** Only for tests; the app uses the browser's fetch (provider calls and the bundled doll). */
  fetchFn?: FetchLike;
}

/**
 * Makes the stored picture from the provider's answer: resized to ≤1024 px WebP. If the phone
 * can't decode it, a WebP or JPEG answer is kept as it came (without metadata), so a paid picture
 * isn't lost; only a PNG that can't be decoded is.
 */
async function storedPicture(result: LookResult, imageDeps: ImageDeps): Promise<StoredImage> {
  try {
    return await processImage(new Blob([result.bytes as BlobPart], { type: result.mime }), imageDeps, DOLL_MAX_SIDE);
  } catch (err) {
    if (result.mime === 'image/png') throw err;
    const ext = result.mime === 'image/webp' ? 'webp' : 'jpg';
    const clean = stripPhotoMetadata(result.bytes, ext);
    return { blob: new Blob([clean as BlobPart], { type: result.mime }), ext };
  }
}

/**
 * Runs AI look requests above the screens, so leaving the dress-up screen while one is
 * waiting doesn't lose a picture that is already being paid for.
 */
export function AiLookProvider({ deviceStorage, imageDeps, children, now = defaultNow, fetchFn = defaultFetch }: Props) {
  const { data, readImage, addLook } = useCloset();
  const [jobs, setJobs] = useState<Record<string, LookJob>>({});
  const [finished, setFinished] = useState<{ key: string; outfit: LookOutfit } | null>(null);
  // Bumped after each counted use, so screens re-read the count.
  const [usageVersion, setUsageVersion] = useState(0);
  const visibleKey = useRef<string | null>(null);
  // The latest closet and jobs, read when a request starts or ends (they outlive a render).
  const dataRef = useRef(data);
  const jobsRef = useRef(jobs);
  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  const setJob = useCallback((key: string, job: LookJob | null) => {
    const next = { ...jobsRef.current };
    if (job) next[key] = job;
    else delete next[key];
    jobsRef.current = next;
    setJobs(next);
  }, []);

  // Requests not yet counted in this month's use; one whose answer arrived is counted there instead.
  const running = useCallback(
    () => Object.values(jobsRef.current).filter((j) => j.kind === 'waiting' && !j.counted).length,
    [],
  );

  const monthlyUse = useCallback(() => readMonthlyUse(deviceStorage, now()) + running(), [deviceStorage, now, running]);

  const count = useCallback(() => {
    recordUse(deviceStorage, now());
    setUsageVersion((v) => v + 1);
  }, [deviceStorage, now]);

  // The toast goes away by itself after a while.
  useEffect(() => {
    if (!finished) return;
    const timer = setTimeout(() => setFinished(null), FINISHED_TOAST_MS);
    return () => clearTimeout(timer);
  }, [finished]);

  const start = useCallback(
    (outfit: LookOutfit, options: StartOptions = {}): StartRefusal | null => {
      const closet = dataRef.current;
      const parts = lookPartsFor(closet.doll.id, outfit);
      const key = lookKey(parts);
      const provider = closet.ai.provider;
      const apiKey = provider ? readApiKey(deviceStorage, provider) : null;
      if (!provider || !apiKey) return 'not-ready';
      if (jobsRef.current[key]?.kind === 'waiting') return 'busy';
      if (!options.redo && findLook(closet, parts)) return 'exists';
      // Requests still running count too, so two looks at once can't go past the cap.
      if (monthlyUse() >= closet.ai.monthlyCap) return 'cap';
      setJob(key, { kind: 'waiting', detached: false });

      const readPicture = async (path: string) => {
        const blob = await readImage(path);
        if (!blob) throw new AiError('bad-photo', `${path} is missing`);
        return { bytes: await blobToBytes(blob), ext: path.endsWith('.jpg') ? ('jpg' as const) : ('webp' as const) };
      };
      const readDoll = async () => {
        if (closet.doll.image) return readPicture(closet.doll.image);
        const response = await fetchFn(DEFAULT_DOLL_URL, {});
        if (!response.ok) throw new AiError('bad-photo', 'the bundled doll is missing');
        return { bytes: new Uint8Array(await response.arrayBuffer()), ext: 'webp' as const };
      };
      const itemImage = (id: string) => {
        const item = closet.items.find((it) => it.id === id);
        if (!item) throw new AiError('bad-photo', 'the garment is gone');
        return readPicture(item.image);
      };

      void (async () => {
        try {
          const [doll, upper, bottom] = await Promise.all([readDoll(), itemImage(parts.upperId), itemImage(parts.bottomId)]);
          let result: LookResult;
          try {
            result = await requestLook({ provider, settings: closet.ai, apiKey, doll, upper, bottom, fetch: fetchFn });
          } catch (err) {
            if (counts(err)) count();
            throw err;
          }
          count();
          const current = jobsRef.current[key];
          if (current?.kind === 'waiting') setJob(key, { ...current, counted: true });
          const stored = await storedPicture(result, imageDeps);
          // A garment deleted while the AI worked: its look would be dropped on the next load anyway.
          const latest = dataRef.current;
          const kept = latest.items.some((it) => it.id === parts.upperId) && latest.items.some((it) => it.id === parts.bottomId);
          if (kept) await addLook({ ...parts, provider, model: result.model, promptHash: promptHash(result.prompt) }, stored);
          setJob(key, null);
          if (kept && !options.quiet && visibleKey.current !== key) setFinished({ key, outfit });
        } catch (error) {
          setJob(key, { kind: 'failed', error });
        }
      })();
      return null;
    },
    [deviceStorage, fetchFn, imageDeps, readImage, addLook, count, setJob, monthlyUse],
  );

  const api = useMemo<AiLookApi>(
    () => ({
      deviceStorage,
      isReady: () => aiReady(data.ai, deviceStorage),
      monthlyUse,
      usageVersion,
      jobs,
      start,
      detach: (key) => {
        const job = jobsRef.current[key];
        if (job?.kind === 'waiting') setJob(key, { ...job, detached: true });
      },
      setVisibleKey: (key) => {
        visibleKey.current = key;
        // She opened the look herself: the toast has nothing left to say.
        if (key !== null) setFinished((f) => (f?.key === key ? null : f));
      },
      finished: finished?.outfit ?? null,
      clearFinished: () => setFinished(null),
    }),
    [deviceStorage, monthlyUse, usageVersion, jobs, start, setJob, finished, data.ai],
  );

  return <AiLookContext.Provider value={api}>{children}</AiLookContext.Provider>;
}
