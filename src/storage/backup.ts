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
  const manifestOf = (closet: ClosetData) =>
    strToU8(JSON.stringify({ format: BACKUP_FORMAT, exportedAt, closet } satisfies Manifest, null, 2));
  // Read the list and the photos together, so a save running at the same time can't change them halfway.
  const { data, images } = await repo.snapshot((closet, sizes) => {
    // closet.json listing every look is the largest it can get (the bundled-doll fallback only shortens it).
    let room = maxTotalBytes - manifestOf(closet).length;
    for (const path of closetImagePaths(closet)) room -= sizes.get(path) ?? 0;
    const kept = new Set<string>();
    for (const look of [...closet.aiLooks].sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
      const size = sizes.get(look.image);
      if (size == null || size > MAX_ENTRY_BYTES || size > room) continue;
      room -= size;
      kept.add(look.id);
    }
    return kept;
  });
  const files: Zippable = {};
  for (const item of data.items) {
    const bytes = images.get(item.image);
    if (!bytes) throw new Error(`Photo missing for ${item.name}`);
    // Photos are already compressed; storing them avoids wasting time on the phone.
    files[item.image] = [bytes, { level: 0 }];
  }
  let closet: ClosetData = data;
  const dollBytes = data.doll.image ? images.get(data.doll.image) : null;
  if (data.doll.image && dollBytes) files[data.doll.image] = [dollBytes, { level: 0 }];
  // A lost doll picture must never block the backup of her clothes: back up the bundled doll instead.
  else if (data.doll.image) closet = { ...closet, doll: defaultDoll() };
  const aiLooks = data.aiLooks.filter((l) => images.get(l.image));
  for (const look of aiLooks) files[look.image] = [images.get(look.image)!, { level: 0 }];
  files[BACKUP_MANIFEST] = manifestOf({ ...closet, aiLooks });
  return { zip: zipSync(files), skippedLooks: data.aiLooks.length - aiLooks.length };
}

/** Names the file by the phone's local date, so a backup made just after midnight gets that day. */
export function backupFileName(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `kid-closet-backup-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.zip`;
}

/**
 * Reads a backup ZIP. Throws InvalidBackupError when it is not a usable backup. `skippedLooks`: AI looks
 * left out because their picture is missing or broken; they can be made again, the clothes can't.
 */
export function readBackup(zip: Uint8Array): { closet: ClosetData; images: Map<string, Blob>; skippedLooks: number } {
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
  // A look whose picture is missing or broken is left out, and its bytes are never written to the phone.
  const aiLooks = closet.aiLooks.filter((look) => {
    const bytes = entries[look.image];
    if (!bytes) return false;
    try {
      images.set(look.image, cleanPhoto(look.image, bytes));
      return true;
    } catch (err) {
      if (err instanceof InvalidBackupError) return false;
      throw err;
    }
  });
  return { closet: { ...closet, aiLooks }, images, skippedLooks: closet.aiLooks.length - aiLooks.length };
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

export async function importBackup(repo: ClosetRepository, zip: Uint8Array): Promise<{ closet: ClosetData; skippedLooks: number }> {
  const { closet, images, skippedLooks } = readBackup(zip);
  return { closet: await repo.replaceAll(closet, images), skippedLooks };
}
