import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ImageDeps } from '../image/processImage';
import { renderWithCloset } from '../test/fixtures';
import { AddItem } from './AddItem';

function imageDeps(overrides: Partial<ImageDeps> = {}): ImageDeps {
  return {
    decode: vi.fn().mockResolvedValue({ width: 1000, height: 1000, release: vi.fn() }),
    draw: vi.fn().mockReturnValue({ imageData: {} as ImageData, toJpeg: vi.fn(), release: vi.fn() }),
    encodeWebp: vi.fn().mockResolvedValue(new Uint8Array([9, 9]).buffer),
    ...overrides,
  };
}

const photo = () => new File(['raw'], 'shirt.jpg', { type: 'image/jpeg' });

describe('AddItem', () => {
  it('saves a new item with a default name', async () => {
    const user = userEvent.setup();
    const onOpenCloset = vi.fn();
    const { repo, store } = await renderWithCloset(<AddItem imageDeps={imageDeps()} onOpenCloset={onOpenCloset} />);

    const save = screen.getByRole('button', { name: 'שמירה בארון' });
    expect(save).toBeDisabled();
    expect(screen.getByText('חסר: תמונה, סוג, לאן לובשים, צבע')).toBeInTheDocument();

    await user.upload(screen.getByLabelText('בחירת תמונה מהגלריה'), photo());
    expect(await screen.findByAltText('התמונה שנבחרה')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'חולצה ארוכה' }));
    await user.click(screen.getByRole('button', { name: 'בית ספר' }));
    await user.click(screen.getByRole('button', { name: 'ירוק' }));
    expect(screen.getByRole('textbox')).toHaveAttribute('placeholder', 'חולצה ארוכה בצבע ירוק');
    await user.click(save);

    expect(await screen.findByText('"חולצה ארוכה בצבע ירוק" נשמר בארון')).toBeInTheDocument();
    const [item] = repo.getData().items;
    expect(item).toMatchObject({ name: 'חולצה ארוכה בצבע ירוק', type: 'longTop', colorGroup: 'green', occasions: ['school'] });
    expect(item.image).toMatch(/\.webp$/);
    expect(store.files.has(item.image)).toBe(true);

    // The form is reset for the next item.
    expect(screen.getByText('עוד אין תמונה')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'לארון' }));
    expect(onOpenCloset).toHaveBeenCalled();
  });

  it('uses the typed name and the camera input', async () => {
    const user = userEvent.setup();
    const { repo } = await renderWithCloset(<AddItem imageDeps={imageDeps()} onOpenCloset={vi.fn()} />);
    await user.upload(screen.getByLabelText('צילום בגד'), photo());
    await screen.findByAltText('התמונה שנבחרה');
    await user.click(screen.getByRole('button', { name: 'מכנסיים קצרים' }));
    await user.click(screen.getByRole('button', { name: 'יום רגיל' }));
    await user.click(screen.getByRole('button', { name: 'חגיגי' }));
    await user.click(screen.getByRole('button', { name: 'חגיגי' }));
    await user.click(screen.getByRole('button', { name: 'בז׳' }));
    await user.type(screen.getByRole('textbox'), 'שורטס של ים');
    await user.click(screen.getByRole('button', { name: 'שמירה בארון' }));
    await screen.findByText('"שורטס של ים" נשמר בארון');
    expect(repo.getData().items[0]).toMatchObject({ name: 'שורטס של ים', occasions: ['casual'] });
  });

  it('tells the user when a photo cannot be read', async () => {
    const user = userEvent.setup();
    const deps = imageDeps({ decode: vi.fn().mockRejectedValue(new Error('bad file')) });
    await renderWithCloset(<AddItem imageDeps={deps} onOpenCloset={vi.fn()} />);
    await user.upload(screen.getByLabelText('בחירת תמונה מהגלריה'), photo());
    expect(await screen.findByText('לא הצלחנו לקרוא את התמונה')).toBeInTheDocument();
  });

  it('keeps the latest photo when an earlier pick finishes last', async () => {
    const user = userEvent.setup();
    let finishFirst: (value: { width: number; height: number; release: () => void }) => void = () => undefined;
    const decode = vi
      .fn()
      .mockReturnValueOnce(new Promise((resolve) => (finishFirst = resolve)))
      .mockResolvedValue({ width: 1000, height: 1000, release: vi.fn() });
    const encodeWebp = vi
      .fn()
      .mockResolvedValueOnce(new Uint8Array([2, 2, 2]).buffer) // the second pick encodes first
      .mockResolvedValueOnce(new Uint8Array([1]).buffer);
    const { repo, store } = await renderWithCloset(
      <AddItem imageDeps={imageDeps({ decode, encodeWebp })} onOpenCloset={vi.fn()} />,
    );

    await user.upload(screen.getByLabelText('בחירת תמונה מהגלריה'), photo()); // first pick, slow
    await user.upload(screen.getByLabelText('בחירת תמונה מהגלריה'), photo()); // second pick, fast
    await screen.findByAltText('התמונה שנבחרה');
    finishFirst({ width: 1000, height: 1000, release: vi.fn() });
    await vi.waitFor(() => expect(encodeWebp).toHaveBeenCalledTimes(2));

    await user.click(screen.getByRole('button', { name: 'סוודר' }));
    await user.click(screen.getByRole('button', { name: 'בית ספר' }));
    await user.click(screen.getByRole('button', { name: 'כחול' }));
    await user.click(screen.getByRole('button', { name: 'שמירה בארון' }));
    await screen.findByText(/נשמר בארון/);
    const saved = await store.read(repo.getData().items[0].image);
    expect(saved?.size).toBe(3); // the second photo, not the stale first one
  });

  it('makes no preview after the screen closes mid-processing', async () => {
    const user = userEvent.setup();
    let finish: (value: { width: number; height: number; release: () => void }) => void = () => undefined;
    const decode = vi.fn().mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
    const { unmount } = await renderWithCloset(<AddItem imageDeps={imageDeps({ decode })} onOpenCloset={vi.fn()} />);
    await user.upload(screen.getByLabelText('בחירת תמונה מהגלריה'), photo());
    const createUrl = vi.spyOn(URL, 'createObjectURL');
    try {
      unmount();
      finish({ width: 1000, height: 1000, release: vi.fn() });
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));
      expect(createUrl).not.toHaveBeenCalled();
    } finally {
      createUrl.mockRestore();
    }
  });

  it('shows an error when saving fails', async () => {
    const user = userEvent.setup();
    const { store } = await renderWithCloset(<AddItem imageDeps={imageDeps()} onOpenCloset={vi.fn()} />);
    vi.spyOn(store, 'write').mockRejectedValue(new Error('disk full'));
    await user.upload(screen.getByLabelText('בחירת תמונה מהגלריה'), photo());
    await screen.findByAltText('התמונה שנבחרה');
    await user.click(screen.getByRole('button', { name: 'סוודר' }));
    await user.click(screen.getByRole('button', { name: 'בית ספר' }));
    await user.click(screen.getByRole('button', { name: 'כחול' }));
    await user.click(screen.getByRole('button', { name: 'שמירה בארון' }));
    expect(await screen.findByText('לא הצלחנו לשמור את הבגד. נסי שוב.')).toBeInTheDocument();
  });
});
