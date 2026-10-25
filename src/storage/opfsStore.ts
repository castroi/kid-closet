import { blobToBytes, splitPath, type FileStore } from './fileStore';

/* Minimal structural types so we don't depend on which DOM lib version TypeScript ships. */
export interface WritableLike {
  write(data: Blob): Promise<void>;
  close(): Promise<void>;
}
export interface FileHandleLike {
  getFile(): Promise<Blob>;
  createWritable?: () => Promise<WritableLike>;
}
export interface DirHandleLike {
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<DirHandleLike>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileHandleLike>;
  removeEntry(name: string): Promise<void>;
  keys(): AsyncIterable<string>;
}

/** Writes a file from a worker (Safari only allows writing OPFS files via a sync handle in a worker). */
export type WorkerWriter = (path: string, bytes: Uint8Array) => Promise<void>;

function isNotFound(err: unknown): boolean {
  return err instanceof DOMException ? err.name === 'NotFoundError' : (err as { name?: string })?.name === 'NotFoundError';
}

export class OpfsFileStore implements FileStore {
  constructor(
    private readonly getRoot: () => Promise<DirHandleLike>,
    private readonly workerWrite: WorkerWriter,
  ) {}

  private async dirFor(dir: string | null, create: boolean): Promise<DirHandleLike | null> {
    const root = await this.getRoot();
    if (dir === null) return root;
    try {
      return await root.getDirectoryHandle(dir, { create });
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async read(path: string): Promise<Blob | null> {
    const { dir, name } = splitPath(path);
    const folder = await this.dirFor(dir, false);
    if (!folder) return null;
    try {
      const handle = await folder.getFileHandle(name);
      return await handle.getFile();
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async write(path: string, data: Blob): Promise<void> {
    const { dir, name } = splitPath(path);
    const folder = await this.dirFor(dir, true);
    if (!folder) throw new Error(`Cannot create folder for ${path}`);
    const handle = await folder.getFileHandle(name, { create: true });
    if (typeof handle.createWritable === 'function') {
      const writable = await handle.createWritable();
      await writable.write(data);
      await writable.close();
      return;
    }
    await this.workerWrite(path, await blobToBytes(data));
  }

  async remove(path: string): Promise<void> {
    const { dir, name } = splitPath(path);
    const folder = await this.dirFor(dir, false);
    if (!folder) return;
    try {
      await folder.removeEntry(name);
    } catch (err) {
      if (!isNotFound(err)) throw err;
    }
  }

  async list(dir: string): Promise<string[]> {
    const folder = await this.dirFor(dir, false);
    if (!folder) return [];
    const names: string[] = [];
    for await (const name of folder.keys()) names.push(name);
    return names;
  }
}

interface WorkerReply {
  id: number;
  ok: boolean;
  error?: string;
}

export type WorkerLike = Pick<Worker, 'postMessage' | 'addEventListener' | 'terminate'>;

/** How long one write may take before the worker is treated as stuck. */
export const WORKER_WRITE_TIMEOUT_MS = 30_000;

interface WorkerSession {
  worker: WorkerLike;
  pending: Map<number, { resolve: () => void; reject: (e: Error) => void }>;
}

/**
 * Creates a WorkerWriter backed by a dedicated worker, started on the first write.
 * If the worker fails to load, crashes or stops answering, every waiting write
 * fails and the worker is dropped, so the next write starts a fresh one instead
 * of hanging forever.
 */
export function createWorkerWriter(
  createWorker: () => WorkerLike,
  timeoutMs: number = WORKER_WRITE_TIMEOUT_MS,
): WorkerWriter {
  let nextId = 1;
  let current: WorkerSession | null = null;

  const stop = (session: WorkerSession, reason: string) => {
    if (current === session) current = null;
    session.worker.terminate();
    const entries = [...session.pending.values()];
    session.pending.clear();
    for (const entry of entries) entry.reject(new Error(reason));
  };

  const start = (): WorkerSession => {
    const session: WorkerSession = { worker: createWorker(), pending: new Map() };
    const fail = () => stop(session, 'The file worker stopped');
    session.worker.addEventListener('error', fail);
    session.worker.addEventListener('messageerror', fail);
    session.worker.addEventListener('message', (event: MessageEvent<WorkerReply>) => {
      const { id, ok, error } = event.data;
      const entry = session.pending.get(id);
      if (!entry) return;
      session.pending.delete(id);
      if (ok) entry.resolve();
      else entry.reject(new Error(error ?? 'Write failed'));
    });
    return session;
  };

  return (path, bytes) =>
    new Promise<void>((resolve, reject) => {
      const session = (current ??= start());
      const id = nextId++;
      const timer = setTimeout(() => stop(session, 'The file worker did not answer'), timeoutMs);
      session.pending.set(id, {
        resolve: () => {
          clearTimeout(timer);
          resolve();
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      try {
        session.worker.postMessage({ id, path, bytes }, [bytes.buffer as ArrayBuffer]);
      } catch (err) {
        session.pending.delete(id);
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
}
