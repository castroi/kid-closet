import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { requestLook } from '../ai/send';
import { AiError, type FetchLike } from '../ai/providers';
import { lookPartsFor, promptHash, type LookParts } from '../core/closet';
import type { Occasion } from '../core/model';
import { DOLL_MAX_SIDE, processImage, type ImageDeps } from '../image/processImage';
import { blobToBytes } from '../storage/fileStore';
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
  | { kind: 'waiting'; detached: boolean }
  | { kind: 'failed'; error: unknown };

export interface AiLookApi {
  deviceStorage: DeviceStorage;
  /** A provider and its key are set; otherwise the button isn't shown at all. */
  ready: boolean;
  usedThisMonth: number;
  jobs: Readonly<Record<string, LookJob>>;
  start(outfit: LookOutfit): void;
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
 * Runs AI look requests above the screens, so leaving the dress-up screen while one is
 * waiting doesn't lose a picture that is already being paid for.
 */
export function AiLookProvider({ deviceStorage, imageDeps, children, now = defaultNow, fetchFn = defaultFetch }: Props) {
  const { data, readImage, addLook } = useCloset();
  const [jobs, setJobs] = useState<Record<string, LookJob>>({});
  const [finished, setFinished] = useState<LookOutfit | null>(null);
  const [usageTick, setUsageTick] = useState(0);
  const visibleKey = useRef<string | null>(null);
  // The latest closet, read when a request starts (the button may outlive a render).
  const dataRef = useRef(data);
  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  const setJob = useCallback(
    (key: string, job: LookJob | null) =>
      setJobs((current) => {
        const next = { ...current };
        if (job) next[key] = job;
        else delete next[key];
        return next;
      }),
    [],
  );

  const count = useCallback(() => {
    recordUse(deviceStorage, now());
    setUsageTick((t) => t + 1);
  }, [deviceStorage, now]);

  const start = useCallback(
    (outfit: LookOutfit) => {
      const closet = dataRef.current;
      const parts = lookPartsFor(closet.doll.id, outfit);
      const key = lookKey(parts);
      setJobs((current) => (current[key]?.kind === 'waiting' ? current : { ...current, [key]: { kind: 'waiting', detached: false } }));

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
          const provider = closet.ai.provider;
          const apiKey = provider ? readApiKey(deviceStorage, provider) : null;
          if (!provider || !apiKey) throw new AiError('unauthorized', 'AI is not set up');
          const [doll, upper, bottom] = await Promise.all([readDoll(), itemImage(parts.upperId), itemImage(parts.bottomId)]);
          let result;
          try {
            result = await requestLook({ provider, settings: closet.ai, apiKey, doll, upper, bottom, fetch: fetchFn });
          } catch (err) {
            if (counts(err)) count();
            throw err;
          }
          count();
          const stored = await processImage(new Blob([result.bytes as BlobPart], { type: result.mime }), imageDeps, DOLL_MAX_SIDE);
          await addLook({ ...parts, provider, model: result.model, promptHash: promptHash(result.prompt) }, stored);
          setJob(key, null);
          if (visibleKey.current !== key) setFinished(outfit);
        } catch (error) {
          setJob(key, { kind: 'failed', error });
        }
      })();
    },
    [deviceStorage, fetchFn, imageDeps, readImage, addLook, count, setJob],
  );

  const api = useMemo<AiLookApi>(
    () => ({
      deviceStorage,
      ready: aiReady(data.ai, deviceStorage),
      usedThisMonth: readMonthlyUse(deviceStorage, now()),
      jobs,
      start,
      detach: (key) =>
        setJobs((current) => (current[key]?.kind === 'waiting' ? { ...current, [key]: { kind: 'waiting', detached: true } } : current)),
      setVisibleKey: (key) => {
        visibleKey.current = key;
      },
      finished,
      clearFinished: () => setFinished(null),
    }),
    // usageTick: re-read the count after each recorded use.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [deviceStorage, data.ai, usageTick, now, jobs, start, finished],
  );

  return <AiLookContext.Provider value={api}>{children}</AiLookContext.Provider>;
}
