import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import { InvalidClosetError, assertWithinRestoreLimits, closetImagePaths, isSafeImagePath, parseCloset } from '../core/closet';
import type { AiLook } from '../core/model';
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

export interface BackupResult {
  zip: Uint8Array;
  /** AI looks left out so the backup stays restorable (oldest first), or whose picture was lost. They can be made again. */
  skippedLooks: number;
}

/**
 * Builds one ZIP file holding closet.json and every photo: items, the parent's doll and the AI looks.
 * Clothes and the doll always go in. AI looks go in newest first while the backup stays within what
 * a restore accepts; the oldest ones are left out (they can be made again, the clothes can't).
 */
export async function exportBackup(
  repo: ClosetRepository,
  exportedAt: string,
  /** Only tests pass a smaller limit. */
  maxTotalBytes = MAX_TOTAL_BYTES,
): Promise<BackupResult> {
  // Read the list and the photos together, so a save running at the same time can't change them halfway.
  const { data, images } = await repo.snapshot();
  const files: Zippable = {};
  let total = 0;
  for (const item of data.items) {
    const bytes = images.get(item.image);
    if (!bytes) throw new Error(`Photo missing for ${item.name}`);
    // Photos are already compressed; storing them avoids wasting time on the phone.
    files[item.image] = [bytes, { level: 0 }];
    total += bytes.length;
  }
  let closet: ClosetData = data;
  const dollBytes = data.doll.image ? images.get(data.doll.image) : null;
  if (data.doll.image && dollBytes) {
    files[data.doll.image] = [dollBytes, { level: 0 }];
    total += dollBytes.length;
  }
  // A lost doll picture must never block the backup of her clothes: back up the bundled doll instead.
  else if (data.doll.image) closet = { ...closet, doll: defaultDoll() };

  // closet.json with every look is the largest it can get, so leaving looks out only makes room.
  const manifestOf = (aiLooks: AiLook[]) =>
    strToU8(JSON.stringify({ format: BACKUP_FORMAT, exportedAt, closet: { ...closet, aiLooks } } satisfies Manifest, null, 2));
  let room = maxTotalBytes - total - manifestOf(data.aiLooks).length;
  const kept = new Set<string>();
  const newestFirst = [...data.aiLooks].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  for (const look of newestFirst) {
    const bytes = images.get(look.image);
    if (!bytes || bytes.length > MAX_ENTRY_BYTES || bytes.length > room) continue;
    files[look.image] = [bytes, { level: 0 }];
    room -= bytes.length;
    kept.add(look.id);
  }
  const aiLooks = data.aiLooks.filter((l) => kept.has(l.id));
  files[BACKUP_MANIFEST] = manifestOf(aiLooks);
  return { zip: zipSync(files), skippedLooks: data.aiLooks.length - aiLooks.length };
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
  for (const path of closetImagePaths(closet)) {
    const bytes = entries[path];
    if (!bytes) throw new InvalidBackupError(`Photo ${path} is missing from the backup`);
    images.set(path, cleanPhoto(path, bytes));
  }
  // A look whose picture isn't in the backup is left out: it can be made again. A broken picture still fails the restore.
  const aiLooks = closet.aiLooks.filter((l) => entries[l.image]);
  for (const look of aiLooks) images.set(look.image, cleanPhoto(look.image, entries[look.image]));
  return { closet: { ...closet, aiLooks }, images };
}

/** A backup can come from anywhere: check the photo is what its name says, and drop location and other metadata. */
function cleanPhoto(path: string, bytes: Uint8Array): Blob {
  const ext = path.endsWith('.webp') ? 'webp' : 'jpg';
  let clean: Uint8Array;
  try {
    clean = stripPhotoMetadata(bytes, ext);
  } catch (err) {
    if (err instanceof InvalidPhotoError) throw new InvalidBackupError(`Photo ${path}: ${err.message}`);
    throw err;
  }
  return new Blob([clean as BlobPart], { type: ext === 'webp' ? 'image/webp' : 'image/jpeg' });
}

export async function importBackup(repo: ClosetRepository, zip: Uint8Array): Promise<ClosetData> {
  const { closet, images } = readBackup(zip);
  return repo.replaceAll(closet, images);
}
