import { useEffect, useRef, useState } from 'react';
import { useCloset } from '../app/ClosetContext';
import { DEFAULT_DOLL_URL } from '../app/doll';
import { aiPicturesText } from '../core/gallery';
import { DOLL_MAX_SIDE, processImage, type ImageDeps } from '../image/processImage';
import type { StoredImage } from '../storage/repository';
import { Sheet, explainedElsewhere, useImageUrl } from './common';

type Pending = { image: StoredImage; url: string };

/**
 * The doll the AI will dress. The parent can replace it with her own picture or go
 * back to the one bundled with the app; both ask first, because the current
 * picture is deleted.
 */
export function DollPanel({ imageDeps }: { imageDeps: ImageDeps }) {
  const { data, setDoll, resetDoll, readImage, deleteLooks } = useCloset();
  // After the doll changes, its AI looks no longer match; the parent decides whether to keep them (plan §8).
  // `canReturn`: the replaced doll was the bundled one, so going back to it shows them again.
  const [oldLooks, setOldLooks] = useState<{ ids: string[]; canReturn: boolean } | null>(null);
  const custom = data.doll.image;
  const storedUrl = useImageUrl(custom);
  const shownUrl = custom ? storedUrl : DEFAULT_DOLL_URL;

  // The picture should always be there; if it got lost, say so instead of loading forever.
  const [missingPath, setMissingPath] = useState<string | null>(null);
  useEffect(() => {
    if (!custom) return;
    let active = true;
    const lost = () => {
      if (active) setMissingPath(custom);
    };
    readImage(custom).then((blob) => !blob && lost(), lost);
    return () => {
      active = false;
    };
  }, [custom, readImage]);
  const missing = custom !== null && missingPath === custom;

  const [working, setWorking] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  const pendingUrl = pending?.url ?? null;
  useEffect(() => {
    return () => {
      if (pendingUrl) URL.revokeObjectURL(pendingUrl);
    };
  }, [pendingUrl]);

  // Only the latest pick may show, and nothing after the panel closes.
  const latestPick = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const pick = ++latestPick.current;
    const isCurrent = () => mounted.current && pick === latestPick.current;
    setMessage(null);
    setWorking(true);
    try {
      const image = await processImage(file, imageDeps, DOLL_MAX_SIDE);
      if (!isCurrent()) return;
      setPending({ image, url: URL.createObjectURL(image.blob) });
    } catch {
      if (!isCurrent()) return;
      setMessage({ text: 'לא הצלחנו לקרוא את התמונה.', error: true });
    } finally {
      if (isCurrent()) setWorking(false);
    }
  };

  const run = async (save: () => Promise<void>, done: string, dollChange = false) => {
    setWorking(true);
    setMessage(null);
    const previous = data.doll.id;
    const canReturn = data.doll.image === null;
    const looks = data.aiLooks.filter((l) => l.dollId === previous).map((l) => l.id);
    try {
      await save();
      setMessage({ text: done, error: false });
      if (dollChange && looks.length > 0) setOldLooks({ ids: looks, canReturn });
    } catch (err) {
      if (!explainedElsewhere(err)) setMessage({ text: 'השמירה לא הצליחה. נסי שוב.', error: true });
    } finally {
      setWorking(false);
    }
  };

  const confirmReplace = async () => {
    if (!pending) return;
    const { image } = pending;
    setPending(null);
    await run(() => setDoll(image), 'הבובה הוחלפה.', true);
  };

  const confirmDefault = async () => {
    setConfirmReset(false);
    await run(resetDoll, 'חזרנו לבובה הרגילה.', true);
  };

  return (
    <section className="panel" aria-labelledby="doll-h">
      <h2 id="doll-h">הבובה</h2>
      <p className="muted">
        על הבובה הזאת ה־AI ילביש את הבגדים. הכי טוב: בובה בגוף מלא, מלפנים, על רקע חלק, בבגדים אפורים צמודים.
      </p>
      <div className="photo-pick">
        <div className="thumb doll-thumb">
          {shownUrl ? (
            <img src={shownUrl} alt={custom ? 'הבובה שבחרת' : 'הבובה הרגילה'} />
          ) : missing ? (
            <span>התמונה לא נמצאה</span>
          ) : (
            <span role="status">טוען…</span>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
          <label className="btn file-btn">
            {working ? 'מכין…' : 'החלפה'}
            <input
              type="file"
              accept="image/*"
              aria-label="בחירת תמונת בובה"
              disabled={working}
              onChange={(e) => {
                void onFile(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </label>
          {custom && (
            <button
              type="button"
              className="btn"
              style={{ borderColor: 'var(--line)' }}
              disabled={working}
              onClick={() => setConfirmReset(true)}
            >
              לבובה הרגילה
            </button>
          )}
        </div>
      </div>
      {missing && !message && (
        <p role="status" className="error">
          לא מצאנו את תמונת הבובה. אפשר לבחור תמונה חדשה או לחזור לבובה הרגילה.
        </p>
      )}
      {message && (
        <p role="status" className={message.error ? 'error' : 'muted'}>
          {message.text}
        </p>
      )}

      {pending && (
        <Sheet title="להחליף את הבובה?" onClose={() => setPending(null)}>
          <div className="photo-pick" style={{ justifyContent: 'center' }}>
            <div className="thumb doll-thumb">
              <img src={pending.url} alt="הבובה החדשה" />
            </div>
          </div>
          <p className="muted">{custom ? 'התמונה הקודמת של הבובה תימחק ואי אפשר להחזיר אותה, אלא מגיבוי.' : 'אפשר לחזור לבובה הרגילה בכל רגע.'}</p>
          <button type="button" className="btn btn-dark" onClick={confirmReplace}>
            כן, להחליף
          </button>
          <button type="button" className="btn" onClick={() => setPending(null)}>
            ביטול
          </button>
        </Sheet>
      )}

      {oldLooks && (
        <Sheet title={`למחוק ${aiPicturesText(oldLooks.ids.length)} של הבובה הקודמת?`} onClose={() => setOldLooks(null)}>
          <p className="muted">
            {oldLooks.canReturn
              ? 'הן נוצרו עם הבובה הרגילה, אז עכשיו הן לא יוצגו. אם תחזרי לבובה הרגילה, הן יחזרו.'
              : 'הן נוצרו עם הבובה הקודמת, שכבר נמחקה, אז הן לא יוצגו יותר. הן רק תופסות מקום.'}
          </p>
          <button
            type="button"
            className="btn btn-danger"
            onClick={async () => {
              const { ids } = oldLooks;
              setOldLooks(null);
              await run(() => deleteLooks(ids), 'התמונות הישנות נמחקו.');
            }}
          >
            כן, למחוק
          </button>
          <button type="button" className="btn" onClick={() => setOldLooks(null)}>
            להשאיר
          </button>
        </Sheet>
      )}

      {confirmReset && (
        <Sheet title="לחזור לבובה הרגילה?" onClose={() => setConfirmReset(false)}>
          <p className="muted">התמונה שבחרת תימחק ואי אפשר להחזיר אותה, אלא מגיבוי.</p>
          <button type="button" className="btn btn-danger" onClick={confirmDefault}>
            כן, לחזור
          </button>
          <button type="button" className="btn" onClick={() => setConfirmReset(false)}>
            ביטול
          </button>
        </Sheet>
      )}
    </section>
  );
}
