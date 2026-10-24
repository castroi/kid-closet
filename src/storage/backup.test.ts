// @vitest-environment node
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { NOW, closetWith, makeItem, makeOutfit, seededStore } from '../test/data';
import {
  BACKUP_FORMAT,
  InvalidBackupError,
  MAX_ENTRY_BYTES,
  backupFileName,
  exportBackup,
  importBackup,
  readBackup,
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

  it('names the file by date', () => {
    expect(backupFileName('2026-10-24T08:00:00.000Z')).toBe('kid-closet-backup-2026-10-24.zip');
  });

  it('ignores unrelated files and rejects oversized entries', () => {
    const data = closetWith([makeItem({ id: 't' })]);
    const manifest = strToU8(JSON.stringify({ format: BACKUP_FORMAT, exportedAt: NOW, closet: data }));
    const ok = zipSync({ 'closet.json': manifest, 'images/t.webp': strToU8('p'), '../evil.sh': strToU8('x') });
    expect([...readBackup(ok).images.keys()]).toEqual(['images/t.webp']);

    const huge = zipSync({ 'closet.json': manifest, 'images/t.webp': new Uint8Array(MAX_ENTRY_BYTES + 1) });
    expect(() => readBackup(huge)).toThrow('too large');
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
