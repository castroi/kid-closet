import { useState } from 'react';
import { useCloset } from '../app/ClosetContext';
import { findItem } from '../core/closet';
import { OCCASIONS, OCCASION_LABEL, type Occasion, type Outfit } from '../core/model';
import { Garment, Icon } from './common';

export function Favorites({ onOpen }: { onOpen: (outfit: Outfit) => void }) {
  const { data, removeOutfit } = useCloset();
  const [occasion, setOccasion] = useState<Occasion | null>(null);
  const outfits = data.outfits.filter((o) => occasion === null || o.occasion === occasion);

  return (
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
                    onClick={() => removeOutfit(o.id)}
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
  );
}
