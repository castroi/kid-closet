import { useEffect, useState, type ReactNode } from 'react';
import { nextResetDate } from '../app/aiDevice';
import { lookKey, useAiLooks, type LookOutfit } from '../app/AiLooks';
import { useCloset } from '../app/ClosetContext';
import { DEFAULT_DOLL_URL } from '../app/doll';
import { findLook, lookPartsFor } from '../core/closet';
import { dollsLeftText, hebrewDay } from '../core/gallery';
import type { Item } from '../core/model';
import { Garment, Icon, explainedElsewhere, useImageUrl } from './common';

/** The countdown shows only near the end, so the dolls don't become something to use up. */
export const COUNTDOWN_FROM = 20;

function useOnline(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false));
  useEffect(() => {
    const update = () => setOnline(navigator.onLine !== false);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  return online;
}

interface Props {
  outfit: LookOutfit;
  layer: Item | null;
  top: Item;
  bottom: Item;
  /** Today's photo stack, shown when there is no AI look or she picks "תמונות". */
  photos: ReactNode;
  now?: Date;
}

/**
 * The look in the preview: the AI picture when one exists (with the real photos under it),
 * otherwise the photos with "להלביש את הבובה". Plan §8 of docs/ai-doll-look.md.
 */
export function AiLookPreview({ outfit, layer, top, bottom, photos, now = new Date() }: Props) {
  const { data, setLookFlagged } = useCloset();
  const ai = useAiLooks();
  const online = useOnline();
  const parts = lookPartsFor(data.doll.id, outfit);
  const key = lookKey(parts);
  const look = findLook(data, parts);
  const job = ai.jobs[key];
  // Plan decision #16: a look always opens on the doll; "תמונות" is one tap away.
  const [view, setView] = useState<'doll' | 'photos'>('doll');
  const [flagError, setFlagError] = useState(false);
  const lookUrl = useImageUrl(look?.image ?? null);
  const dollUrl = useImageUrl(data.doll.image);

  useEffect(() => {
    ai.setVisibleKey(key);
    return () => ai.setVisibleKey(null);
  }, [ai, key]);

  const flag = async () => {
    if (!look) return;
    setFlagError(false);
    try {
      await setLookFlagged(look.id, true);
    } catch (err) {
      setFlagError(!explainedElsewhere(err));
    }
  };

  if (look) {
    const realPhotos = [layer, top, bottom].filter((it): it is Item => it !== null);
    return (
      <>
        <div className="switch ai-switch" role="group" aria-label="איך לראות את הלוק">
          <button type="button" aria-pressed={view === 'doll'} onClick={() => setView('doll')}>
            בובה
          </button>
          <button type="button" aria-pressed={view === 'photos'} onClick={() => setView('photos')}>
            תמונות
          </button>
        </div>
        {view === 'photos' ? (
          photos
        ) : (
          <div className="preview ai-preview">
            {lookUrl ? (
              <img className="ai-look-img" src={lookUrl} alt="הבובה לובשת את הלוק" />
            ) : (
              <div className="ai-look-img" role="status">
                טוען…
              </div>
            )}
            <span className="tag ai-tag">
              <Icon name="sparkle" size={14} />
              תמונת AI · צבעים וגזרה יכולים להיות שונים
            </span>
            <div className="ai-real-photos" aria-label="הבגדים האמיתיים">
              {realPhotos.map((it) => (
                <Garment key={it.id} item={it} height={72} />
              ))}
            </div>
            {look.flagged ? (
              <p className="muted" role="status">
                <Icon name="check" size={16} /> סימנו להורים. הם יכולים להלביש אותה שוב.
              </p>
            ) : (
              <button type="button" className="link-btn" onClick={flag}>
                לא דומה?
              </button>
            )}
            {flagError && <p className="error">לא הצלחנו לסמן. נסי שוב.</p>}
          </div>
        )}
      </>
    );
  }

  const waiting = job?.kind === 'waiting' && !job.detached;
  if (waiting) {
    return (
      <div className="preview ai-preview" aria-busy="true">
        <div className="ai-waiting">
          <img className="ai-look-img faded" src={data.doll.image ? (dollUrl ?? DEFAULT_DOLL_URL) : DEFAULT_DOLL_URL} alt="" />
          <span className="ai-waiting-mark" aria-hidden="true">
            <Icon name="sparkle" size={36} />
          </span>
        </div>
        <p className="ai-waiting-title" role="status">
          הבובה מתלבשת…
        </p>
        <p className="muted">זה לוקח עד דקה. אפשר לעבור למסך אחר, נודיע כשמוכן.</p>
        <div className="ai-progress" aria-hidden="true">
          <span />
        </div>
        <button type="button" className="btn ai-cancel" onClick={() => ai.detach(key)}>
          ביטול
        </button>
      </div>
    );
  }

  const cap = data.ai.monthlyCap;
  const left = Math.max(0, cap - ai.monthlyUse());
  const busy = job?.kind === 'waiting';
  return (
    <>
      {photos}
      {ai.isReady() && (
        <div className="ai-action">
          {job?.kind === 'failed' && (
            <p className="error" role="alert">
              לא הצלחנו להלביש את הבובה הפעם. נסי שוב אחר כך.
            </p>
          )}
          <button
            type="button"
            className="btn ai-btn"
            disabled={!online || left === 0 || busy}
            onClick={() => ai.start(outfit)}
          >
            <Icon name="sparkle" size={22} />
            {busy ? 'הבובה מתלבשת…' : 'להלביש את הבובה'}
          </button>
          {!online ? (
            <p className="muted ai-caption">צריך אינטרנט</p>
          ) : cap === 0 ? (
            <p className="muted ai-caption">הבובות לא פעילות כרגע</p>
          ) : left === 0 ? (
            <p className="muted ai-caption">הבובות של החודש נגמרו. חוזרות ב־{hebrewDay(nextResetDate(now))}</p>
          ) : left <= COUNTDOWN_FROM ? (
            <p className="muted ai-caption">{dollsLeftText(left)}</p>
          ) : null}
        </div>
      )}
    </>
  );
}
