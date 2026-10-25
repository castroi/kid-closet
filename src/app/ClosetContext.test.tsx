import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Component, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryFileStore } from '../storage/fileStore';
import { ClosetCorruptedError, ClosetRepository } from '../storage/repository';
import { RecoveryScreen } from '../ui/RecoveryScreen';
import { NOW, closetWith, makeItem, seededStore } from '../test/data';
import { MAX_BACKUP_FILE_BYTES, exportBackup } from '../storage/backup';
import { ClosetProvider, useCloset } from './ClosetContext';

function Probe() {
  const { data } = useCloset();
  return <p>{data.items.length} items</p>;
}

class Catch extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    return this.state.error ? <p role="alert">{this.state.error.message}</p> : this.props.children;
  }
}

function corruptedStore() {
  const store = new MemoryFileStore();
  store.files.set('closet-a.json', new Blob(['garbage']));
  return store;
}

describe('ClosetProvider', () => {
  it('shows the newer closet when another open copy saved first', async () => {
    const user = userEvent.setup();
    const store = seededStore(closetWith([makeItem({ id: 'a' })]));
    const here = new ClosetRepository(store, () => NOW);
    const otherCopy = new ClosetRepository(store, () => NOW, () => 'fromOtherCopy');
    const result: string[] = [];
    function SaveButton() {
      const { markBackedUp } = useCloset();
      return (
        <button
          type="button"
          onClick={() => markBackedUp().then(() => result.push('saved'), (e: Error) => result.push(e.name))}
        >
          save
        </button>
      );
    }
    render(
      <ClosetProvider repo={here}>
        <Probe />
        <SaveButton />
      </ClosetProvider>,
    );
    expect(await screen.findByText('1 items')).toBeInTheDocument();

    await otherCopy.load();
    await otherCopy.addItem(
      { name: 'x', type: 'tee', colorGroup: 'blue', occasions: ['school'] },
      { blob: new Blob(['p']), ext: 'webp' },
    );
    await user.click(screen.getByRole('button', { name: 'save' }));

    expect(await screen.findByText(/הארון השתנה בחלון אחר/)).toBeInTheDocument();
    expect(screen.getByText('2 items')).toBeInTheDocument(); // the other copy's item is shown, not lost
    expect(result).toEqual(['ClosetChangedElsewhereError']);
    expect((await new ClosetRepository(store).load()).lastBackupAt).toBeNull();

    await user.click(screen.getByRole('button', { name: 'הבנתי' }));
    expect(screen.queryByText(/הארון השתנה בחלון אחר/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'save' }));
    await vi.waitFor(() => expect(result).toEqual(['ClosetChangedElsewhereError', 'saved']));
  });

  it('shows the error screen, not the old closet, when the newer closet cannot be read', async () => {
    const user = userEvent.setup();
    const store = seededStore(closetWith([makeItem({ id: 'a' })]));
    const here = new ClosetRepository(store, () => NOW);
    const otherCopy = new ClosetRepository(store, () => NOW);
    function SaveButton() {
      const { markBackedUp } = useCloset();
      return (
        <button type="button" onClick={() => markBackedUp().catch(() => undefined)}>
          save
        </button>
      );
    }
    render(
      <ClosetProvider repo={here}>
        <Probe />
        <SaveButton />
      </ClosetProvider>,
    );
    expect(await screen.findByText('1 items')).toBeInTheDocument();
    await otherCopy.load();
    await otherCopy.update((d) => d);
    vi.spyOn(here, 'load').mockRejectedValueOnce(new ClosetCorruptedError());

    await user.click(screen.getByRole('button', { name: 'save' }));
    expect(await screen.findByText(/none of them could be read/)).toBeInTheDocument();
    expect(screen.queryByText('1 items')).not.toBeInTheDocument();
    expect(screen.queryByText(/הארון השתנה בחלון אחר/)).not.toBeInTheDocument();
  });

  it('shows loading, then the children', async () => {
    const repo = new ClosetRepository(seededStore(closetWith([makeItem({ id: 'a' })])), () => NOW);
    render(
      <ClosetProvider repo={repo}>
        <Probe />
      </ClosetProvider>,
    );
    expect(screen.getByRole('status')).toHaveTextContent('טוען את הארון');
    expect(await screen.findByText('1 items')).toBeInTheDocument();
  });

  it('shows the error message when no error screen is given', async () => {
    render(
      <ClosetProvider repo={new ClosetRepository(corruptedStore())}>
        <Probe />
      </ClosetProvider>,
    );
    expect(await screen.findByText(/none of them could be read/)).toBeInTheDocument();
  });

  it('wraps non-Error failures', async () => {
    const repo = new ClosetRepository(new MemoryFileStore());
    repo.load = () => Promise.reject('plain string');
    render(
      <ClosetProvider repo={repo}>
        <Probe />
      </ClosetProvider>,
    );
    expect(await screen.findByText('plain string')).toBeInTheDocument();
  });

  it('lets the parent restore a backup when the closet is damaged', async () => {
    const user = userEvent.setup();
    const source = new ClosetRepository(seededStore(closetWith([makeItem({ id: 'a' }), makeItem({ id: 'b' })])), () => NOW);
    await source.load();
    const zip = await exportBackup(source, NOW);

    render(
      <ClosetProvider
        repo={new ClosetRepository(corruptedStore(), () => NOW)}
        renderError={(error, restore) => <RecoveryScreen error={error} onRestore={restore} />}
      >
        <Probe />
      </ClosetProvider>,
    );
    expect(await screen.findByRole('heading', { name: 'לא הצלחנו לפתוח את הארון' })).toBeInTheDocument();

    await user.upload(screen.getByLabelText('שחזור מגיבוי'), new File(['junk'], 'x.zip', { type: 'application/zip' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('הקובץ הזה אינו גיבוי תקין של הארון.');

    await user.upload(screen.getByLabelText('שחזור מגיבוי'), new File([zip as BlobPart], 'b.zip', { type: 'application/zip' }));
    expect(await screen.findByText('2 items')).toBeInTheDocument();
  });

  it('explains when the phone refuses access to storage (e.g. private browsing)', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    const repo = new ClosetRepository(new MemoryFileStore());
    const refused = new Error('The operation failed for an unknown transient reason (e.g. out of memory).');
    refused.name = 'UnknownError';
    repo.load = () => Promise.reject(refused);
    render(
      <ClosetProvider repo={repo} renderError={(error, restore) => <RecoveryScreen error={error} onRestore={restore} onRetry={onRetry} />}>
        <Probe />
      </ClosetProvider>,
    );
    expect(await screen.findByRole('heading', { name: 'אין גישה לאחסון בטלפון' })).toBeInTheDocument();
    expect(screen.queryByText(/פגומים/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText('שחזור מגיבוי')).not.toBeInTheDocument();
    expect(screen.getByText(/unknown transient reason/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'לנסות שוב' }));
    expect(onRetry).toHaveBeenCalled();
  });

  it('does not blame storage for an unexpected fault', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    const repo = new ClosetRepository(new MemoryFileStore());
    repo.load = () => Promise.reject(new TypeError('x is not a function'));
    render(
      <ClosetProvider repo={repo} renderError={(error, restore) => <RecoveryScreen error={error} onRestore={restore} onRetry={onRetry} />}>
        <Probe />
      </ClosetProvider>,
    );
    expect(await screen.findByRole('heading', { name: 'משהו השתבש בפתיחת הארון' })).toBeInTheDocument();
    expect(screen.queryByText('אין גישה לאחסון בטלפון')).not.toBeInTheDocument();
    expect(screen.queryByText(/פגומים/)).not.toBeInTheDocument();
    expect(screen.getByText('x is not a function')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'לנסות שוב' }));
    expect(onRetry).toHaveBeenCalled();
  });

  it.each(['SecurityError', 'NotAllowedError', 'InvalidStateError', 'QuotaExceededError'])(
    'treats %s as the phone refusing storage',
    (name) => {
      const refused = Object.assign(new Error('refused'), { name });
      render(<RecoveryScreen error={refused} onRestore={vi.fn()} onRetry={vi.fn()} />);
      expect(screen.getByRole('heading', { name: 'אין גישה לאחסון בטלפון' })).toBeInTheDocument();
    },
  );

  it('refuses a backup too large to restore on the recovery screen', async () => {
    const user = userEvent.setup();
    const onRestore = vi.fn();
    render(<RecoveryScreen error={new ClosetCorruptedError()} onRestore={onRestore} />);
    const file = new File(['x'], 'huge.zip', { type: 'application/zip' });
    Object.defineProperty(file, 'size', { value: MAX_BACKUP_FILE_BYTES + 1 });
    await user.upload(screen.getByLabelText('שחזור מגיבוי'), file);
    expect(await screen.findByRole('alert')).toHaveTextContent('קובץ הגיבוי גדול מדי לשחזור בטלפון.');
    expect(onRestore).not.toHaveBeenCalled();
  });

  it('reports a restore that fails for another reason', async () => {
    const user = userEvent.setup();
    render(<RecoveryScreen error={new ClosetCorruptedError()} onRestore={() => Promise.reject(new Error('disk'))} />);
    await user.upload(screen.getByLabelText('שחזור מגיבוי'), new File(['x'], 'b.zip', { type: 'application/zip' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('השחזור נכשל.');
  });

  it('reloads the page by default when retrying', async () => {
    const user = userEvent.setup();
    const reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload });
    try {
      render(<RecoveryScreen error={new Error('denied')} onRestore={vi.fn()} />);
      await user.click(screen.getByRole('button', { name: 'לנסות שוב' }));
      expect(reload).toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('throws when used outside the provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(
      <Catch>
        <Probe />
      </Catch>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('inside ClosetProvider');
    spy.mockRestore();
  });
});
