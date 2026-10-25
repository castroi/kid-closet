import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import { InvalidClosetError, assertWithinRestoreLimits, isSafeImagePath, parseCloset } from '../core/closet';
import type { ClosetData } from '../core/model';
import { blobToBytes } from './fileStore';
import type { ClosetRepository } from './repository';

export const BACKUP_MANIFEST = 'closet.json';
export const BACKUP_FORMAT = 'kid-closet-backup';
/**
 * A resized photo is ~50–150 KB, so 150 MB holds 1000+ photos. The limits also
 * keep a restore within what an iPhone can hold in memory: the ZIP, the unpacked
 * photos and their copies are all in memory at once.
 */
export const MAX_ENTRY_BYTES = 10 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 150 * 1024 * 1024;
/** Photos are stored uncompressed in the ZIP, so the file is about the size of its contents. */
export const MAX_BACKUP_FILE_BYTES = MAX_TOTAL_BYTES + 5 * 1024 * 1024;

interface Manifest {
  format: string;
  exportedAt: string;
  closet: ClosetData;
}

export class InvalidBackupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidBackupError';
  }
}

export class BackupTooLargeError extends InvalidBackupError {
  constructor() {
    super('The backup is too large');
    this.name = 'BackupTooLargeError';
  }
}

/** Reads a chosen backup file, refusing one too large to restore before loading it into memory. */
export async function readBackupFile(file: Blob): Promise<Uint8Array> {
  if (file.size > MAX_BACKUP_FILE_BYTES) throw new BackupTooLargeError();
  return blobToBytes(file);
}

/** Builds one ZIP file holding closet.json and every photo. */
export async function exportBackup(repo: ClosetRepository, exportedAt: string): Promise<Uint8Array> {
  // Read the list and the photos together, so a save running at the same time can't change them halfway.
  const { data: closet, images } = await repo.snapshot();
  const manifest: Manifest = { format: BACKUP_FORMAT, exportedAt, closet };
  const files: Zippable = { [BACKUP_MANIFEST]: strToU8(JSON.stringify(manifest, null, 2)) };
  for (const item of closet.items) {
    const bytes = images.get(item.image);
    if (!bytes) throw new Error(`Photo missing for ${item.name}`);
    // Photos are already compressed; storing them avoids wasting time on the phone.
    files[item.image] = [bytes, { level: 0 }];
  }
  return zipSync(files);
}

/** Names the file by the phone's local date, so a backup made just after midnight gets that day. */
export function backupFileName(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `kid-closet-backup-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.zip`;
}

/** Reads a backup ZIP. Throws InvalidBackupError when it is not a usable backup. */
export function readBackup(zip: Uint8Array): { closet: ClosetData; images: Map<string, Blob> } {
  let entries: Record<string, Uint8Array>;
  let total = 0;
  try {
    entries = unzipSync(zip, {
      // Unpack only files we use, and refuse oversized content before it fills the phone's memory.
      filter: (file) => {
        if (file.name !== BACKUP_MANIFEST && !isSafeImagePath(file.name)) return false;
        total += file.originalSize;
        if (file.originalSize > MAX_ENTRY_BYTES || total > MAX_TOTAL_BYTES) throw new BackupTooLargeError();
        return true;
      },
    });
  } catch (err) {
    if (err instanceof InvalidBackupError) throw err;
    throw new InvalidBackupError('The file is not a ZIP backup');
  }
  const manifestBytes = entries[BACKUP_MANIFEST];
  if (!manifestBytes) throw new InvalidBackupError('closet.json is missing from the backup');
  let manifest: Partial<Manifest>;
  try {
    manifest = JSON.parse(strFromU8(manifestBytes)) as Partial<Manifest>;
  } catch {
    throw new InvalidBackupError('closet.json is not valid JSON');
  }
  if (manifest.format !== BACKUP_FORMAT) throw new InvalidBackupError('This is not a closet backup');
  let closet: ClosetData;
  try {
    assertWithinRestoreLimits(manifest.closet);
    closet = parseCloset(manifest.closet);
  } catch (err) {
    if (err instanceof InvalidClosetError) throw new InvalidBackupError(err.message);
    throw err;
  }
  const images = new Map<string, Blob>();
  for (const item of closet.items) {
    const bytes = entries[item.image];
    if (!bytes) throw new InvalidBackupError(`Photo ${item.image} is missing from the backup`);
    const type = item.image.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
    images.set(item.image, new Blob([bytes as BlobPart], { type }));
  }
  return { closet, images };
}

export async function importBackup(repo: ClosetRepository, zip: Uint8Array): Promise<ClosetData> {
  const { closet, images } = readBackup(zip);
  return repo.replaceAll(closet, images);
}
