import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it, vi } from 'vitest';
import type { ShareEnv } from '../app/device';
import { MAX_BACKUP_FILE_BYTES, backupFileName, exportBackup } from '../storage/backup';
import { ClosetRepository } from '../storage/repository';
import { NOW, closetWith, fakeImageDeps, makeItem, makeLook, renderWithCloset, sampleCloset, seededStore, testPhoto } from '../test/fixtures';
import { AboutApp, Parent, randomQuestion } from './Parent';

const TODAY = () => new Date('2026-10-24T08:00:00Z');

function env(overrides: Partial<ShareEnv> = {}): ShareEnv {
  return { download: vi.fn(), ...overrides };
}

async function openTools(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('כדי להיכנס, כמה זה 7 × 8?'), '56');
  await user.click(screen.getByRole('button', { name: 'כניסה' }));
}

describe('Parent', () => {
  it('asks a question before showing the tools', async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    await renderWithCloset(<Parent imageDeps={fakeImageDeps()} onBack={onBack} shareEnv={env()} question={[7, 8]} now={TODAY} />, sampleCloset());
    await user.type(screen.getByLabelText('כדי להיכנס, כמה זה 7 × 8?'), '54');
    await user.click(screen.getByRole('button', { name: 'כניסה' }));
    expect(screen.getByText('לא נכון')).toBeInTheDocument();
    await user.clear(screen.getByLabelText(/כמה זה/));
    await openTools(user);
    expect(screen.getByRole('heading', { name: 'גיבוי' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'בובה ו־AI' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'חזרה לארון' }));
    expect(onBack).toHaveBeenCalled();
  });

  it('opens "לוקים לתיקון" and "הגדרות AI" as their own screens, and comes back', async () => {
    const user = userEvent.setup();
    await renderWithCloset(<Parent imageDeps={fakeImageDeps()} onBack={vi.fn()} shareEnv={env()} question={[7, 8]} now={TODAY} />, sampleCloset());
    await openTools(user);
    await user.click(screen.getByRole('button', { name: 'לוקים לתיקון (0)' }));
    expect(screen.getByRole('heading', { level: 1, name: 'לוקים לתיקון' })).toBeInTheDocument();
    expect(screen.getByText(/אין לוקים לתיקון/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'חזרה לאזור הורים' }));
    await user.click(screen.getByRole('button', { name: 'הגדרות AI' }));
    expect(screen.getByRole('heading', { level: 1, name: 'הגדרות AI' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'חזרה לאזור הורים' }));
    expect(screen.getByRole('heading', { level: 1, name: 'אזור הורים' })).toBeInTheDocument();
  });

  it('generates questions between 6 and 9', () => {
    for (let i = 0; i < 20; i++) {
      for (const n of randomQuestion()) {
        expect(n).toBeGreaterThanOrEqual(6);
        expect(n).toBeLessThanOrEqual(9);
      }
    }
  });

  it('exports a backup and records the date', async () => {
    const user = userEvent.setup();
    const shareEnv = env();
    const { repo } = await renderWithCloset(
      <Parent imageDeps={fakeImageDeps()} onBack={vi.fn()} shareEnv={shareEnv} question={[7, 8]} now={TODAY} />,
      sampleCloset(),
    );
    await openTools(user);
    expect(screen.getByText(/עוד לא נעשה גיבוי/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'ייצוא גיבוי' }));
    expect(await screen.findByText(/הגיבוי נוצר/)).toBeInTheDocument();
    // Named by the phone's local date, so compute it the same way rather than assume a time zone.
    expect(shareEnv.download).toHaveBeenCalledWith(expect.objectContaining({ name: backupFileName(TODAY()) }));
    expect(repo.getData().lastBackupAt).toBe(NOW);
    expect(screen.queryByText(/עוד לא נעשה גיבוי/)).not.toBeInTheDocument();
  });

  it('does not record a backup when sharing is cancelled', async () => {
    const user = userEvent.setup();
    const abort = Object.assign(new Error('x'), { name: 'AbortError' });
    const shareEnv = env({ canShare: () => true, share: vi.fn().mockRejectedValue(abort) });
    const { repo } = await renderWithCloset(
      <Parent imageDeps={fakeImageDeps()} onBack={vi.fn()} shareEnv={shareEnv} question={[7, 8]} now={TODAY} />,
      sampleCloset(),
    );
    await openTools(user);
    await user.click(screen.getByRole('button', { name: 'ייצוא גיבוי' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'ייצוא גיבוי' })).toBeEnabled());
    expect(repo.getData().lastBackupAt).toBeNull();
  });

  it('offers a second tap when Safari blocks the share sheet', async () => {
    const user = userEvent.setup();
    const blocked = Object.assign(new Error('x'), { name: 'NotAllowedError' });
    const share = vi.fn().mockRejectedValueOnce(blocked).mockResolvedValueOnce(undefined);
    const { repo } = await renderWithCloset(
      <Parent imageDeps={fakeImageDeps()} onBack={vi.fn()} shareEnv={env({ canShare: () => true, share })} question={[7, 8]} now={TODAY} />,
      sampleCloset(),
    );
    await openTools(user);
    await user.click(screen.getByRole('button', { name: 'ייצוא גיבוי' }));
    await user.click(await screen.findByRole('button', { name: 'שיתוף הגיבוי' }));
    expect(await screen.findByText(/הגיבוי נוצר/)).toBeInTheDocument();
    expect(share).toHaveBeenCalledTimes(2);
    expect(repo.getData().lastBackupAt).toBe(NOW);
    expect(screen.queryByRole('button', { name: 'שיתוף הגיבוי' })).not.toBeInTheDocument();
  });

  it('still reports the backup as made when only saving its date fails', async () => {
    const user = userEvent.setup();
    const shareEnv = env();
    const { repo } = await renderWithCloset(
      <Parent imageDeps={fakeImageDeps()} onBack={vi.fn()} shareEnv={shareEnv} question={[7, 8]} now={TODAY} />,
      sampleCloset(),
    );
    vi.spyOn(repo, 'update').mockRejectedValue(new Error('disk full'));
    await openTools(user);
    await user.click(screen.getByRole('button', { name: 'ייצוא גיבוי' }));
    expect(await screen.findByText(/הגיבוי נוצר/)).toBeInTheDocument();
    expect(screen.queryByText('יצירת הגיבוי נכשלה.')).not.toBeInTheDocument();
    expect(shareEnv.download).toHaveBeenCalled();
  });

  it('refuses a backup file too large to restore without reading it', async () => {
    const user = userEvent.setup();
    await renderWithCloset(<Parent imageDeps={fakeImageDeps()} onBack={vi.fn()} shareEnv={env()} question={[7, 8]} now={TODAY} />, sampleCloset());
    await openTools(user);
    const file = new File(['x'], 'huge.zip', { type: 'application/zip' });
    Object.defineProperty(file, 'size', { value: MAX_BACKUP_FILE_BYTES + 1 });
    await user.upload(screen.getByLabelText('שחזור מגיבוי'), file);
    expect(await screen.findByText('קובץ הגיבוי גדול מדי לשחזור בטלפון.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('reports a backup file that cannot be read', async () => {
    const user = userEvent.setup();
    await renderWithCloset(<Parent imageDeps={fakeImageDeps()} onBack={vi.fn()} shareEnv={env()} question={[7, 8]} now={TODAY} />, sampleCloset());
    await openTools(user);
    const file = new File(['x'], 'b.zip', { type: 'application/zip' });
    Object.defineProperty(file, 'arrayBuffer', { value: () => Promise.reject(new Error('NotReadableError')) });
    await user.upload(screen.getByLabelText('שחזור מגיבוי'), file);
    expect(await screen.findByText('השחזור נכשל.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('reports a failed export', async () => {
    const user = userEvent.setup();
    const shareEnv = env({ download: vi.fn(() => { throw new Error('no'); }) });
    await renderWithCloset(<Parent imageDeps={fakeImageDeps()} onBack={vi.fn()} shareEnv={shareEnv} question={[7, 8]} now={TODAY} />, sampleCloset());
    await openTools(user);
    await user.click(screen.getByRole('button', { name: 'ייצוא גיבוי' }));
    expect(await screen.findByText('יצירת הגיבוי נכשלה.')).toBeInTheDocument();
  });

  it('restores from a backup after confirmation', async () => {
    const user = userEvent.setup();
    const source = new ClosetRepository(seededStore(closetWith([makeItem({ id: 'fromBackup', name: 'מהגיבוי' })])), () => NOW);
    await source.load();
    const zip = (await exportBackup(source, NOW)).zip;

    const { repo } = await renderWithCloset(
      <Parent imageDeps={fakeImageDeps()} onBack={vi.fn()} shareEnv={env()} question={[7, 8]} now={TODAY} />,
      sampleCloset(),
    );
    await openTools(user);
    await user.upload(screen.getByLabelText('שחזור מגיבוי'), new File([zip as BlobPart], 'b.zip', { type: 'application/zip' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'לשחזר מהגיבוי?' }));
    await user.click(dialog.getByRole('button', { name: 'כן, לשחזר' }));
    expect(await screen.findByText('השחזור הושלם.')).toBeInTheDocument();
    expect(repo.getData().items.map((i) => i.id)).toEqual(['fromBackup']);
  });

  it('rejects a file that is not a backup', async () => {
    const user = userEvent.setup();
    await renderWithCloset(<Parent imageDeps={fakeImageDeps()} onBack={vi.fn()} shareEnv={env()} question={[7, 8]} now={TODAY} />, sampleCloset());
    await openTools(user);
    const notBackup = zipSync({ 'x.txt': strToU8('x') });
    await user.upload(screen.getByLabelText('שחזור מגיבוי'), new File([notBackup as BlobPart], 'x.zip', { type: 'application/zip' }));
    await user.click(await screen.findByRole('button', { name: 'כן, לשחזר' }));
    expect(await screen.findByText('הקובץ הזה אינו גיבוי תקין של הארון.')).toBeInTheDocument();
  });

  it('can cancel a restore', async () => {
    const user = userEvent.setup();
    await renderWithCloset(<Parent imageDeps={fakeImageDeps()} onBack={vi.fn()} shareEnv={env()} question={[7, 8]} now={TODAY} />, sampleCloset());
    await openTools(user);
    await user.upload(screen.getByLabelText('שחזור מגיבוי'), new File(['x'], 'x.zip', { type: 'application/zip' }));
    await user.click(await screen.findByRole('button', { name: 'ביטול' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('deletes checked items only after confirmation', async () => {
    const user = userEvent.setup();
    const { repo } = await renderWithCloset(
      <Parent imageDeps={fakeImageDeps()} onBack={vi.fn()} shareEnv={env()} question={[7, 8]} now={TODAY} />,
      sampleCloset(),
    );
    await openTools(user);
    const deleteBtn = screen.getByRole('button', { name: 'מחיקת המסומנים (0)' });
    expect(deleteBtn).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: /חולצה ישנה/ }));
    await user.click(screen.getByRole('checkbox', { name: /שורטס/ }));
    await user.click(screen.getByRole('checkbox', { name: /שורטס/ }));
    await user.click(screen.getByRole('button', { name: 'מחיקת המסומנים (1)' }));

    const dialog = within(screen.getByRole('dialog', { name: 'למחוק 1 בגדים?' }));
    await user.click(dialog.getByRole('button', { name: 'לא, להשאיר' }));
    expect(repo.getData().items).toHaveLength(10);

    await user.click(screen.getByRole('button', { name: 'מחיקת המסומנים (1)' }));
    await user.click(screen.getByRole('button', { name: 'כן, למחוק' }));
    expect(await screen.findByText('נמחקו 1 בגדים.')).toBeInTheDocument();
    expect(repo.getData().items.map((i) => i.id)).not.toContain('old');
  });

  it('shows storage status', async () => {
    const user = userEvent.setup();
    const storage = { persisted: async () => true, estimate: async () => ({ usage: 1_572_864 }) };
    await renderWithCloset(
      <Parent imageDeps={fakeImageDeps()} onBack={vi.fn()} shareEnv={env()} storage={storage} question={[7, 8]} now={TODAY} />,
      sampleCloset(),
    );
    await openTools(user);
    expect(await screen.findByText('מאושרת')).toBeInTheDocument();
    expect(screen.getByText('1.50 MB')).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
  });

  it('handles an empty closet', async () => {
    const user = userEvent.setup();
    await renderWithCloset(<Parent imageDeps={fakeImageDeps()} onBack={vi.fn()} shareEnv={env()} question={[7, 8]} now={TODAY} />);
    await openTools(user);
    expect(screen.getByText('אין בגדים.')).toBeInTheDocument();
    expect(screen.queryByText(/עוד לא נעשה גיבוי/)).not.toBeInTheDocument();
    expect(screen.getAllByText('לא ידוע')).toHaveLength(2);
  });
});

describe('AboutApp', () => {
  const SHA = 'd8d5480aa1b2c3d4e5f60718293a4b5c6d7e8f90';

  it('shows the version and links the commit and the code on GitHub', () => {
    render(<AboutApp info={{ version: '1.4.0', commit: SHA }} />);
    expect(screen.getByText(/1\.4\.0/)).toBeInTheDocument();
    const commit = screen.getByRole('link', { name: 'השינויים בגרסה 1.4.0 ב־GitHub (d8d5480)' });
    expect(commit).toHaveAttribute('href', `https://github.com/castroi/kid-closet/commit/${SHA}`);
    expect(commit).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByRole('link', { name: 'הקוד של האפליקציה ב־GitHub' })).toHaveAttribute(
      'href',
      'https://github.com/castroi/kid-closet',
    );
  });

  it('shows just the version when the build has no commit', () => {
    render(<AboutApp info={{ version: 'dev', commit: '' }} />);
    expect(screen.getByText('dev')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /השינויים בגרסה/ })).not.toBeInTheDocument();
  });
});

describe('Parent: AI looks and backups', () => {
  it('backs up AI looks and says when one had to be left out', async () => {
    const user = userEvent.setup();
    const shareEnv = env();
    const data = { ...sampleCloset(), aiLooks: [makeLook({ id: 'l1' }), makeLook({ id: 'l2', bottomId: 'bShorts' })] };
    const { store } = await renderWithCloset(
      <Parent imageDeps={fakeImageDeps()} onBack={vi.fn()} shareEnv={shareEnv} question={[7, 8]} now={TODAY} />,
      data,
    );
    // l2's picture is on the phone; l1's was lost.
    store.files.set('images/look-l2.webp', new Blob([testPhoto('webp') as BlobPart], { type: 'image/webp' }));
    await openTools(user);
    expect(screen.getByText(/כולל הבובה ותמונות ה־AI/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'ייצוא גיבוי' }));
    expect(await screen.findByText(/תמונת AI ישנה אחת לא נכנסה לגיבוי/)).toBeInTheDocument();
    expect(shareEnv.download).toHaveBeenCalled();
  });
});
