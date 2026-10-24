/** Thin wrappers over browser APIs, written so tests can pass fakes. */

export interface StorageLike {
  persist?: () => Promise<boolean>;
  persisted?: () => Promise<boolean>;
  estimate?: () => Promise<{ usage?: number; quota?: number }>;
}

export interface StorageStatus {
  persisted: boolean | null;
  usageBytes: number | null;
}

/** Asks the browser not to evict our files. Safe to call on every start. */
export async function requestPersistence(storage: StorageLike | undefined): Promise<boolean | null> {
  if (!storage?.persisted || !storage.persist) return null;
  try {
    if (await storage.persisted()) return true;
    return await storage.persist();
  } catch {
    return null;
  }
}

export async function readStorageStatus(storage: StorageLike | undefined): Promise<StorageStatus> {
  let persisted: boolean | null = null;
  let usageBytes: number | null = null;
  try {
    if (storage?.persisted) persisted = await storage.persisted();
  } catch {
    persisted = null;
  }
  try {
    if (storage?.estimate) usageBytes = (await storage.estimate()).usage ?? null;
  } catch {
    usageBytes = null;
  }
  return { persisted, usageBytes };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export interface ShareEnv {
  canShare?: (data: { files: File[] }) => boolean;
  share?: (data: { files: File[]; title?: string }) => Promise<void>;
  download: (file: File) => void;
}

/**
 * On iPhone the share sheet offers "Save to Files" (iCloud Drive); elsewhere
 * the file is downloaded. Returns false if the user cancelled the share sheet.
 */
export async function shareOrDownload(bytes: Uint8Array, fileName: string, env: ShareEnv): Promise<boolean> {
  const file = new File([bytes as BlobPart], fileName, { type: 'application/zip' });
  if (env.share && env.canShare?.({ files: [file] })) {
    try {
      await env.share({ files: [file], title: fileName });
      return true;
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError') return false;
      throw err;
    }
  }
  env.download(file);
  return true;
}

export function browserShareEnv(): ShareEnv {
  return {
    canShare: navigator.canShare ? (d) => navigator.canShare(d) : undefined,
    share: navigator.share ? (d) => navigator.share(d) : undefined,
    download: (file) => {
      const url = URL.createObjectURL(file);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    },
  };
}

export function daysSince(iso: string | null, now: Date): number | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  return Math.floor((now.getTime() - then) / 86_400_000);
}
