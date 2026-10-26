import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_DOLL_URL } from '../app/doll';
import { ClosetChangedElsewhereError } from '../storage/repository';
import { closetWith, fakeImageDeps, renderWithCloset, withDoll } from '../test/fixtures';
import { DollPanel } from './DollPanel';

const picture = () => new File(['raw'], 'doll.png', { type: 'image/png' });

function dollFiles(store: { files: Map<string, Blob> }): string[] {
  return [...store.files.keys()].filter((k) => k.startsWith('images/doll-'));
}

describe('DollPanel', () => {
  it('shows the bundled doll, with no way back to it while it is in use', async () => {
    await renderWithCloset(<DollPanel imageDeps={fakeImageDeps()} />);
    expect(screen.getByRole('img', { name: 'הבובה הרגילה' })).toHaveAttribute('src', DEFAULT_DOLL_URL);
    expect(screen.queryByRole('button', { name: 'לבובה הרגילה' })).not.toBeInTheDocument();
  });

  it('replaces the doll after the parent confirms the new picture', async () => {
    const user = userEvent.setup();
    const { repo, store } = await renderWithCloset(<DollPanel imageDeps={fakeImageDeps()} />);
    await user.upload(screen.getByLabelText('בחירת תמונת בובה'), picture());

    expect(await screen.findByRole('heading', { name: 'להחליף את הבובה?' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'הבובה החדשה' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'כן, להחליף' }));

    expect(await screen.findByText('הבובה הוחלפה.')).toBeInTheDocument();
    expect(repo.getData().doll.image).toMatch(/^images\/doll-.+\.webp$/);
    expect(dollFiles(store)).toEqual([repo.getData().doll.image]);
    expect(await screen.findByRole('img', { name: 'הבובה שבחרת' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'לבובה הרגילה' })).toBeInTheDocument();
  });

  it('keeps the doll when the parent cancels', async () => {
    const user = userEvent.setup();
    const { repo, store } = await renderWithCloset(<DollPanel imageDeps={fakeImageDeps()} />);
    await user.upload(screen.getByLabelText('בחירת תמונת בובה'), picture());
    await user.click(await screen.findByRole('button', { name: 'ביטול' }));
    expect(screen.queryByRole('heading', { name: 'להחליף את הבובה?' })).not.toBeInTheDocument();
    expect(repo.getData().doll.image).toBeNull();
    expect(dollFiles(store)).toEqual([]);
  });

  it('keeps more detail than a garment photo (longer side up to 1024 px)', async () => {
    const user = userEvent.setup();
    const deps = fakeImageDeps({ decode: vi.fn().mockResolvedValue({ width: 1500, height: 2000, release: vi.fn() }) });
    await renderWithCloset(<DollPanel imageDeps={deps} />);
    await user.upload(screen.getByLabelText('בחירת תמונת בובה'), picture());
    await screen.findByRole('heading', { name: 'להחליף את הבובה?' });
    expect(deps.draw).toHaveBeenCalledWith(expect.anything(), { width: 768, height: 1024 });
  });

  it('goes back to the bundled doll after asking, and deletes the picture', async () => {
    const user = userEvent.setup();
    const { repo, store } = await renderWithCloset(<DollPanel imageDeps={fakeImageDeps()} />, withDoll(closetWith([])));
    expect(await screen.findByRole('img', { name: 'הבובה שבחרת' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'לבובה הרגילה' }));
    expect(screen.getByRole('heading', { name: 'לחזור לבובה הרגילה?' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'כן, לחזור' }));

    expect(await screen.findByText('חזרנו לבובה הרגילה.')).toBeInTheDocument();
    expect(repo.getData().doll.image).toBeNull();
    expect(dollFiles(store)).toEqual([]);
    expect(screen.getByRole('img', { name: 'הבובה הרגילה' })).toBeInTheDocument();
  });

  it('says so when the picture cannot be read', async () => {
    const user = userEvent.setup();
    const deps = fakeImageDeps({ decode: vi.fn().mockRejectedValue(new Error('bad file')) });
    await renderWithCloset(<DollPanel imageDeps={deps} />);
    await user.upload(screen.getByLabelText('בחירת תמונת בובה'), picture());
    expect(await screen.findByText('לא הצלחנו לקרוא את התמונה.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'להחליף את הבובה?' })).not.toBeInTheDocument();
  });

  it('says so when saving fails, and keeps the old doll', async () => {
    const user = userEvent.setup();
    const { repo } = await renderWithCloset(<DollPanel imageDeps={fakeImageDeps()} />);
    vi.spyOn(repo, 'setDoll').mockRejectedValue(new Error('disk full'));
    await user.upload(screen.getByLabelText('בחירת תמונת בובה'), picture());
    await user.click(await screen.findByRole('button', { name: 'כן, להחליף' }));
    expect(await screen.findByText('השמירה לא הצליחה. נסי שוב.')).toBeInTheDocument();
    expect(repo.getData().doll.image).toBeNull();
  });

  it('leaves the message to the app when another window saved first', async () => {
    const user = userEvent.setup();
    const { repo } = await renderWithCloset(<DollPanel imageDeps={fakeImageDeps()} />, withDoll(closetWith([])));
    vi.spyOn(repo, 'resetDoll').mockRejectedValue(new ClosetChangedElsewhereError());
    await user.click(await screen.findByRole('button', { name: 'לבובה הרגילה' }));
    await user.click(screen.getByRole('button', { name: 'כן, לחזור' }));
    await waitFor(() => expect(screen.getByText(/הארון השתנה בחלון אחר/)).toBeInTheDocument());
    expect(screen.queryByText('השמירה לא הצליחה. נסי שוב.')).not.toBeInTheDocument();
  });
});
