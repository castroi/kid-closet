import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ClosetChangedElsewhereError } from '../storage/repository';
import { makeOutfit, renderWithCloset, sampleCloset } from '../test/fixtures';
import { Favorites } from './Favorites';

function closetWithTwoLooks() {
  const data = sampleCloset();
  data.outfits.push(makeOutfit({ id: 'o2', occasion: 'party', topId: 'tParty', bottomId: 'bParty' }));
  return data;
}

describe('Favorites', () => {
  it('lists saved looks and filters by occasion', async () => {
    const user = userEvent.setup();
    await renderWithCloset(<Favorites onOpen={vi.fn()} />, closetWithTwoLooks());
    expect(screen.getAllByRole('button', { name: /^פתיחת הלוק/ })).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'חגיגי' }));
    expect(screen.getAllByRole('button', { name: /^פתיחת הלוק/ })).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'יום רגיל' }));
    expect(screen.getByText('אין לוקים שמורים כאן.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'הכל' }));
    expect(screen.getAllByRole('button', { name: /^פתיחת הלוק/ })).toHaveLength(2);
  });

  it('opens a look', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    await renderWithCloset(<Favorites onOpen={onOpen} />, sampleCloset());
    await user.click(screen.getByRole('button', { name: 'פתיחת הלוק: סוודר צהוב, חולצה כחולה, ג׳ינס' }));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'o1' }));
  });

  it('removes a look', async () => {
    const user = userEvent.setup();
    const { repo } = await renderWithCloset(<Favorites onOpen={vi.fn()} />, sampleCloset());
    await user.click(screen.getByRole('button', { name: /^הסרה מהמועדפים/ }));
    expect(repo.getData().outfits).toEqual([]);
    expect(await screen.findByText(/עוד אין לוקים שמורים/)).toBeInTheDocument();
  });

  it('brings a removed look back with undo', async () => {
    const user = userEvent.setup();
    const { repo } = await renderWithCloset(<Favorites onOpen={vi.fn()} />, sampleCloset());
    const [before] = repo.getData().outfits;
    await user.click(screen.getByRole('button', { name: /^הסרה מהמועדפים/ }));
    expect(await screen.findByText('הלוק הוסר מהמועדפים')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'ביטול' }));
    expect(await screen.findByRole('button', { name: /^פתיחת הלוק/ })).toBeInTheDocument();
    expect(repo.getData().outfits).toEqual([
      expect.objectContaining({ occasion: before.occasion, layerId: before.layerId, topId: before.topId, bottomId: before.bottomId }),
    ]);
    expect(screen.queryByText('הלוק הוסר מהמועדפים')).not.toBeInTheDocument();
  });

  it('keeps the look and says so when removing fails', async () => {
    const user = userEvent.setup();
    const { repo } = await renderWithCloset(<Favorites onOpen={vi.fn()} />, sampleCloset());
    vi.spyOn(repo, 'update').mockRejectedValueOnce(new Error('disk full'));
    await user.click(screen.getByRole('button', { name: /^הסרה מהמועדפים/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('לא הצלחנו להסיר את הלוק. נסי שוב.');
    expect(screen.getByRole('button', { name: /^פתיחת הלוק/ })).toBeInTheDocument();
    expect(screen.queryByText('הלוק הוסר מהמועדפים')).not.toBeInTheDocument();
    // The next tap clears the message and works.
    await user.click(screen.getByRole('button', { name: /^הסרה מהמועדפים/ }));
    expect(await screen.findByText('הלוק הוסר מהמועדפים')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('says so when undo fails', async () => {
    const user = userEvent.setup();
    const { repo } = await renderWithCloset(<Favorites onOpen={vi.fn()} />, sampleCloset());
    await user.click(screen.getByRole('button', { name: /^הסרה מהמועדפים/ }));
    await screen.findByText('הלוק הוסר מהמועדפים');
    vi.spyOn(repo, 'update').mockRejectedValueOnce(new Error('disk full'));
    await user.click(screen.getByRole('button', { name: 'ביטול' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('לא הצלחנו להחזיר את הלוק. נסי שוב.');
    expect(screen.getByText('הלוק הוסר מהמועדפים')).toBeInTheDocument(); // she can try again
  });

  it('adds no second message when the "changed in another window" notice explains it', async () => {
    const user = userEvent.setup();
    const { repo } = await renderWithCloset(<Favorites onOpen={vi.fn()} />, sampleCloset());
    vi.spyOn(repo, 'update').mockRejectedValueOnce(new ClosetChangedElsewhereError());
    await user.click(screen.getByRole('button', { name: /^הסרה מהמועדפים/ }));
    expect(await screen.findByText(/הארון השתנה בחלון אחר/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('disables the heart while the removal is saving', async () => {
    const user = userEvent.setup();
    const { repo } = await renderWithCloset(<Favorites onOpen={vi.fn()} />, sampleCloset());
    let finish: () => void = () => undefined;
    const update = repo.update.bind(repo);
    vi.spyOn(repo, 'update').mockImplementationOnce(async (change) => {
      await new Promise<void>((r) => (finish = r));
      return update(change);
    });
    await user.click(screen.getByRole('button', { name: /^הסרה מהמועדפים/ }));
    expect(screen.getByRole('button', { name: /^הסרה מהמועדפים/ })).toBeDisabled();
    finish();
    expect(await screen.findByText('הלוק הוסר מהמועדפים')).toBeInTheDocument();
  });
});
