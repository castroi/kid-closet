import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
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
});
