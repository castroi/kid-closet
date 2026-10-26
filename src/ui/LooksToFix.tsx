import { useState } from 'react';
import { lookKey, useAiLooks, type StartRefusal } from '../app/AiLooks';
import { useCloset } from '../app/ClosetContext';
import { findItem } from '../core/closet';
import { hebrewDay } from '../core/gallery';
import type { AiLook } from '../core/model';
import { aiErrorText } from './aiErrors';
import { Garment, explainedElsewhere, useImageUrl } from './common';

const REFUSAL_TEXT: Record<StartRefusal, string> = {
  'not-ready': 'צריך קודם להגדיר ספק ומפתח ב"הגדרות AI".',
  busy: 'כבר יוצרים אותה מחדש.',
  exists: 'כבר יש תמונה ללוק הזה.',
  cap: 'הגעת למקסימום התמונות של החודש. אפשר להגדיל אותו ב"הגדרות AI".',
};

/**
 * Looks she marked "לא דומה?". The parent compares each picture with the real clothes and
 * makes it again, keeps it, or deletes the picture (plan §8).
 */
export function LooksToFix() {
  const { data } = useCloset();
  // Looks made again on this screen stay listed (unmarked), so the parent sees the new picture.
  const [remade, setRemade] = useState<ReadonlySet<string>>(new Set());
  const shown = data.aiLooks.filter((l) => l.flagged || remade.has(lookKey(l)));
  const setRemadeKey = (key: string, on: boolean) =>
    setRemade((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  if (shown.length === 0) {
    return <p className="muted center-message">אין לוקים לתיקון. כשהיא לוחצת "לא דומה?" על תמונה, היא תופיע כאן.</p>;
  }
  return (
    <>
      <p className="muted">היא סימנה "לא דומה?". כל יצירה מחדש נספרת בשימוש החודשי.</p>
      {shown.map((look) => (
        // Keyed by its parts: a new picture for the same clothes is the same row.
        <LookToFix key={lookKey(look)} look={look} onRemade={(on) => setRemadeKey(lookKey(look), on)} />
      ))}
    </>
  );
}

function LookToFix({ look, onRemade }: { look: AiLook; onRemade: (on: boolean) => void }) {
  const { data, setLookFlagged, deleteLooks } = useCloset();
  const ai = useAiLooks();
  const url = useImageUrl(look.image);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const upper = findItem(data, look.upperId);
  const bottom = findItem(data, look.bottomId);
  const job = ai.jobs[lookKey(look)];
  const remaking = job?.kind === 'waiting';
  // A look made with an earlier doll can't be made again with it; only kept or deleted.
  const sameDoll = look.dollId === data.doll.id;

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setMessage(null);
    try {
      await action();
      onRemade(false);
    } catch (err) {
      if (!explainedElsewhere(err)) setMessage({ text: 'השמירה לא הצליחה. נסי שוב.', error: true });
    } finally {
      setBusy(false);
    }
  };

  const remake = () => {
    setMessage(null);
    const upperIsLayer = look.upperSlot === 'layer';
    const refusal = ai.start(
      {
        occasion: 'school',
        layerId: upperIsLayer ? look.upperId : null,
        // With a layer the shirt isn't sent, so any id fits; the look is keyed by the layer.
        topId: look.upperId,
        bottomId: look.bottomId,
      },
      { redo: true, quiet: true },
    );
    if (refusal) setMessage({ text: REFUSAL_TEXT[refusal], error: true });
    else onRemade(true);
  };

  return (
    <section className="panel" aria-label={`לוק מ־${hebrewDay(new Date(look.createdAt))}`}>
      <div className="fix-row">
        {url ? <img className="fix-ai-img" src={url} alt="תמונת ה־AI" /> : <span className="fix-ai-img" />}
        <div className="fix-real">
          <span className="muted">הבגדים האמיתיים</span>
          <div className="ai-real-photos">
            {upper && <Garment item={upper} height={72} />}
            {bottom && <Garment item={bottom} height={72} />}
          </div>
          <span className="muted">נוצר ב־{hebrewDay(new Date(look.createdAt))}</span>
        </div>
      </div>
      {remaking && (
        <p className="muted" role="status">
          יוצרים מחדש…
        </p>
      )}
      {job?.kind === 'failed' && (
        <p className="error" role="alert">
          {aiErrorText(job.error)}
        </p>
      )}
      {message && (
        <p role="status" className={message.error ? 'error' : 'muted'}>
          {message.text}
        </p>
      )}
      {!look.flagged && !remaking && job?.kind !== 'failed' && (
        <p className="muted" role="status">
          התמונה נוצרה מחדש. אפשר להשאיר אותה, ליצור שוב או למחוק.
        </p>
      )}
      {!sameDoll && <p className="muted">התמונה נוצרה עם בובה קודמת, אז אפשר רק להשאיר או למחוק.</p>}
      <div className="btn-row">
        {sameDoll && (
          <button type="button" className="btn btn-dark" disabled={busy || remaking} onClick={remake}>
            ליצור מחדש
          </button>
        )}
        <button
          type="button"
          className="btn"
          disabled={busy || remaking}
          onClick={() => void run(() => setLookFlagged(look.id, false))}
        >
          להשאיר
        </button>
        <button
          type="button"
          className="btn"
          style={{ borderColor: 'var(--line)', color: 'var(--danger-text)' }}
          disabled={busy || remaking}
          onClick={() => void run(() => deleteLooks([look.id]))}
        >
          למחוק את התמונה
        </button>
      </div>
    </section>
  );
}
