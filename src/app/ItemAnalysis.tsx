import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AiError, countsTowardCap, type FetchLike } from '../ai/providers';
import { requestAttributes, type AttributesResponse } from '../ai/send';
import { isAnalysed, itemsToAnalyse } from '../core/closet';
import type { Item } from '../core/model';
import { blobToBytes } from '../storage/fileStore';
import { analysisReady, readAnalysisUse, readApiKey, recordAnalysisUse, type DeviceStorage } from './aiDevice';
import { useCloset } from './ClosetContext';

/**
 * Sends garment photos to the AI one at a time, above the screens, so leaving a screen never
 * loses a paid call (docs/ai-item-attributes.md §7). Separate from the doll looks, so an
 * analysis never delays a doll she is waiting for.
 */

/** Where a request came from: decides what is skipped and who sees a failure. */
export type AnalysisSource = 'new' | 'kid' | 'bulk';

/** `source` on a failure: only her own resend shows her an error (docs/ai-item-attributes.md §7). */
export type AnalysisJob = { kind: 'queued' } | { kind: 'waiting' } | { kind: 'failed'; error: unknown; source: AnalysisSource };

/** Why nothing was queued. */
export type AnalyseRefusal = 'not-ready' | 'busy' | 'done' | 'cap';

/** The parent's "send all": progress, and what went wrong, for the summary. */
export interface BulkRun {
  total: number;
  /** Answered: stored, or found not to be a single garment. */
  analysed: number;
  /** Deleted, or analysed by another request, before its turn: nothing sent. */
  skipped: number;
  failed: { id: string; error: unknown }[];
  running: boolean;
  /** "עצירה" was pressed: the current item finishes, nothing new starts. */
  stopping: boolean;
  /**
   * Why the run ended early: an AiError every item would hit (key, credit, rate, offline),
   * AnalysisCapReached, or 'off' when the parent turned analysis off.
   */
  stoppedBy: unknown;
}

export interface ItemAnalysisApi {
  /** AI is set up and the parent turned analysis on. Read live: the key lives outside React. */
  isReady(): boolean;
  /** Analyses counted this month on this phone (never the dolls'). */
  monthlyUse(): number;
  /** Changes after each counted use, so screens that show the count render again. */
  usageVersion: number;
  jobs: Readonly<Record<string, AnalysisJob>>;
  /**
   * Queues one item. 'new' (after she adds it) and 'bulk' skip an item that has an analysis of
   * its current photo; 'kid' (her resend) skips only one the AI already described.
   * `item` is the item just saved, for a call made before the screen has the new closet.
   */
  analyse(id: string, source: AnalysisSource, item?: Item): AnalyseRefusal | null;
  bulk: BulkRun | null;
  startBulk(): AnalyseRefusal | null;
  stopBulk(): void;
  clearBulk(): void;
  /** Counts one analysis made elsewhere ("בדיקת זיהוי"). */
  countUse(): void;
}

const ItemAnalysisContext = createContext<ItemAnalysisApi | null>(null);

export function useItemAnalysis(): ItemAnalysisApi {
  const api = useContext(ItemAnalysisContext);
  if (!api) throw new Error('useItemAnalysis must be used inside ItemAnalysisProvider');
  return api;
}

/** A failure every later item would hit too, so a bulk run stops at once (no answer at all, e.g. CORS, included). */
function stopsTheRun(err: unknown): boolean {
  return err instanceof AiError && ['unauthorized', 'no-credit', 'rate-limited', 'network'].includes(err.reason);
}

/** No answer at all: worth trying again by itself once the phone is (back) online. */
function noAnswer(err: unknown): boolean {
  return err instanceof AiError && err.reason === 'network';
}

/** The cap was reached while items were waiting. */
export class AnalysisCapReached extends Error {
  constructor() {
    super('analysis cap reached');
    this.name = 'AnalysisCapReached';
  }
}

/**
 * The item to judge and send: the closet's copy, unless the caller handed one with a newer photo
 * (just added, or a replaced photo) that the closet on screen doesn't show yet.
 */
function freshest(found: Item | undefined, given: Item | undefined): Item | undefined {
  if (!found) return given;
  return given && given.photoRevision > found.photoRevision ? given : found;
}

const defaultFetch: FetchLike = (url, init) => fetch(url, init);
const defaultNow = () => new Date();
const defaultOnline = () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false);

interface Props {
  deviceStorage: DeviceStorage;
  children: ReactNode;
  now?: () => Date;
  /** Only for tests; the app asks the browser. */
  isOnline?: () => boolean;
  /** Only for tests; the app uses the browser's fetch. */
  fetchFn?: FetchLike;
}

interface Queued {
  id: string;
  source: AnalysisSource;
  /** The item as it was saved, when the closet on screen doesn't have it yet. */
  item?: Item;
}

export function ItemAnalysisProvider({ deviceStorage, children, now = defaultNow, isOnline = defaultOnline, fetchFn = defaultFetch }: Props) {
  const { data, readImage, setItemAnalysis } = useCloset();
  const [jobs, setJobs] = useState<Record<string, AnalysisJob>>({});
  const [bulk, setBulkState] = useState<BulkRun | null>(null);
  const [usageVersion, setUsageVersion] = useState(0);
  // The latest closet, jobs and run, read while the queue works (they outlive a render).
  const dataRef = useRef(data);
  const jobsRef = useRef(jobs);
  const bulkRef = useRef<BulkRun | null>(bulk);
  const queue = useRef<Queued[]>([]);
  const working = useRef(false);
  /** Items of this session that waited for the internet; sent again on the "online" event. */
  const offline = useRef<Map<string, AnalysisSource>>(new Map());
  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  const setJob = useCallback((id: string, job: AnalysisJob | null) => {
    const next = { ...jobsRef.current };
    if (job) next[id] = job;
    else delete next[id];
    jobsRef.current = next;
    setJobs(next);
  }, []);

  const setBulk = useCallback((run: BulkRun | null) => {
    bulkRef.current = run;
    setBulkState(run);
  }, []);

  const monthlyUse = useCallback(() => readAnalysisUse(deviceStorage, now()), [deviceStorage, now]);

  const countUse = useCallback(() => {
    recordAnalysisUse(deviceStorage, now());
    setUsageVersion((v) => v + 1);
  }, [deviceStorage, now]);

  /** Whether this item still needs sending for this source. */
  const needs = useCallback((item: Item, source: AnalysisSource) => {
    if (source === 'kid') return !(item.analysis?.result === 'ok' && isAnalysed(item));
    return !isAnalysed(item);
  }, []);

  const finishBulkItem = useCallback(
    (id: string, outcome: 'analysed' | 'skipped' | { error: unknown }, stop?: unknown) => {
      const run = bulkRef.current;
      if (!run?.running) return;
      const next: BulkRun =
        outcome === 'analysed'
          ? { ...run, analysed: run.analysed + 1 }
          : outcome === 'skipped'
            ? { ...run, skipped: run.skipped + 1 }
            : { ...run, failed: [...run.failed, { id, error: outcome.error }] };
      if (stop !== undefined) {
        // Every later item would fail the same way: drop them, and keep why, even after the last item.
        const dropped = queue.current.filter((q) => q.source === 'bulk');
        queue.current = queue.current.filter((q) => q.source !== 'bulk');
        for (const q of dropped) setJob(q.id, null);
        setBulk({ ...next, running: false, stopping: false, stoppedBy: stop });
        return;
      }
      const left = queue.current.some((q) => q.source === 'bulk');
      setBulk(left ? next : { ...next, running: false, stopping: false });
    },
    [setBulk, setJob],
  );

  /** Ends a bulk run early: nothing new starts, and why is kept for the summary. */
  const endBulk = useCallback(
    (reason: unknown) => {
      const dropped = queue.current.filter((q) => q.source === 'bulk');
      queue.current = queue.current.filter((q) => q.source !== 'bulk');
      for (const q of dropped) setJob(q.id, null);
      const run = bulkRef.current;
      if (run?.running) setBulk({ ...run, running: false, stopping: false, stoppedBy: reason });
    },
    [setBulk, setJob],
  );

  const work = useCallback(async () => {
    if (working.current) return;
    working.current = true;
    try {
      for (let next = queue.current.shift(); next; next = queue.current.shift()) {
        const { id, source } = next;
        const closet = dataRef.current;
        const item = freshest(closet.items.find((it) => it.id === id), next.item);
        const provider = closet.ai.provider;
        const apiKey = provider ? readApiKey(deviceStorage, provider) : null;
        // Everything is checked again here: settings, the cap or the item may have changed while it waited.
        if (!provider || !apiKey || !analysisReady(closet.ai, deviceStorage)) {
          setJob(id, null);
          if (source === 'bulk') endBulk('off');
          continue;
        }
        if (!item || !needs(item, source)) {
          setJob(id, null);
          if (source === 'bulk') finishBulkItem(id, 'skipped');
          continue;
        }
        if (monthlyUse() >= closet.ai.analysis.monthlyCap) {
          setJob(id, source === 'kid' ? { kind: 'failed', error: new AnalysisCapReached(), source } : null);
          if (source === 'bulk') endBulk(new AnalysisCapReached());
          continue;
        }
        if (!isOnline()) {
          // Costs nothing to try again later: her items go out on the "online" event; the parent restarts a run.
          if (source === 'bulk') {
            setJob(id, null);
            endBulk(new AiError('network', 'offline'));
          } else {
            offline.current.set(id, source);
            setJob(id, { kind: 'failed', error: new AiError('network', 'offline'), source });
          }
          continue;
        }
        setJob(id, { kind: 'waiting' });
        try {
          const blob = await readImage(item.image);
          if (!blob) throw new AiError('bad-photo', `${item.image} is missing`);
          const photo = { bytes: await blobToBytes(blob), ext: item.image.endsWith('.jpg') ? ('jpg' as const) : ('webp' as const) };
          let response: AttributesResponse;
          try {
            response = await requestAttributes({ provider, settings: closet.ai, apiKey, photo, fetch: fetchFn });
          } catch (err) {
            if (countsTowardCap(err)) countUse();
            throw err;
          }
          countUse();
          // setItemAnalysis drops it when the item was deleted or its photo replaced meanwhile.
          await setItemAnalysis(id, {
            ...response.analysis,
            photoRevision: item.photoRevision,
            provider,
            model: response.model,
            promptVersion: response.promptVersion,
            analyzedAt: now().toISOString(),
          });
          setJob(id, null);
          if (source === 'bulk') finishBulkItem(id, 'analysed');
        } catch (error) {
          setJob(id, { kind: 'failed', error, source });
          if (source === 'bulk') finishBulkItem(id, { error }, stopsTheRun(error) ? error : undefined);
          // No answer at all costs nothing: her items go out again when the phone is back online.
          else if (noAnswer(error)) offline.current.set(id, source);
        }
        if (bulkRef.current?.stopping && !queue.current.some((q) => q.source === 'bulk')) {
          setBulk({ ...bulkRef.current, running: false, stopping: false });
        }
      }
    } finally {
      working.current = false;
    }
  }, [deviceStorage, fetchFn, isOnline, monthlyUse, needs, readImage, setItemAnalysis, setJob, countUse, finishBulkItem, endBulk, setBulk, now]);

  const enqueue = useCallback(
    (id: string, source: AnalysisSource, item?: Item) => {
      if (queue.current.some((q) => q.id === id) || jobsRef.current[id]?.kind === 'waiting') return;
      // Her own requests go ahead of a running bulk run, so she never waits behind the whole closet.
      const firstBulk = queue.current.findIndex((q) => q.source === 'bulk');
      if (source !== 'bulk' && firstBulk >= 0) queue.current.splice(firstBulk, 0, { id, source, item });
      else queue.current.push({ id, source, item });
      setJob(id, { kind: 'queued' });
      void work();
    },
    [setJob, work],
  );

  const analyse = useCallback(
    (id: string, source: AnalysisSource, saved?: Item): AnalyseRefusal | null => {
      const closet = dataRef.current;
      if (!analysisReady(closet.ai, deviceStorage)) return 'not-ready';
      const job = jobsRef.current[id];
      if (job && job.kind !== 'failed') return 'busy';
      const item = freshest(closet.items.find((it) => it.id === id), saved);
      if (!item || !needs(item, source)) return 'done';
      if (monthlyUse() >= closet.ai.analysis.monthlyCap) return 'cap';
      enqueue(id, source, item);
      return null;
    },
    [deviceStorage, enqueue, monthlyUse, needs],
  );

  const startBulk = useCallback((): AnalyseRefusal | null => {
    const closet = dataRef.current;
    if (!analysisReady(closet.ai, deviceStorage)) return 'not-ready';
    if (bulkRef.current?.running) return 'busy';
    // Her own requests, waiting or queued, keep their place and aren't part of the run.
    const items = itemsToAnalyse(closet.items).filter(
      (it) => jobsRef.current[it.id]?.kind !== 'waiting' && !queue.current.some((q) => q.id === it.id),
    );
    if (items.length === 0) return 'done';
    if (monthlyUse() >= closet.ai.analysis.monthlyCap) return 'cap';
    setBulk({ total: items.length, analysed: 0, skipped: 0, failed: [], running: true, stopping: false, stoppedBy: null });
    for (const it of items) {
      queue.current.push({ id: it.id, source: 'bulk' });
      setJob(it.id, { kind: 'queued' });
    }
    void work();
    return null;
  }, [deviceStorage, monthlyUse, setBulk, setJob, work]);

  const stopBulk = useCallback(() => {
    const run = bulkRef.current;
    if (!run?.running) return;
    const dropped = queue.current.filter((q) => q.source === 'bulk');
    queue.current = queue.current.filter((q) => q.source !== 'bulk');
    for (const q of dropped) setJob(q.id, null);
    const inFlight = Object.values(jobsRef.current).some((j) => j.kind === 'waiting');
    // The item being sent finishes and is saved; then the run ends.
    setBulk(inFlight ? { ...run, stopping: true } : { ...run, running: false });
  }, [setBulk, setJob]);

  // Items that waited for the internet go out again when it is back.
  useEffect(() => {
    const onOnline = () => {
      const waiting = [...offline.current.entries()];
      offline.current.clear();
      for (const [id, source] of waiting) {
        if (source !== 'bulk') analyse(id, source);
      }
    };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [analyse]);

  const api = useMemo<ItemAnalysisApi>(
    () => ({
      isReady: () => analysisReady(data.ai, deviceStorage),
      monthlyUse,
      usageVersion,
      jobs,
      analyse,
      bulk,
      startBulk,
      stopBulk,
      clearBulk: () => setBulk(null),
      countUse,
    }),
    [data.ai, deviceStorage, monthlyUse, usageVersion, jobs, analyse, bulk, startBulk, stopBulk, setBulk, countUse],
  );

  return <ItemAnalysisContext.Provider value={api}>{children}</ItemAnalysisContext.Provider>;
}
