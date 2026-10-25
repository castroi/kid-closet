// @vitest-environment node
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it, vi } from 'vitest';
import { MAX_ITEMS, MAX_NAME_LENGTH, MAX_OUTFITS } from '../core/closet';
import { NOW, closetWith, makeItem, makeOutfit, seededStore } from '../test/data';
import {
  BACKUP_FORMAT,
  BackupTooLargeError,
  InvalidBackupError,
  MAX_BACKUP_FILE_BYTES,
  MAX_ENTRY_BYTES,
  backupFileName,
  exportBackup,
  importBackup,
  readBackup,
  readBackupFile,
} from './backup';
import { MemoryFileStore, blobToText } from './fileStore';
import { ClosetRepository } from './repository';

function sample() {
  return closetWith(
    [makeItem({ id: 't' }), makeItem({ id: 'b', type: 'pants', image: 'images/b.jpg' })],
    [makeOutfit({ id: 'o', topId: 't', bottomId: 'b' })],
  );
}

function manifestZip(manifest: unknown, extra: Record<string, Uint8Array> = {}) {
  return zipSync({ 'closet.json': strToU8(JSON.stringify(manifest)), ...extra });
}

describe('backup', () => {
  it('round-trips the closet and every photo', async () => {
    const source = new ClosetRepository(seededStore(sample()), () => NOW);
    await source.load();
    const zip = await exportBackup(source, NOW);

    const targetStore = new MemoryFileStore();
    const target = new ClosetRepository(targetStore, () => NOW);
    await target.load();
    const restored = await importBackup(target, zip);

    expect(restored.items.map((i) => i.id)).toEqual(['t', 'b']);
    expect(restored.outfits).toHaveLength(1);
    expect(await blobToText((await targetStore.read('images/t.webp'))!)).toBe('img');
    expect((await targetStore.read('images/b.jpg'))!.type).toBe('image/jpeg');
  });

  it('fails the export when a photo is missing', async () => {
    const store = seededStore(sample());
    const repo = new ClosetRepository(store, () => NOW);
    await repo.load();
    store.files.delete('images/t.webp');
    await expect(exportBackup(repo, NOW)).rejects.toThrow('Photo missing');
  });

  it('exports a consistent closet while a delete is running', async () => {
    const store = seededStore(sample());
    const repo = new ClosetRepository(store, () => NOW);
    await repo.load();
    const exporting = exportBackup(repo, NOW); // queued first, so it sees the closet before the delete
    const deleting = repo.deleteItems(['t']);
    const zip = await exporting;
    await deleting;
    const { closet, images } = readBackup(zip);
    expect(closet.items.map((i) => i.id)).toEqual(['t', 'b']);
    expect([...images.keys()].sort()).toEqual(['images/b.jpg', 'images/t.webp']);
    expect(store.files.has('images/t.webp')).toBe(false);
  });

  it('names the file by the local date', () => {
    expect(backupFileName(new Date(2026, 9, 24, 8, 0))).toBe('kid-closet-backup-2026-10-24.zip');
    // Just after local midnight it is already the new day, whatever the UTC date is.
    expect(backupFileName(new Date(2026, 0, 5, 0, 30))).toBe('kid-closet-backup-2026-01-05.zip');
  });

  it('refuses a backup file too large to restore before reading it', async () => {
    const huge = { size: MAX_BACKUP_FILE_BYTES + 1, arrayBuffer: vi.fn() } as unknown as Blob;
    await expect(readBackupFile(huge)).rejects.toBeInstanceOf(BackupTooLargeError);
    expect((huge as unknown as { arrayBuffer: ReturnType<typeof vi.fn> }).arrayBuffer).not.toHaveBeenCalled();
    expect(await readBackupFile(new Blob([new Uint8Array([1, 2, 3])]))).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('rejects restore data far larger than any real closet', () => {
    const many = closetWith([]);
    const tooMany = { ...many, items: Array.from({ length: MAX_ITEMS + 1 }, (_, i) => makeItem({ id: `i${i}` })) };
    expect(() => readBackup(manifestZip({ format: BACKUP_FORMAT, closet: tooMany }))).toThrow(`more than ${MAX_ITEMS} items`);

    const longName = closetWith([makeItem({ id: 't', name: 'x'.repeat(MAX_NAME_LENGTH + 1) })]);
    const zip = manifestZip({ format: BACKUP_FORMAT, closet: longName }, { 'images/t.webp': strToU8('p') });
    expect(() => readBackup(zip)).toThrow(InvalidBackupError);
    expect(() => readBackup(zip)).toThrow('name is too long');

    const tooManyOutfits = { ...many, outfits: Array.from({ length: MAX_OUTFITS + 1 }, () => ({})) };
    expect(() => readBackup(manifestZip({ format: BACKUP_FORMAT, closet: tooManyOutfits }))).toThrow('outfits');
  });

  it('ignores unrelated files and rejects oversized entries', () => {
    const data = closetWith([makeItem({ id: 't' })]);
    const manifest = strToU8(JSON.stringify({ format: BACKUP_FORMAT, exportedAt: NOW, closet: data }));
    const ok = zipSync({ 'closet.json': manifest, 'images/t.webp': strToU8('p'), '../evil.sh': strToU8('x') });
    expect([...readBackup(ok).images.keys()]).toEqual(['images/t.webp']);

    const huge = zipSync({ 'closet.json': manifest, 'images/t.webp': new Uint8Array(MAX_ENTRY_BYTES + 1) });
    expect(() => readBackup(huge)).toThrow(BackupTooLargeError);
  });

  it.each([
    ['not a zip', new Uint8Array([1, 2, 3]), 'not a ZIP'],
    ['no manifest', zipSync({ 'other.txt': strToU8('x') }), 'missing'],
    ['bad json', zipSync({ 'closet.json': strToU8('{oops') }), 'not valid JSON'],
    ['wrong format', manifestZip({ format: 'something-else', closet: sample() }), 'not a closet backup'],
    ['invalid closet', manifestZip({ format: BACKUP_FORMAT, closet: { schemaVersion: 1 } }), 'items'],
    ['missing photo', manifestZip({ format: BACKUP_FORMAT, closet: sample() }), 'images/t.webp'],
  ])('rejects %s', (_label, zip, message) => {
    expect(() => readBackup(zip)).toThrow(InvalidBackupError);
    expect(() => readBackup(zip)).toThrow(message);
  });
});
