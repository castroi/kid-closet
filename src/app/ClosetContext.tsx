import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  addOutfit as addOutfitTo,
  removeOutfit as removeOutfitFrom,
  setAiSettings as setAiSettingsOf,
  setLookFlagged as setLookFlaggedIn,
  setStatus as setStatusOf,
  updateItem as updateItemIn,
  type ItemPatch,
} from '../core/closet';
import type { AiLook, AiSettings, ClosetData, Item, ItemStatus, Outfit } from '../core/model';
import { exportBackup, importBackup } from '../storage/backup';
import { ClosetChangedElsewhereError, type ClosetRepository, type NewItem, type StoredImage } from '../storage/repository';

export type OutfitInput = Omit<Outfit, 'id' | 'createdAt'>;

export interface ClosetApi {
  data: ClosetData;
  addItem(input: NewItem, image: StoredImage): Promise<Item>;
  updateItem(id: string, patch: ItemPatch): Promise<void>;
  setStatus(ids: string[], status: ItemStatus): Promise<void>;
  deleteItems(ids: string[]): Promise<void>;
  addOutfit(outfit: OutfitInput): Promise<void>;
  removeOutfit(id: string): Promise<void>;
  exportBackup(): Promise<Uint8Array>;
  markBackedUp(): Promise<void>;
  importBackup(zip: Uint8Array): Promise<void>;
  readImage(path: string): Promise<Blob | null>;
  setDoll(image: StoredImage): Promise<void>;
  resetDoll(): Promise<void>;
  setAiSettings(patch: Partial<AiSettings>): Promise<void>;
  addLook(input: Omit<AiLook, 'id' | 'image' | 'createdAt' | 'flagged'>, image: StoredImage): Promise<AiLook>;
  setLookFlagged(id: string, flagged: boolean): Promise<void>;
  deleteLooks(ids: string[]): Promise<void>;
}

const ClosetContext = createContext<ClosetApi | null>(null);

export function useCloset(): ClosetApi {
  const api = useContext(ClosetContext);
  if (!api) throw new Error('useCloset must be used inside ClosetProvider');
  return api;
}

interface ProviderProps {
  repo: ClosetRepository;
  children: ReactNode;
  now?: () => string;
  newId?: () => string;
  /** Shown when the saved closet cannot be read; lets the parent restore a backup. */
  renderError?: (error: Error, restore: (zip: Uint8Array) => Promise<void>) => ReactNode;
}

type LoadState = { kind: 'loading' } | { kind: 'ready'; data: ClosetData } | { kind: 'error'; error: Error };

// Module-level so the context value is not rebuilt on every render.
const defaultNow = () => new Date().toISOString();
const defaultNewId = () => crypto.randomUUID();

export function ClosetProvider({ repo, children, now = defaultNow, newId = defaultNewId, renderError }: ProviderProps) {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });

  useEffect(() => {
    let active = true;
    repo.load().then(
      (data) => active && setState({ kind: 'ready', data }),
      (error: unknown) => active && setState({ kind: 'error', error: error instanceof Error ? error : new Error(String(error)) }),
    );
    return () => {
      active = false;
    };
  }, [repo]);

  const [changedElsewhere, setChangedElsewhere] = useState(false);

  /**
   * Runs a save. If another open copy of the app saved first, the save was refused
   * so nothing got overwritten: show that copy's newer closet and say so. The error
   * still reaches the caller, which shows its own "try again" message.
   */
  const guard = useCallback(
    async <T,>(save: () => Promise<T>): Promise<T> => {
      try {
        return await save();
      } catch (err) {
        if (err instanceof ClosetChangedElsewhereError) {
          try {
            setState({ kind: 'ready', data: await repo.load() });
            setChangedElsewhere(true);
          } catch (loadError) {
            // The newer closet can't be read. Keeping the old one on screen would let
            // the next save overwrite it, so show the recovery screen instead.
            setState({
              kind: 'error',
              error: loadError instanceof Error ? loadError : new Error(String(loadError)),
            });
          }
        }
        throw err;
      }
    },
    [repo],
  );

  const commit = useCallback(
    (change: (d: ClosetData) => ClosetData) =>
      guard(async () => {
        const data = await repo.update(change);
        setState({ kind: 'ready', data });
      }),
    [repo, guard],
  );

  const restore = useCallback(
    async (zip: Uint8Array) => {
      const data = await importBackup(repo, zip);
      setChangedElsewhere(false);
      setState({ kind: 'ready', data });
    },
    [repo],
  );

  const readImage = useCallback((path: string) => repo.readImage(path), [repo]);

  const data = state.kind === 'ready' ? state.data : null;

  const api = useMemo<ClosetApi | null>(() => {
    if (!data) return null;
    return {
      data,
      addItem: (input, image) =>
        guard(async () => {
          const item = await repo.addItem(input, image);
          setState({ kind: 'ready', data: repo.getData() });
          return item;
        }),
      updateItem: (id, patch) => commit((d) => updateItemIn(d, id, patch, now())),
      setStatus: (ids, status) => commit((d) => setStatusOf(d, ids, status, now())),
      deleteItems: (ids) =>
        guard(async () => {
          const next = await repo.deleteItems(ids);
          setState({ kind: 'ready', data: next });
        }),
      addOutfit: (outfit) => commit((d) => addOutfitTo(d, { ...outfit, id: newId(), createdAt: now() })),
      removeOutfit: (id) => commit((d) => removeOutfitFrom(d, id)),
      exportBackup: () => exportBackup(repo, now()),
      markBackedUp: () => commit((d) => ({ ...d, lastBackupAt: now() })),
      importBackup: restore,
      readImage,
      setDoll: (image) =>
        guard(async () => {
          setState({ kind: 'ready', data: await repo.setDoll(image) });
        }),
      resetDoll: () =>
        guard(async () => {
          setState({ kind: 'ready', data: await repo.resetDoll() });
        }),
      setAiSettings: (patch) => commit((d) => setAiSettingsOf(d, patch)),
      addLook: (input, image) =>
        guard(async () => {
          const look = await repo.addLook(input, image);
          setState({ kind: 'ready', data: repo.getData() });
          return look;
        }),
      setLookFlagged: (id, flagged) => commit((d) => setLookFlaggedIn(d, id, flagged)),
      deleteLooks: (ids) =>
        guard(async () => {
          setState({ kind: 'ready', data: await repo.deleteLooks(ids) });
        }),
    };
  }, [data, repo, commit, guard, restore, readImage, now, newId]);

  if (state.kind === 'loading') {
    return (
      <div className="center-message" role="status">
        טוען את הארון…
      </div>
    );
  }
  if (state.kind === 'error') {
    return <>{renderError ? renderError(state.error, restore) : <p className="error">{state.error.message}</p>}</>;
  }
  return (
    <ClosetContext.Provider value={api}>
      {changedElsewhere && (
        <div className="warn changed-elsewhere" role="status" dir="rtl">
          <span>הארון השתנה בחלון אחר, אז השינוי האחרון לא נשמר. עכשיו מוצג הארון המעודכן.</span>
          <button type="button" className="btn" onClick={() => setChangedElsewhere(false)}>
            הבנתי
          </button>
        </div>
      )}
      {children}
    </ClosetContext.Provider>
  );
}
