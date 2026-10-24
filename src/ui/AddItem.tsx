import { useEffect, useState } from 'react';
import { useCloset } from '../app/ClosetContext';
import { processImage, type ImageDeps } from '../image/processImage';
import type { StoredImage } from '../storage/repository';
import { Icon, Toast } from './common';
import { ItemFields, finalName, missingFields, type ItemDraft } from './ItemFields';

const EMPTY: ItemDraft = { name: '', type: null, colorGroup: null, occasions: [] };

type PhotoState =
  | { kind: 'none' }
  | { kind: 'working' }
  | { kind: 'ready'; image: StoredImage; url: string }
  | { kind: 'error' };

export function AddItem({ imageDeps, onOpenCloset }: { imageDeps: ImageDeps; onOpenCloset: () => void }) {
  const { addItem } = useCloset();
  const [draft, setDraft] = useState<ItemDraft>(EMPTY);
  const [photo, setPhoto] = useState<PhotoState>({ kind: 'none' });
  const [saving, setSaving] = useState(false);
  const [savedName, setSavedName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const photoUrl = photo.kind === 'ready' ? photo.url : null;
  useEffect(() => {
    return () => {
      if (photoUrl) URL.revokeObjectURL(photoUrl);
    };
  }, [photoUrl]);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setSavedName(null);
    setPhoto({ kind: 'working' });
    try {
      const image = await processImage(file, imageDeps);
      setPhoto({ kind: 'ready', image, url: URL.createObjectURL(image.blob) });
    } catch {
      setPhoto({ kind: 'error' });
    }
  };

  const missing = [...(photo.kind === 'ready' ? [] : ['תמונה']), ...missingFields(draft)];

  const save = async () => {
    if (photo.kind !== 'ready' || !draft.type || !draft.colorGroup || draft.occasions.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      const item = await addItem(
        { name: finalName(draft), type: draft.type, colorGroup: draft.colorGroup, occasions: draft.occasions },
        photo.image,
      );
      setSavedName(item.name);
      setDraft(EMPTY);
      setPhoto({ kind: 'none' });
    } catch {
      setError('לא הצלחנו לשמור את הבגד. נסי שוב.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="screen">
        <div className="screen-header">
          <h1>בגד חדש</h1>
        </div>

        <div className="panel">
          <div className="photo-pick">
            <div className="thumb">
              {photo.kind === 'ready' && <img src={photo.url} alt="התמונה שנבחרה" />}
              {photo.kind === 'working' && <span role="status">מכינה את התמונה…</span>}
              {photo.kind === 'none' && <span>עוד אין תמונה</span>}
              {photo.kind === 'error' && <span className="error">לא הצלחנו לקרוא את התמונה</span>}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
              <label className="btn file-btn">
                <Icon name="camera" />
                צילום
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  aria-label="צילום בגד"
                  onChange={(e) => {
                    void onFile(e.target.files?.[0]);
                    e.target.value = '';
                  }}
                />
              </label>
              <label className="btn file-btn" style={{ borderColor: 'var(--line)' }}>
                מהגלריה
                <input
                  type="file"
                  accept="image/*"
                  aria-label="בחירת תמונה מהגלריה"
                  onChange={(e) => {
                    void onFile(e.target.files?.[0]);
                    e.target.value = '';
                  }}
                />
              </label>
              <span className="muted" style={{ fontSize: 12 }}>
                טיפ: לצלם על רקע חלק ובהיר
              </span>
            </div>
          </div>
        </div>

        <ItemFields
          draft={draft}
          onChange={(d) => {
            setDraft(d);
            setSavedName(null);
          }}
        />
      </div>

      <div className="action-bar">
        {savedName && <Toast text={`"${savedName}" נשמר בארון`} actionLabel="לארון" onAction={onOpenCloset} />}
        {error && <p className="error">{error}</p>}
        {missing.length > 0 && !savedName && (
          <p className="muted" style={{ textAlign: 'center' }}>
            חסר: {missing.join(', ')}
          </p>
        )}
        <button type="button" className="btn btn-primary" onClick={save} disabled={missing.length > 0 || saving}>
          {saving ? 'שומרת…' : 'שמירה בארון'}
        </button>
      </div>
    </>
  );
}
