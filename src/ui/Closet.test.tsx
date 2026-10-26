import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ClosetChangedElsewhereError } from '../storage/repository';
import { renderWithCloset, sampleCloset } from '../test/fixtures';
import { Closet } from './Closet';

describe('Closet', () => {
  it('lists items by category and counts active ones', async () => {
    const user = userEvent.setup();
    await renderWithCloset(<Closet onOpenParent={vi.fn()} onOpenSettings={vi.fn()} />, sampleCloset());
    expect(screen.getByText('9 בגדים בארון')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'חולצות (4)' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'עריכת חולצה כחולה' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'קטן עליי (1)' }));
    expect(screen.getByRole('button', { name: 'עריכת חולצה ישנה' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'עריכת חולצה כחולה' })).not.toBeInTheDocument();
  });

  it('moves selected items to outgrown, with undo', async () => {
    const user = userEvent.setup();
    const { repo } = await renderWithCloset(<Closet onOpenParent={vi.fn()} onOpenSettings={vi.fn()} />, sampleCloset());
    await user.click(screen.getByRole('button', { name: 'בחירה' }));
    const move = screen.getByRole('button', { name: 'העברה ל"קטן עליי" (0)' });
    expect(move).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'חולצה כחולה' }));
    await user.click(screen.getByRole('button', { name: 'חולצה לבנה' }));
    expect(screen.getByText('נבחרו 2')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'העברה ל"קטן עליי" (2)' }));

    expect(await screen.findByText('הועבר ל"קטן עליי" (2)')).toBeInTheDocument();
    expect(repo.getData().items.filter((i) => i.status === 'outgrown')).toHaveLength(3);

    await user.click(screen.getByRole('button', { name: 'ביטול' }));
    expect(repo.getData().items.filter((i) => i.status === 'outgrown')).toHaveLength(1);
  });

  it('clears the selection when switching tabs', async () => {
    const user = userEvent.setup();
    await renderWithCloset(<Closet onOpenParent={vi.fn()} onOpenSettings={vi.fn()} />, sampleCloset());
    await user.click(screen.getByRole('button', { name: 'בחירה' }));
    await user.click(screen.getByRole('button', { name: 'חולצה כחולה' }));
    await user.click(screen.getByRole('button', { name: 'מכנסיים (3)' }));
    expect(screen.getByRole('button', { name: 'העברה ל"קטן עליי" (0)' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'ביטול' }));
    expect(screen.getByRole('button', { name: 'בחירה' })).toBeInTheDocument();
  });

  it('brings items back from outgrown', async () => {
    const user = userEvent.setup();
    const { repo } = await renderWithCloset(<Closet onOpenParent={vi.fn()} onOpenSettings={vi.fn()} />, sampleCloset());
    await user.click(screen.getByRole('button', { name: 'קטן עליי (1)' }));
    await user.click(screen.getByRole('button', { name: 'בחירה' }));
    await user.click(screen.getByRole('button', { name: 'חולצה ישנה' }));
    await user.click(screen.getByRole('button', { name: 'החזרה לארון (1)' }));
    expect(await screen.findByText('הוחזר לארון (1)')).toBeInTheDocument();
    expect(repo.getData().items.every((i) => i.status === 'active')).toBe(true);
    expect(screen.getByText(/בגדים שקטנים עלייך יופיעו כאן/)).toBeInTheDocument();
  });

  it('edits an item', async () => {
    const user = userEvent.setup();
    const { repo } = await renderWithCloset(<Closet onOpenParent={vi.fn()} onOpenSettings={vi.fn()} />, sampleCloset());
    await user.click(screen.getByRole('button', { name: 'עריכת חולצה כחולה' }));
    const dialog = within(screen.getByRole('dialog', { name: 'עריכת בגד' }));
    await user.click(dialog.getByRole('button', { name: 'יום רגיל' }));
    await user.clear(dialog.getByRole('textbox'));
    await user.type(dialog.getByRole('textbox'), 'החולצה עם הכוכבים');
    await user.click(dialog.getByRole('button', { name: 'ורוד' }));
    await user.click(dialog.getByRole('button', { name: 'שמירה' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(repo.getData().items.find((i) => i.id === 'tBlue')).toMatchObject({
      name: 'החולצה עם הכוכבים',
      colorGroup: 'pink',
      occasions: ['school', 'casual'],
    });
  });

  it('requires at least one occasion when editing', async () => {
    const user = userEvent.setup();
    await renderWithCloset(<Closet onOpenParent={vi.fn()} onOpenSettings={vi.fn()} />, sampleCloset());
    await user.click(screen.getByRole('button', { name: 'עריכת חולצה כחולה' }));
    const dialog = within(screen.getByRole('dialog', { name: 'עריכת בגד' }));
    await user.click(dialog.getByRole('button', { name: 'בית ספר' }));
    expect(dialog.getByText('חסר: לאן לובשים')).toBeInTheDocument();
    expect(dialog.getByRole('button', { name: 'שמירה' })).toBeDisabled();
  });

  it('marks one item as outgrown from the editor', async () => {
    const user = userEvent.setup();
    const { repo } = await renderWithCloset(<Closet onOpenParent={vi.fn()} onOpenSettings={vi.fn()} />, sampleCloset());
    await user.click(screen.getByRole('button', { name: 'עריכת חולצה כחולה' }));
    await user.click(screen.getByRole('button', { name: 'קטן עליי' }));
    expect(repo.getData().items.find((i) => i.id === 'tBlue')?.status).toBe('outgrown');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows a failed "outgrown" inside the editor, where she is looking', async () => {
    const user = userEvent.setup();
    const { repo } = await renderWithCloset(<Closet onOpenParent={vi.fn()} onOpenSettings={vi.fn()} />, sampleCloset());
    vi.spyOn(repo, 'update').mockRejectedValueOnce(new Error('disk full'));
    await user.click(screen.getByRole('button', { name: 'עריכת חולצה כחולה' }));
    const dialog = within(screen.getByRole('dialog'));
    await user.click(dialog.getByRole('button', { name: 'קטן עליי' }));
    expect(await dialog.findByRole('alert')).toHaveTextContent('לא הצלחנו לשמור. נסי שוב.');
    expect(repo.getData().items.find((i) => i.id === 'tBlue')?.status).toBe('active');
    // She can try again from the same sheet.
    expect(dialog.getByRole('button', { name: 'קטן עליי' })).toBeEnabled();
    await user.click(dialog.getByRole('button', { name: 'קטן עליי' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(repo.getData().items.find((i) => i.id === 'tBlue')?.status).toBe('outgrown');
  });

  it('shows a failed move next to the move button', async () => {
    const user = userEvent.setup();
    const { repo } = await renderWithCloset(<Closet onOpenParent={vi.fn()} onOpenSettings={vi.fn()} />, sampleCloset());
    vi.spyOn(repo, 'update').mockRejectedValueOnce(new Error('disk full'));
    await user.click(screen.getByRole('button', { name: 'בחירה' }));
    await user.click(screen.getByRole('button', { name: 'חולצה כחולה' }));
    const moveButton = screen.getByRole('button', { name: 'העברה ל"קטן עליי" (1)' });
    await user.click(moveButton);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('לא הצלחנו לשמור. נסי שוב.');
    expect(alert.parentElement).toBe(moveButton.parentElement); // in the action bar, not below the list
  });

  it('clears an old error once she moves on', async () => {
    const user = userEvent.setup();
    const { repo } = await renderWithCloset(<Closet onOpenParent={vi.fn()} onOpenSettings={vi.fn()} />, sampleCloset());
    const failOnce = () => vi.spyOn(repo, 'update').mockRejectedValueOnce(new Error('disk full'));

    failOnce();
    await user.click(screen.getByRole('button', { name: 'בחירה' }));
    await user.click(screen.getByRole('button', { name: 'חולצה כחולה' }));
    await user.click(screen.getByRole('button', { name: 'העברה ל"קטן עליי" (1)' }));
    await screen.findByRole('alert');
    await user.click(screen.getByRole('button', { name: 'מכנסיים (3)' })); // another tab
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    failOnce();
    await user.click(screen.getByRole('button', { name: 'ג׳ינס' }));
    await user.click(screen.getByRole('button', { name: 'העברה ל"קטן עליי" (1)' }));
    await screen.findByRole('alert');
    await user.click(screen.getByRole('button', { name: 'ביטול' })); // leaves selection mode
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'בחירה' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows a failed undo next to the undo toast', async () => {
    const user = userEvent.setup();
    const { repo } = await renderWithCloset(<Closet onOpenParent={vi.fn()} onOpenSettings={vi.fn()} />, sampleCloset());
    await user.click(screen.getByRole('button', { name: 'עריכת חולצה כחולה' }));
    await user.click(screen.getByRole('button', { name: 'קטן עליי' }));
    await screen.findByText('הועבר ל"קטן עליי" (1)');
    vi.spyOn(repo, 'update').mockRejectedValueOnce(new Error('disk full'));
    await user.click(screen.getByRole('button', { name: 'ביטול' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('לא הצלחנו לבטל. נסי שוב.');
    expect(alert.parentElement).toBe(screen.getByText('הועבר ל"קטן עליי" (1)').closest('.action-bar'));
    expect(repo.getData().items.find((i) => i.id === 'tBlue')?.status).toBe('outgrown');
  });

  it('adds no second message when the "changed in another window" notice explains it', async () => {
    const user = userEvent.setup();
    const { repo } = await renderWithCloset(<Closet onOpenParent={vi.fn()} onOpenSettings={vi.fn()} />, sampleCloset());
    vi.spyOn(repo, 'update').mockRejectedValueOnce(new ClosetChangedElsewhereError());
    await user.click(screen.getByRole('button', { name: 'עריכת חולצה כחולה' }));
    await user.click(screen.getByRole('button', { name: 'קטן עליי' }));
    expect(await screen.findByText(/הארון השתנה בחלון אחר/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('opens the parent area and the settings', async () => {
    const user = userEvent.setup();
    const onOpenParent = vi.fn();
    const onOpenSettings = vi.fn();
    await renderWithCloset(<Closet onOpenParent={onOpenParent} onOpenSettings={onOpenSettings} />, sampleCloset());
    await user.click(screen.getByRole('button', { name: 'אזור הורים' }));
    expect(onOpenParent).toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'הגדרות' }));
    expect(onOpenSettings).toHaveBeenCalled();
  });

  it('shows an empty state', async () => {
    await renderWithCloset(<Closet onOpenParent={vi.fn()} onOpenSettings={vi.fn()} />);
    expect(screen.getByText(/אין עדיין בגדים כאן/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'בחירה' })).toBeDisabled();
  });
});
