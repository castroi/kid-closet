import { fireEvent, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithCloset, sampleCloset } from '../test/fixtures';
import { PhotoView } from './PhotoView';

describe('PhotoView', () => {
  it('focuses ✕ once: a re-render while open (a new onClose each time) never pulls focus back', async () => {
    const closes: ReturnType<typeof vi.fn>[] = [];
    function Harness() {
      const [n, setN] = useState(0);
      const onClose = vi.fn();
      closes[n] = onClose;
      return (
        <>
          <button type="button" onClick={() => setN((v) => v + 1)}>
            רענון
          </button>
          <PhotoView item={sampleCloset().items[0]} onClose={onClose} />
        </>
      );
    }
    await renderWithCloset(<Harness />, sampleCloset());
    const close = screen.getByRole('button', { name: 'סגירה' });
    expect(close).toHaveFocus();

    // Like an analysis or a doll finishing above the screen while she looks.
    const refresh = screen.getByRole('button', { name: 'רענון' });
    refresh.focus();
    fireEvent.click(refresh);
    expect(refresh).toHaveFocus();

    // Escape uses the latest onClose.
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(closes[1]).toHaveBeenCalledTimes(1);
    expect(closes[0]).not.toHaveBeenCalled();
  });
});
