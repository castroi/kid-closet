import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Component, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryFileStore } from '../storage/fileStore';
import { ClosetRepository } from '../storage/repository';
import { RecoveryScreen } from '../ui/RecoveryScreen';
import { NOW, closetWith, makeItem, seededStore } from '../test/data';
import { exportBackup } from '../storage/backup';
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
    expect(await screen.findByRole('alert')).toHaveTextContent('הקובץ אינו גיבוי תקין.');

    await user.upload(screen.getByLabelText('שחזור מגיבוי'), new File([zip as BlobPart], 'b.zip', { type: 'application/zip' }));
    expect(await screen.findByText('2 items')).toBeInTheDocument();
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
