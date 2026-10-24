/**
 * Minimal file API over the app's private folder on the device.
 * Paths are relative, use "/" as separator, and are at most one folder deep
 * (e.g. "closet-a.json", "images/abc.webp").
 */
export interface FileStore {
  read(path: string): Promise<Blob | null>;
  write(path: string, data: Blob): Promise<void>;
  remove(path: string): Promise<void>;
  /** File names (not paths) directly inside a folder; empty if the folder does not exist. */
  list(dir: string): Promise<string[]>;
}

export function splitPath(path: string): { dir: string | null; name: string } {
  const parts = path.split('/');
  if (parts.length > 2 || parts.some((p) => p === '' || p === '.' || p === '..')) {
    throw new Error(`Invalid path: ${path}`);
  }
  return parts.length === 2 ? { dir: parts[0], name: parts[1] } : { dir: null, name: parts[0] };
}

export class MemoryFileStore implements FileStore {
  readonly files = new Map<string, Blob>();

  async read(path: string): Promise<Blob | null> {
    splitPath(path);
    return this.files.get(path) ?? null;
  }

  async write(path: string, data: Blob): Promise<void> {
    splitPath(path);
    this.files.set(path, data);
  }

  async remove(path: string): Promise<void> {
    this.files.delete(path);
  }

  async list(dir: string): Promise<string[]> {
    const prefix = `${dir}/`;
    return [...this.files.keys()].filter((p) => p.startsWith(prefix)).map((p) => p.slice(prefix.length));
  }
}

export async function blobToText(blob: Blob): Promise<string> {
  if (typeof blob.text === 'function') return blob.text();
  return new TextDecoder().decode(await blobToBytes(blob));
}

export async function blobToBytes(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === 'function') return new Uint8Array(await blob.arrayBuffer());
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}
