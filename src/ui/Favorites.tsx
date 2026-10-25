import { useState } from 'react';
import { useCloset } from '../app/ClosetContext';
import { findItem } from '../core/closet';
import { OCCASIONS, OCCASION_LABEL, type Occasion, type Outfit } from '../core/model';
import { Garment, Icon, Toast, explainedElsewhere } from './common';

export function Favorites({ onOpen }: { onOpen: (outfit: Outfit) => void }) {
  const { data, removeOutfit, addOutfit } = useCloset();
  const [occasion, setOccasion] = useState<Occasion | null>(null);
  // Every look whose removal is still saving: its heart stays disabled until then.
  const [removing, setRemoving] = useState<ReadonlySet<string>>(new Set());
  const [removed, setRemoved] = useState<Outfit | null>(null);
  const [error, setError] = useState<string | null>(null);
  const outfits = data.outfits.filter((o) => occasion === null || o.occasion === occasion);

  const setRemovingId = (id: string, on: boolean) =>
    setRemoving((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  // The card stays until the save is done, so a failed save never makes a look vanish and come back.
  const remove = async (outfit: Outfit) => {
    setError(null);
    setRemovingId(outfit.id, true);
    try {
      await removeOutfit(outfit.id);
      setRemoved(outfit);
    } catch (err) {
      if (!explainedElsewhere(err)) setError('לא הצלחנו להסיר את הלוק. נסי שוב.');
    } finally {
      setRemovingId(outfit.id, false);
    }
  };

  const undo = async () => {
    if (!removed) return;
    setError(null);
    try {
      // Re-added as a new save, so the look comes back at the top of the list.
      await addOutfit({ occasion: removed.occasion, layerId: removed.layerId, topId: removed.topId, bottomId: removed.bottomId });
      setRemoved(null);
    } catch (err) {
      if (!explainedElsewhere(err)) setError('לא הצלחנו להחזיר את הלוק. נסי שוב.');
    }
  };

  return (
    <>
      <div className="screen">
        <div className="screen-header">
          <h1>הלוקים שאהבתי</h1>
        </div>
        <div className="chips scroll" role="group" aria-label="סינון לפי מקום">
          <button type="button" className="chip" aria-pressed={occasion === null} onClick={() => setOccasion(null)}>
            הכל
          </button>
          {OCCASIONS.map((o) => (
            <button key={o} type="button" className="chip" aria-pressed={occasion === o} onClick={() => setOccasion(o)}>
              {OCCASION_LABEL[o]}
            </button>
          ))}
        </div>
        {outfits.length === 0 ? (
          <div className="center-message muted">
            {data.outfits.length === 0 ? 'עוד אין לוקים שמורים. במסך "להתלבש" לוחצים "לראות את הלוק" ואז "לשמור".' : 'אין לוקים שמורים כאן.'}
          </div>
        ) : (
          <ul className="grid" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {outfits.map((o) => {
              const layer = findItem(data, o.layerId);
              const top = findItem(data, o.topId);
              const bottom = findItem(data, o.bottomId);
              if (!top || !bottom) return null;
              const description = [layer?.name, top.name, bottom.name].filter(Boolean).join(', ');
              return (
                <li key={o.id} className="card">
                  <button
                    type="button"
                    className="thumb"
                    style={{ height: 'auto', minHeight: 170, flexDirection: 'column', border: 'none', padding: 8, gap: 2 }}
                    aria-label={`פתיחת הלוק: ${description}`}
                    onClick={() => onOpen(o)}
                  >
                    <span style={{ display: 'flex', alignItems: 'flex-end', gap: 2 }}>
                      {layer && <Garment item={layer} height={50} />}
                      <Garment item={top} height={70} />
                    </span>
                    <Garment item={bottom} height={86} />
                  </button>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span className="tag">{OCCASION_LABEL[o.occasion]}</span>
                    <button
                      type="button"
                      className="icon-btn"
                      style={{ color: 'var(--accent-text)' }}
                      aria-label={`הסרה מהמועדפים: ${description}`}
                      disabled={removing.has(o.id)}
                      onClick={() => remove(o)}
                    >
                      <Icon name="heart" filled />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Outside the scrolling list, so the message is seen wherever she tapped. */}
      {(error || removed) && (
        <div className="action-bar">
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {removed && <Toast text="הלוק הוסר מהמועדפים" actionLabel="ביטול" onAction={undo} />}
        </div>
      )}
    </>
  );
}
