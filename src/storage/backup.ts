import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import { InvalidClosetError, assertWithinRestoreLimits, closetImagePaths, isSafeImagePath, parseCloset } from '../core/closet';
import { defaultDoll, type ClosetData } from '../core/model';
import { InvalidPhotoError, stripPhotoMetadata } from '../image/metadata';
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

/** Builds one ZIP file holding closet.json and every photo (items and the parent's doll). */
export async function exportBackup(repo: ClosetRepository, exportedAt: string): Promise<Uint8Array> {
  // Read the list and the photos together, so a save running at the same time can't change them halfway.
  const { data, images } = await repo.snapshot();
  const files: Zippable = {};
  for (const item of data.items) {
    const bytes = images.get(item.image);
    if (!bytes) throw new Error(`Photo missing for ${item.name}`);
    // Photos are already compressed; storing them avoids wasting time on the phone.
    files[item.image] = [bytes, { level: 0 }];
  }
  // AI looks aren't in backups yet (PR 6 of docs/ai-doll-look.md); they can be made again.
  let closet: ClosetData = { ...data, aiLooks: [] };
  const dollBytes = data.doll.image ? images.get(data.doll.image) : null;
  if (data.doll.image && dollBytes) files[data.doll.image] = [dollBytes, { level: 0 }];
  // A lost doll picture must never block the backup of her clothes: back up the bundled doll instead.
  else if (data.doll.image) closet = { ...closet, doll: defaultDoll() };
  const manifest: Manifest = { format: BACKUP_FORMAT, exportedAt, closet };
  files[BACKUP_MANIFEST] = strToU8(JSON.stringify(manifest, null, 2));
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
  // Looks aren't in backups yet, so a backup can't bring pictures for them.
  closet = { ...closet, aiLooks: [] };
  const images = new Map<string, Blob>();
  for (const path of closetImagePaths(closet)) {
    const bytes = entries[path];
    if (!bytes) throw new InvalidBackupError(`Photo ${path} is missing from the backup`);
    const ext = path.endsWith('.webp') ? 'webp' : 'jpg';
    let clean: Uint8Array;
    try {
      // A backup can come from anywhere: check the photo is what its name says, and drop location and other metadata.
      clean = stripPhotoMetadata(bytes, ext);
    } catch (err) {
      if (err instanceof InvalidPhotoError) throw new InvalidBackupError(`Photo ${path}: ${err.message}`);
      throw err;
    }
    images.set(path, new Blob([clean as BlobPart], { type: ext === 'webp' ? 'image/webp' : 'image/jpeg' }));
  }
  return { closet, images };
}

export async function importBackup(repo: ClosetRepository, zip: Uint8Array): Promise<ClosetData> {
  const { closet, images } = readBackup(zip);
  return repo.replaceAll(closet, images);
}
