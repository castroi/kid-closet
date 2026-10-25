import { addItem as addItemTo, parseCloset, removeItems } from '../core/closet';
import { emptyCloset, type ClosetData, type ColorGroup, type Item, type ItemType, type Occasion } from '../core/model';
import { blobToBytes, blobToText, type FileStore } from './fileStore';

/**
 * closet.json is written alternately to two files with an increasing
 * generation number. If the app is killed mid-write, the other file still
 * holds the previous complete version, and load() picks the newest valid one.
 */
export const CLOSET_FILES = ['closet-a.json', 'closet-b.json'] as const;
export const IMAGES_DIR = 'images';

interface Envelope {
  generation: number;
  savedAt: string;
  closet: ClosetData;
}

export interface NewItem {
  name: string;
  type: ItemType;
  colorGroup: ColorGroup;
  occasions: Occasion[];
}

export interface StoredImage {
  blob: Blob;
  ext: 'webp' | 'jpg';
}

export class ClosetCorruptedError extends Error {
  constructor() {
    super('The closet files exist but none of them could be read');
    this.name = 'ClosetCorruptedError';
  }
}

/** Thrown when another open copy of the app saved since this copy loaded the closet. */
export class ClosetChangedElsewhereError extends Error {
  constructor() {
    super('The closet was changed in another window');
    this.name = 'ClosetChangedElsewhereError';
  }
}

export type WriteLock = <T>(fn: () => Promise<T>) => Promise<T>;

/** How long to wait for another copy to release the lock (e.g. a suspended background tab). */
export const WRITE_LOCK_WAIT_MS = 15_000;

/**
 * A WriteLock shared by every tab of this site, or undefined where the phone has no
 * Web Locks. Waiting for it gives up after WRITE_LOCK_WAIT_MS (where the phone
 * supports AbortSignal.timeout), so the operation fails with an error the parent can
 * retry instead of hanging.
 */
export function webWriteLock(
  locks: Pick<LockManager, 'request'> | undefined,
  // null means "wait without a limit"; undefined would fall back to this default.
  timeoutSignal: ((ms: number) => AbortSignal) | null = typeof AbortSignal !== 'undefined' &&
  typeof AbortSignal.timeout === 'function'
    ? (ms) => AbortSignal.timeout(ms)
    : null,
): WriteLock | undefined {
  if (!locks) return undefined;
  return <T>(fn: () => Promise<T>) => {
    const options: LockOptions = timeoutSignal ? { signal: timeoutSignal(WRITE_LOCK_WAIT_MS) } : {};
    // request() resolves with what the callback's promise resolves to.
    return locks.request('kid-closet-write', options, () => fn()) as unknown as Promise<T>;
  };
}

export class ClosetRepository {
  private data: ClosetData = emptyCloset();
  private generation = 0;
  private queue: Promise<unknown> = Promise.resolve();

  /**
   * `writeLock` runs each whole operation (load, save, add, delete, backup read,
   * restore) exclusively across all open copies of the app; main.tsx passes one
   * built on the Web Locks API. Whole operations, not just the closet write, so one
   * copy's photo cleanup can't delete a photo another copy is in the middle of
   * adding. Without a lock (older Safari), saves are still checked against the disk.
   */
  constructor(
    private readonly store: FileStore,
    private readonly clock: () => string = () => new Date().toISOString(),
    private readonly newId: () => string = () => crypto.randomUUID(),
    private readonly writeLock: WriteLock = (fn) => fn(),
  ) {}

  getData(): ClosetData {
    return this.data;
  }

  /** Runs operations one at a time so writes never interleave. */
  private enqueue<T>(op: () => Promise<T>): Promise<T> {
    const run = this.queue.then(op, op);
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** One at a time in this copy, and exclusive across copies. The lock is not re-entrant: never nest. */
  private locked<T>(op: () => Promise<T>): Promise<T> {
    return this.enqueue(() => this.writeLock(op));
  }

  load(): Promise<ClosetData> {
    return this.locked(async () => {
      let best: Envelope | null = null;
      let foundAny = false;
      let highestSeen = 0;
      let foundUnreadable = false;
      for (const file of CLOSET_FILES) {
        const blob = await this.store.read(file);
        if (!blob) continue;
        foundAny = true;
        const { envelope, generation } = await readEnvelope(blob);
        highestSeen = Math.max(highestSeen, generation ?? 0);
        if (!envelope) foundUnreadable = true;
        if (envelope && (!best || envelope.generation > best.generation)) best = envelope;
      }
      // Always save above every generation on disk, even one we could not read
      // (e.g. written by a newer app version), so a later save is never outranked.
      this.generation = highestSeen;
      if (foundAny && !best) throw new ClosetCorruptedError();
      this.data = best ? best.closet : emptyCloset();
      // While any closet file is unreadable (damaged, or from a newer app version),
      // its photos are not in this.data; cleaning up would delete them for good.
      // Once saves have overwritten that file, a later load cleans up as usual.
      if (!foundUnreadable) await this.removeOrphanImages();
      return this.data;
    });
  }

  /** The highest generation in the closet files on disk, readable or not. */
  private async highestOnDisk(): Promise<number> {
    let highest = 0;
    for (const file of CLOSET_FILES) {
      const blob = await this.store.read(file);
      if (!blob) continue;
      const { generation } = await readEnvelope(blob);
      highest = Math.max(highest, generation ?? 0);
    }
    return highest;
  }

  /**
   * Saves `next` above every generation on disk. If another copy of the app (a
   * second tab) has saved since this one loaded, a normal save is refused rather
   * than silently overwriting that copy's changes; a restore (`replace`) goes
   * ahead, since it replaces the whole closet on purpose. Callers hold the lock.
   *
   * One harmless false alarm: if a write is reported as failed but did land (the
   * file worker timed out just as it finished), the next save sees its own
   * generation as newer and is refused as "changed elsewhere". The reload then
   * shows that saved closet, so nothing is lost; only the message is off.
   */
  private async persist(next: ClosetData, mode: 'change' | 'replace' = 'change'): Promise<ClosetData> {
    const onDisk = await this.highestOnDisk();
    if (onDisk > this.generation) {
      if (mode === 'change') throw new ClosetChangedElsewhereError();
      this.generation = onDisk;
    }
    const generation = this.generation + 1;
    const envelope: Envelope = { generation, savedAt: this.clock(), closet: next };
    const file = CLOSET_FILES[generation % 2];
    await this.store.write(file, new Blob([JSON.stringify(envelope)], { type: 'application/json' }));
    this.generation = generation;
    this.data = next;
    return next;
  }

  /** Applies a pure change to the closet and saves it. */
  update(change: (current: ClosetData) => ClosetData): Promise<ClosetData> {
    return this.locked(() => this.persist(change(this.data)));
  }

  addItem(input: NewItem, image: StoredImage): Promise<Item> {
    return this.locked(async () => {
      const id = this.newId();
      const path = `${IMAGES_DIR}/${id}.${image.ext}`;
      const now = this.clock();
      const item: Item = {
        id,
        name: input.name,
        type: input.type,
        colorGroup: input.colorGroup,
        occasions: [...input.occasions],
        status: 'active',
        image: path,
        createdAt: now,
        updatedAt: now,
      };
      // Photo first, then the list: a crash in between leaves only an orphan photo,
      // which the next load() removes.
      await this.store.write(path, image.blob);
      try {
        await this.persist(addItemTo(this.data, item));
      } catch (err) {
        await this.store.remove(path).catch(() => undefined);
        throw err;
      }
      return item;
    });
  }

  deleteItems(ids: string[]): Promise<ClosetData> {
    return this.locked(async () => {
      const set = new Set(ids);
      const paths = this.data.items.filter((it) => set.has(it.id)).map((it) => it.image);
      const next = await this.persist(removeItems(this.data, ids));
      for (const p of paths) await this.store.remove(p).catch(() => undefined);
      return next;
    });
  }

  readImage(path: string): Promise<Blob | null> {
    return this.store.read(path);
  }

  /**
   * The closet and the bytes of every item's photo, read in the queue so no save
   * can change them halfway. Bytes, not Blobs: a file Blob from the phone's storage
   * can become unreadable once the file is deleted.
   */
  snapshot(): Promise<{ data: ClosetData; images: Map<string, Uint8Array | null> }> {
    return this.locked(async () => {
      const data = this.data;
      const images = new Map<string, Uint8Array | null>();
      for (const item of data.items) {
        const blob = await this.store.read(item.image);
        images.set(item.image, blob ? await blobToBytes(blob) : null);
      }
      return { data, images };
    });
  }

  /** Replaces the whole closet (used by restore from backup). */
  replaceAll(next: ClosetData, images: Map<string, Blob>): Promise<ClosetData> {
    return this.locked(async () => {
      for (const item of next.items) {
        const blob = images.get(item.image);
        if (!blob) throw new Error(`Missing photo ${item.image}`);
        await this.store.write(item.image, blob);
      }
      const saved = await this.persist(next, 'replace');
      await this.removeOrphanImages();
      return saved;
    });
  }

  /** Best-effort: a cleanup failure must never fail the load or save that called it. */
  private async removeOrphanImages(): Promise<void> {
    const referenced = new Set(this.data.items.map((it) => it.image));
    let names: string[];
    try {
      names = await this.store.list(IMAGES_DIR);
    } catch {
      return;
    }
    for (const name of names) {
      const path = `${IMAGES_DIR}/${name}`;
      if (!referenced.has(path)) await this.store.remove(path).catch(() => undefined);
    }
  }
}

async function readEnvelope(blob: Blob): Promise<{ envelope: Envelope | null; generation: number | null }> {
  let raw: Partial<Envelope>;
  try {
    raw = JSON.parse(await blobToText(blob)) as Partial<Envelope>;
  } catch {
    return { envelope: null, generation: null };
  }
  const generation =
    typeof raw?.generation === 'number' && Number.isInteger(raw.generation) && raw.generation >= 1 ? raw.generation : null;
  if (generation === null) return { envelope: null, generation: null };
  try {
    return { envelope: { generation, savedAt: String(raw.savedAt), closet: parseCloset(raw.closet) }, generation };
  } catch {
    return { envelope: null, generation };
  }
}
