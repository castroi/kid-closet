// @vitest-environment node
import { strToU8, unzipSync, zipSync } from 'fflate';
import { describe, expect, it, vi } from 'vitest';
import { MAX_ITEMS, MAX_LOOKS, MAX_NAME_LENGTH, MAX_OUTFITS, isAnalysed } from '../core/closet';
import { NOW, asVersion1, closetWith, makeAnalysis, makeItem, makeLook, makeOutfit, seededStore, testPhoto, withDoll } from '../test/data';
import { gpsJpeg } from '../test/photos';
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
import { MemoryFileStore, blobToBytes } from './fileStore';
import { ClosetRepository } from './repository';

function sample() {
  return closetWith(
    [makeItem({ id: 't' }), makeItem({ id: 'b', type: 'pants', image: 'images/b.jpg' })],
    [makeOutfit({ id: 'o', topId: 't', bottomId: 'b' })],
  );
}

/** A closet with one AI look (shirt t + trousers b) per [id, createdAt]; each look has its own doll so they don't share parts. */
async function repoWithLooks(looks: [string, string][]) {
  const data = { ...sample(), aiLooks: looks.map(([id, createdAt]) => makeLook({ id, createdAt, dollId: `doll-${id}`, upperId: 't', bottomId: 'b' })) };
  const store = seededStore(data);
  for (const [id] of looks) store.files.set(`images/look-${id}.webp`, new Blob([testPhoto('webp') as BlobPart], { type: 'image/webp' }));
  const repo = new ClosetRepository(store, () => NOW);
  await repo.load();
  return { repo, store };
}

function manifestZip(manifest: unknown, extra: Record<string, Uint8Array> = {}) {
  return zipSync({ 'closet.json': strToU8(JSON.stringify(manifest)), ...extra });
}

describe('backup', () => {
  it('round-trips the closet and every photo', async () => {
    const source = new ClosetRepository(seededStore(sample()), () => NOW);
    await source.load();
    const zip = (await exportBackup(source, NOW)).zip;

    const targetStore = new MemoryFileStore();
    const target = new ClosetRepository(targetStore, () => NOW);
    await target.load();
    const { closet: restored } = await importBackup(target, zip);

    expect(restored.items.map((i) => i.id)).toEqual(['t', 'b']);
    expect(restored.outfits).toHaveLength(1);
    // Photos without metadata come back byte for byte.
    expect(await blobToBytes((await targetStore.read('images/t.webp'))!)).toEqual(testPhoto('webp'));
    expect(await blobToBytes((await targetStore.read('images/b.jpg'))!)).toEqual(testPhoto('jpg'));
    expect((await targetStore.read('images/b.jpg'))!.type).toBe('image/jpeg');
  });

  it("round-trips the parent's doll picture", async () => {
    const source = new ClosetRepository(seededStore(withDoll(sample(), 'd1', 'jpg')), () => NOW);
    await source.load();
    const zip = (await exportBackup(source, NOW)).zip;

    const targetStore = new MemoryFileStore();
    const target = new ClosetRepository(targetStore, () => NOW);
    await target.load();
    const { closet: restored } = await importBackup(target, zip);

    expect(restored.doll).toEqual({ id: 'd1', image: 'images/doll-d1.jpg' });
    expect(await blobToBytes((await targetStore.read('images/doll-d1.jpg'))!)).toEqual(testPhoto('jpg'));
  });

  it('round-trips AI looks and their pictures, replacing the looks on the phone', async () => {
    const { repo } = await repoWithLooks([
      ['l1', '2026-10-20T08:00:00.000Z'],
      ['l2', '2026-10-21T08:00:00.000Z'],
    ]);
    const { zip, skippedLooks } = await exportBackup(repo, NOW);
    expect(skippedLooks).toBe(0);

    const targetStore = seededStore(sample());
    targetStore.files.set('images/look-old.webp', new Blob(['old']));
    const target = new ClosetRepository(targetStore, () => NOW);
    await target.load();
    const { closet: restored } = await importBackup(target, zip);
    expect(restored.aiLooks.map((l) => l.id)).toEqual(['l1', 'l2']);
    expect(await blobToBytes((await targetStore.read('images/look-l2.webp'))!)).toEqual(testPhoto('webp'));
    expect(targetStore.files.has('images/look-old.webp')).toBe(false);
  });

  it('leaves out the oldest AI looks so the backup stays restorable, never the clothes', async () => {
    const { repo, store } = await repoWithLooks([
      ['old', '2026-10-01T08:00:00.000Z'],
      ['new', '2026-10-25T08:00:00.000Z'],
      ['mid', '2026-10-10T08:00:00.000Z'],
    ]);
    const full = unzipSync((await exportBackup(repo, NOW)).zip);
    const clothes = full['images/t.webp'].length + full['images/b.jpg'].length;
    const look = full['images/look-new.webp'].length;
    // Room for the clothes, the full closet.json and one and a half looks.
    const limit = clothes + full['closet.json'].length + look + Math.floor(look / 2);

    // A look left out is never read into memory.
    const oldPicture = store.files.get('images/look-old.webp')!;
    const readOld = vi.spyOn(oldPicture, 'arrayBuffer');
    const { zip, skippedLooks } = await exportBackup(repo, NOW, limit);
    expect(skippedLooks).toBe(2);
    expect(readOld).not.toHaveBeenCalled();
    const { closet, images } = readBackup(zip);
    expect(closet.aiLooks.map((l) => l.id)).toEqual(['new']);
    expect([...images.keys()].sort()).toEqual(['images/b.jpg', 'images/look-new.webp', 'images/t.webp']);

    // With no room for any look, the clothes still go in.
    const tight = await exportBackup(repo, NOW, 1);
    expect(tight.skippedLooks).toBe(3);
    expect(readBackup(tight.zip).closet.items).toHaveLength(2);
  });

  it('leaves out a look whose picture is lost or too large to restore', async () => {
    const { repo, store } = await repoWithLooks([
      ['lost', '2026-10-01T08:00:00.000Z'],
      ['huge', '2026-10-02T08:00:00.000Z'],
      ['ok', '2026-10-03T08:00:00.000Z'],
    ]);
    store.files.delete('images/look-lost.webp');
    store.files.set('images/look-huge.webp', new Blob([new Uint8Array(MAX_ENTRY_BYTES + 1)]));
    const { zip, skippedLooks } = await exportBackup(repo, NOW);
    expect(skippedLooks).toBe(2);
    expect(readBackup(zip).closet.aiLooks.map((l) => l.id)).toEqual(['ok']);
  });

  it('restores the clothes when a look picture is missing or broken, leaving that look out', async () => {
    const { repo } = await repoWithLooks([['l1', NOW]]);
    const photos = { 'images/t.webp': testPhoto('webp'), 'images/b.jpg': testPhoto('jpg') };
    const manifest = { format: BACKUP_FORMAT, exportedAt: NOW, closet: repo.getData() };
    const missing = readBackup(manifestZip(manifest, photos));
    expect(missing.closet.aiLooks).toEqual([]);
    expect([...missing.images.keys()]).not.toContain('images/look-l1.webp');

    expect(missing.skippedLooks).toBe(1);

    const broken = readBackup(manifestZip(manifest, { ...photos, 'images/look-l1.webp': strToU8('not a picture') }));
    expect(broken.closet.aiLooks).toEqual([]);
    expect(broken.closet.items).toHaveLength(2);
    expect(broken.skippedLooks).toBe(1);
    expect([...broken.images.keys()]).not.toContain('images/look-l1.webp');
  });

  it('keeps every analysis and photo revision, so nothing looks unanalysed after a restore', async () => {
    const data = sample();
    data.items = [
      { ...data.items[0], photoRevision: 3, analysis: makeAnalysis({ photoRevision: 3 }) },
      { ...data.items[1], analysis: makeAnalysis({ result: 'invalid-photo', notes: 'Blurry.', attributes: undefined } as never) },
    ];
    const source = new ClosetRepository(seededStore(data), () => NOW);
    await source.load();
    const zip = (await exportBackup(source, NOW)).zip;

    const target = new ClosetRepository(new MemoryFileStore(), () => NOW);
    await target.load();
    const { closet: restored } = await importBackup(target, zip);
    expect(restored.items.map((it) => [it.photoRevision, it.analysis])).toEqual(
      JSON.parse(JSON.stringify(data.items.map((it) => [it.photoRevision, it.analysis]))),
    );
    expect(restored.items.every((it) => isAnalysed(it))).toBe(true);
  });

  it('keeps the AI settings in the backup', async () => {
    const ai = {
      provider: 'venice' as const,
      model: 'm',
      prompt: 'p',
      monthlyCap: 7,
      analysis: { enabled: true, model: 'deepseek-v4-1-flash', monthlyCap: 250 },
    };
    const repo = new ClosetRepository(seededStore({ ...sample(), ai }), () => NOW);
    await repo.load();
    expect(readBackup((await exportBackup(repo, NOW)).zip).closet.ai).toEqual(ai);
  });

  it('restores a version 1 backup with the bundled doll', () => {
    const v1 = asVersion1(sample());
    const zip = manifestZip(
      { format: BACKUP_FORMAT, exportedAt: NOW, closet: v1 },
      { 'images/t.webp': testPhoto('webp'), 'images/b.jpg': testPhoto('jpg') },
    );
    const { closet, images } = readBackup(zip);
    expect(closet.doll.image).toBeNull();
    expect([...images.keys()]).toEqual(['images/t.webp', 'images/b.jpg']);
  });

  it('rejects a backup whose doll picture is missing', () => {
    const zip = manifestZip(
      { format: BACKUP_FORMAT, exportedAt: NOW, closet: withDoll(sample()) },
      { 'images/t.webp': testPhoto('webp'), 'images/b.jpg': testPhoto('jpg') },
    );
    expect(() => readBackup(zip)).toThrow('images/doll-d1.webp');
  });

  it('still backs up the clothes when the doll picture is lost, with the bundled doll', async () => {
    const store = seededStore(withDoll(sample()));
    store.files.delete('images/doll-d1.webp');
    const repo = new ClosetRepository(store, () => NOW);
    await repo.load();
    const { closet, images } = readBackup((await exportBackup(repo, NOW)).zip);
    expect(closet.doll).toEqual({ id: 'default', image: null });
    expect(closet.items.map((i) => i.id)).toEqual(['t', 'b']);
    expect([...images.keys()]).toEqual(['images/t.webp', 'images/b.jpg']);
  });

  it('removes location and other metadata from restored photos', () => {
    const exif = [0x45, 0x58, 0x49, 0x46, 4, 0, 0, 0, 0x47, 0x50, 0x53, 0x21]; // "EXIF" chunk holding "GPS!"
    const webp = testPhoto('webp');
    const body = [...webp.subarray(12), ...exif];
    const tagged = new Uint8Array([...webp.subarray(0, 4), 4 + body.length, 0, 0, 0, ...webp.subarray(8, 12), ...body]);
    const data = closetWith([makeItem({ id: 't' })]);
    const zip = manifestZip({ format: BACKUP_FORMAT, closet: data }, { 'images/t.webp': tagged });
    return readBackup(zip)
      .images.get('images/t.webp')!
      .arrayBuffer()
      .then((buf) => expect(new Uint8Array(buf)).toEqual(webp));
  });

  it('removes the GPS location from a real photo when restoring', async () => {
    const data = closetWith([makeItem({ id: 'p', image: 'images/p.jpg' })]);
    const zip = manifestZip({ format: BACKUP_FORMAT, closet: data }, { 'images/p.jpg': gpsJpeg });
    const restored = await blobToBytes(readBackup(zip).images.get('images/p.jpg')!);
    // EXIF stores the location as numeric tags inside the "Exif" block, next to the camera name.
    for (const marker of ['Exif', 'TestCam']) {
      expect(String.fromCharCode(...gpsJpeg)).toContain(marker);
      expect(String.fromCharCode(...restored)).not.toContain(marker);
    }
  });

  it('rejects a photo that is not the image type its name says', () => {
    const data = closetWith([makeItem({ id: 't' })]);
    const zip = manifestZip({ format: BACKUP_FORMAT, closet: data }, { 'images/t.webp': testPhoto('jpg') });
    expect(() => readBackup(zip)).toThrow(InvalidBackupError);
    expect(() => readBackup(zip)).toThrow('images/t.webp: not a WebP image');
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
    // Hold the first photo read until the delete has finished, so without the queue
    // the export would find the last photo ('b') already gone.
    let releaseRead: () => void = () => undefined;
    const readHeld = new Promise<void>((r) => (releaseRead = r));
    const read = store.read.bind(store);
    let firstImageRead = true;
    vi.spyOn(store, 'read').mockImplementation(async (path) => {
      if (path.startsWith('images/') && firstImageRead) {
        firstImageRead = false;
        await Promise.race([readHeld, new Promise((r) => setTimeout(r, 50))]);
      }
      return read(path);
    });
    const exporting = exportBackup(repo, NOW); // queued first, so it sees the closet before the delete
    const deleting = repo.deleteItems(['b']).then(() => releaseRead());
    const { zip } = await exporting;
    await deleting;
    const { closet, images } = readBackup(zip);
    expect(closet.items.map((i) => i.id)).toEqual(['t', 'b']);
    expect([...images.keys()].sort()).toEqual(['images/b.jpg', 'images/t.webp']);
    expect(store.files.has('images/b.jpg')).toBe(false);
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
    const zip = manifestZip({ format: BACKUP_FORMAT, closet: longName }, { 'images/t.webp': testPhoto('webp') });
    expect(() => readBackup(zip)).toThrow(InvalidBackupError);
    expect(() => readBackup(zip)).toThrow('name is too long');

    const tooManyOutfits = { ...many, outfits: Array.from({ length: MAX_OUTFITS + 1 }, () => ({})) };
    expect(() => readBackup(manifestZip({ format: BACKUP_FORMAT, closet: tooManyOutfits }))).toThrow('outfits');

    const tooManyLooks = { ...many, aiLooks: Array.from({ length: MAX_LOOKS + 1 }, () => ({})) };
    expect(() => readBackup(manifestZip({ format: BACKUP_FORMAT, closet: tooManyLooks }))).toThrow('AI looks');
  });

  it('ignores unrelated files and rejects oversized entries', () => {
    const data = closetWith([makeItem({ id: 't' })]);
    const manifest = strToU8(JSON.stringify({ format: BACKUP_FORMAT, exportedAt: NOW, closet: data }));
    const ok = zipSync({ 'closet.json': manifest, 'images/t.webp': testPhoto('webp'), '../evil.sh': strToU8('x') });
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
