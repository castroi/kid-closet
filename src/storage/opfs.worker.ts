/*
 * Writes files into the Origin Private File System. Safari (iOS) only supports
 * writing OPFS files through a synchronous access handle, which is only
 * available inside a dedicated worker.
 */
export {};

/** Safari before 16.4 returns Promises from these methods; awaiting a plain value is harmless. */
interface SyncAccessHandle {
  truncate(size: number): void | Promise<void>;
  write(buffer: Uint8Array, options?: { at?: number }): number | Promise<number>;
  flush(): void | Promise<void>;
  close(): void | Promise<void>;
}

interface WriteRequest {
  id: number;
  path: string;
  bytes: Uint8Array;
}

async function writeFile(path: string, bytes: Uint8Array): Promise<void> {
  const parts = path.split('/');
  const root = await navigator.storage.getDirectory();
  const dir = parts.length === 2 ? await root.getDirectoryHandle(parts[0], { create: true }) : root;
  const fileHandle = await dir.getFileHandle(parts[parts.length - 1], { create: true });
  const handle = await (
    fileHandle as unknown as { createSyncAccessHandle(): Promise<SyncAccessHandle> }
  ).createSyncAccessHandle();
  try {
    await handle.truncate(0);
    let written = 0;
    while (written < bytes.byteLength) {
      const n = Number(await handle.write(bytes.subarray(written), { at: written }));
      if (!Number.isFinite(n) || n <= 0) throw new Error('Write made no progress');
      written += n;
    }
    await handle.flush();
  } finally {
    await handle.close();
  }
}

// The project compiles against the DOM lib; describe the worker scope we use.
const scope = self as unknown as {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<WriteRequest>) => void): void;
};

scope.addEventListener('message', (event) => {
  const { id, path, bytes } = event.data;
  writeFile(path, bytes).then(
    () => scope.postMessage({ id, ok: true }),
    (err: unknown) => scope.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) }),
  );
});
