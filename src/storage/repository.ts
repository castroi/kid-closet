import {
  addItem as addItemTo,
  closetImagePaths,
  parseCloset,
  putLook,
  removeItems,
  removeLooks as removeLooksFrom,
  replaceItemPhoto,
  storedImagePaths,
} from '../core/closet';
import {
  defaultDoll,
  dollImagePath,
  emptyCloset,
  itemImagePath,
  lookImagePath,
  type AiLook,
  type ClosetData,
  type ColorGroup,
  type Doll,
  type Item,
  type ItemType,
  type Occasion,
} from '../core/model';
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
        photoRevision: 0,
        analysis: null,
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

  /** Deletes items, their photos, and the AI looks (with their pictures) that used them. */
  deleteItems(ids: string[]): Promise<ClosetData> {
    return this.locked(async () => {
      const before = storedImagePaths(this.data);
      const next = await this.persist(removeItems(this.data, ids));
      const kept = new Set(storedImagePaths(next));
      for (const p of before) if (!kept.has(p)) await this.store.remove(p).catch(() => undefined);
      return next;
    });
  }

  /** Deletes AI looks and their pictures (the parent's "למחוק את התמונה" and "מחיקת כל תמונות ה־AI"). */
  deleteLooks(ids: string[]): Promise<ClosetData> {
    return this.locked(async () => {
      const before = storedImagePaths(this.data);
      const next = await this.persist(removeLooksFrom(this.data, ids));
      const kept = new Set(storedImagePaths(next));
      for (const p of before) if (!kept.has(p)) await this.store.remove(p).catch(() => undefined);
      return next;
    });
  }

  /**
   * Saves a picture the AI made for a look. Replaces an older look for the same parts
   * (the parent's redo), deleting its picture after the save.
   */
  addLook(input: Omit<AiLook, 'id' | 'image' | 'createdAt' | 'flagged'>, image: StoredImage): Promise<AiLook> {
    return this.locked(async () => {
      const id = this.newId();
      const look: AiLook = { ...input, id, image: lookImagePath(id, image.ext), flagged: false, createdAt: this.clock() };
      // Picture first, then the list, as in addItem: a crash in between leaves only an orphan.
      await this.store.write(look.image, image.blob);
      const before = storedImagePaths(this.data);
      let next: ClosetData;
      try {
        next = await this.persist(putLook(this.data, look));
      } catch (err) {
        // As in setDoll: remove it only when nothing was written; a reported failure may have landed.
        if (err instanceof ClosetChangedElsewhereError) await this.store.remove(look.image).catch(() => undefined);
        throw err;
      }
      const kept = new Set(storedImagePaths(next));
      for (const p of before) if (!kept.has(p)) await this.store.remove(p).catch(() => undefined);
      return look;
    });
  }

  /**
   * Gives an item a new photo and returns the updated item. The new photo is always a new file
   * (`images/<id>-r<n>.<ext>`), never an overwrite: the file first, then the list, then the old
   * file, as for the doll. A crash or a failed write leaves the old photo in use and at worst an
   * orphan, which the next load removes; an old analysis is never kept on a new photo.
   */
  replacePhoto(id: string, image: StoredImage): Promise<Item> {
    return this.locked(async () => {
      const item = this.data.items.find((it) => it.id === id);
      if (!item) throw new Error(`Item ${id} not found`);
      const path = itemImagePath(id, item.photoRevision + 1, image.ext);
      const next = replaceItemPhoto(this.data, id, path, this.clock());
      await this.store.write(path, image.blob);
      let saved: ClosetData;
      try {
        saved = await this.persist(next);
      } catch (err) {
        // As in setDoll: remove it only when nothing was written; a reported failure may have landed.
        if (err instanceof ClosetChangedElsewhereError) await this.store.remove(path).catch(() => undefined);
        throw err;
      }
      await this.store.remove(item.image).catch(() => undefined);
      return saved.items.find((it) => it.id === id)!;
    });
  }

  /** Replaces the doll with the parent's picture. The previous picture, if any, is deleted after the save. */
  setDoll(image: StoredImage): Promise<ClosetData> {
    return this.locked(async () => {
      const id = this.newId();
      const path = dollImagePath(id, image.ext);
      // Picture first, then the list, as in addItem: a crash in between leaves only an orphan.
      await this.store.write(path, image.blob);
      try {
        return await this.changeDoll({ id, image: path });
      } catch (err) {
        // Remove the picture only when nothing was written. Any other failure may be a save that
        // landed (see persist), and the closet on disk would then point at a deleted picture; if it
        // didn't land, the next load's orphan cleanup removes the picture.
        if (err instanceof ClosetChangedElsewhereError) await this.store.remove(path).catch(() => undefined);
        throw err;
      }
    });
  }

  /** Goes back to the doll bundled with the app, deleting the parent's picture after the save. */
  resetDoll(): Promise<ClosetData> {
    return this.locked(() => this.changeDoll(defaultDoll()));
  }

  /** Callers hold the lock. */
  private async changeDoll(doll: Doll): Promise<ClosetData> {
    const old = this.data.doll.image;
    const next = await this.persist({ ...this.data, doll });
    if (old && old !== doll.image) await this.store.remove(old).catch(() => undefined);
    return next;
  }

  readImage(path: string): Promise<Blob | null> {
    return this.store.read(path);
  }

  /**
   * The closet and the bytes of every photo it uses (items and doll), plus the AI looks `chooseLooks`
   * picks from their file sizes (null: the picture is lost), read in the queue so no save can change
   * them halfway. Only the chosen looks are read, so leaving looks out also saves the phone's memory.
   * Bytes, not Blobs: a file Blob from the phone's storage can become unreadable once the file is deleted.
   */
  snapshot(
    chooseLooks: (data: ClosetData, sizes: ReadonlyMap<string, number | null>) => ReadonlySet<string> = (d) =>
      new Set(d.aiLooks.map((l) => l.id)),
  ): Promise<{ data: ClosetData; images: Map<string, Uint8Array | null> }> {
    return this.locked(async () => {
      const data = this.data;
      // Getting a file is cheap; its contents are read only when needed.
      const files = new Map<string, Blob | null>();
      for (const path of storedImagePaths(data)) files.set(path, await this.store.read(path));
      const sizes = new Map([...files].map(([path, blob]) => [path, blob ? blob.size : null]));
      const chosen = chooseLooks(data, sizes);
      const images = new Map<string, Uint8Array | null>();
      for (const path of closetImagePaths(data)) {
        const blob = files.get(path);
        images.set(path, blob ? await blobToBytes(blob) : null);
      }
      for (const look of data.aiLooks) {
        const blob = files.get(look.image);
        if (chosen.has(look.id) && blob) images.set(look.image, await blobToBytes(blob));
      }
      return { data, images };
    });
  }

  /** Replaces the whole closet (used by restore from backup). */
  replaceAll(next: ClosetData, images: Map<string, Blob>): Promise<ClosetData> {
    return this.locked(async () => {
      for (const path of storedImagePaths(next)) {
        const blob = images.get(path);
        if (!blob) throw new Error(`Missing photo ${path}`);
        await this.store.write(path, blob);
      }
      const saved = await this.persist(next, 'replace');
      await this.removeOrphanImages();
      return saved;
    });
  }

  /** Best-effort: a cleanup failure must never fail the load or save that called it. */
  private async removeOrphanImages(): Promise<void> {
    const referenced = new Set(storedImagePaths(this.data));
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
