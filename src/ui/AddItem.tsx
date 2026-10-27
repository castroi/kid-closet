import { useEffect, useRef, useState } from 'react';
import { useCloset } from '../app/ClosetContext';
import { useItemAnalysis, type PhotoDescription } from '../app/ItemAnalysis';
import type { ItemAnalysis } from '../core/attributes';
import { prefillFromAttributes } from '../core/prefill';
import { processImage, type ImageDeps } from '../image/processImage';
import type { StoredImage } from '../storage/repository';
import { Icon, Toast } from './common';
import { ItemFields, finalName, missingFields, type AiFilledField, type ItemDraft } from './ItemFields';

/** After this long the form isn't filled any more, so it never changes under her; a late answer is still stored. */
export const FILL_DEADLINE_MS = 20_000;

/** What the AI is doing for the photo on the form (docs/ai-item-attributes.md decision 13). */
type AiState = 'idle' | 'waiting' | 'filled' | 'unclear';

const EMPTY: ItemDraft = { name: '', type: null, colorGroup: null, occasions: [] };

type PhotoState =
  | { kind: 'none' }
  | { kind: 'working' }
  | { kind: 'ready'; image: StoredImage; url: string }
  | { kind: 'error' };

export function AddItem({
  imageDeps,
  onOpenCloset,
  fillDeadlineMs = FILL_DEADLINE_MS,
}: {
  imageDeps: ImageDeps;
  onOpenCloset: () => void;
  /** Only for tests. */
  fillDeadlineMs?: number;
}) {
  const { addItem, setItemAnalysis } = useCloset();
  const analysis = useItemAnalysis();
  const [aiState, setAiState] = useState<AiState>('idle');
  const [aiFilled, setAiFilled] = useState<ReadonlySet<AiFilledField>>(new Set());
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

  // Only the latest pick may show its result, and nothing is shown after the screen closes.
  // Results are dropped before a preview URL is made, so a stale photo can't leak one.
  const latestPick = useRef(0);
  const mounted = useRef(true);
  /** The deadline timer of the current photo's answer. */
  const deadline = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (deadline.current) clearTimeout(deadline.current);
    };
  }, []);

  // The AI's part (decision 13). The form may be filled only for the photo it shows, only in fields
  // she hasn't touched, and only before the deadline. One call at a time from this screen: a newer
  // photo waits for the call before it, and an older photo she replaced is never sent at all.
  const draftRef = useRef(draft);
  draftRef.current = draft;
  /** The pick the form belongs to; -1 once saved, so a late answer can't fill the next garment's form. */
  const formPick = useRef(-1);
  const touched = useRef(new Set<AiFilledField>());
  const savedPicks = useRef(new Set<number>());
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const pending = useRef<{ pick: number; answer: Promise<PhotoDescription | null> } | null>(null);

  const resetAi = () => {
    if (deadline.current) clearTimeout(deadline.current);
    deadline.current = null;
    touched.current = new Set();
    setAiFilled(new Set());
    setAiState('idle');
  };

  const fill = (description: PhotoDescription) => {
    if (description.result !== 'ok') {
      setAiState('unclear');
      return;
    }
    const found = prefillFromAttributes(description.attributes);
    const current = draftRef.current;
    const next: ItemDraft = { ...current };
    const filled = new Set<AiFilledField>();
    if (found.type && !current.type && !touched.current.has('type')) {
      next.type = found.type;
      filled.add('type');
    }
    if (found.colorGroup && !current.colorGroup && !touched.current.has('colorGroup')) {
      next.colorGroup = found.colorGroup;
      filled.add('colorGroup');
    }
    if (found.occasions.length > 0 && current.occasions.length === 0 && !touched.current.has('occasions')) {
      next.occasions = found.occasions;
      filled.add('occasions');
    }
    // All fields in one render, so chips never change one by one under her finger.
    setDraft(next);
    setAiFilled(filled);
    setAiState(filled.size > 0 ? 'filled' : 'idle');
  };

  const describe = (pick: number, image: StoredImage) => {
    if (!analysis.isReady()) return;
    setAiState('waiting');
    let expired = false;
    deadline.current = setTimeout(() => {
      expired = true;
      if (mounted.current && formPick.current === pick) setAiState((s) => (s === 'waiting' ? 'idle' : s));
    }, fillDeadlineMs);
    const wanted = () => pick === latestPick.current || savedPicks.current.has(pick);
    const answer = chain.current.then(() => (wanted() ? analysis.describePhoto(image) : null));
    chain.current = answer.catch(() => undefined);
    pending.current = { pick, answer };
    answer.then(
      (description) => {
        if (!mounted.current || expired || formPick.current !== pick) return;
        if (deadline.current) clearTimeout(deadline.current);
        if (description) fill(description);
        else setAiState('idle');
      },
      () => {
        // Not her action: nothing to explain. The garment is sent again after she saves it.
        if (mounted.current && formPick.current === pick) setAiState('idle');
      },
    );
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const pick = ++latestPick.current;
    const isCurrent = () => mounted.current && pick === latestPick.current;
    setSavedName(null);
    formPick.current = -1;
    resetAi();
    setPhoto({ kind: 'working' });
    try {
      const image = await processImage(file, imageDeps);
      if (!isCurrent()) return;
      setPhoto({ kind: 'ready', image, url: URL.createObjectURL(image.blob) });
      formPick.current = pick;
      describe(pick, image);
    } catch {
      if (!isCurrent()) return;
      setPhoto({ kind: 'error' });
    }
  };

  const onChange = (d: ItemDraft) => {
    const changed = new Set<AiFilledField>();
    if (d.type !== draft.type) changed.add('type');
    if (d.colorGroup !== draft.colorGroup) changed.add('colorGroup');
    if (d.occasions !== draft.occasions) changed.add('occasions');
    for (const f of changed) touched.current.add(f);
    if (changed.size > 0) {
      setAiFilled((s) => new Set([...s].filter((f) => !changed.has(f))));
      setAiState((s) => (s === 'filled' ? 'idle' : s));
    }
    setDraft(d);
    setSavedName(null);
  };

  const missing = [...(photo.kind === 'ready' ? [] : ['תמונה']), ...missingFields(draft)];

  const save = async () => {
    if (photo.kind !== 'ready' || !draft.type || !draft.colorGroup || draft.occasions.length === 0) return;
    setSaving(true);
    setError(null);
    const pick = latestPick.current;
    const asked = pending.current?.pick === pick ? pending.current.answer : null;
    try {
      const item = await addItem(
        { name: finalName(draft), type: draft.type, colorGroup: draft.colorGroup, occasions: draft.occasions },
        photo.image,
      );
      // The whole answer for this photo is stored with the garment, every attribute, also those the
      // form doesn't show; it is never paid for twice. Without one, the queue sends it (§7).
      const queue = () => void analysis.analyse(item.id, 'new', item);
      if (asked) {
        savedPicks.current.add(pick);
        asked.then(
          (description) => {
            if (!description) return queue();
            setItemAnalysis(item.id, { ...description, photoRevision: item.photoRevision } as ItemAnalysis).catch(() => undefined);
          },
          queue,
        );
      } else {
        queue();
      }
      formPick.current = -1;
      resetAi();
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
              {aiState === 'waiting' ? (
                <p className="muted ai-waiting" role="status">
                  <Icon name="sparkle" size={16} />
                  ה־AI מסתכל על הבגד…
                </p>
              ) : aiState === 'unclear' ? (
                <p className="muted">ה־AI לא הצליח לזהות את הבגד בתמונה. כדאי לצלם על רקע חלק ובהיר.</p>
              ) : (
                <span className="muted" style={{ fontSize: 12 }}>
                  טיפ: לצלם על רקע חלק ובהיר
                </span>
              )}
            </div>
          </div>
        </div>

        <ItemFields draft={draft} onChange={onChange} aiFilled={aiFilled} />
      </div>

      <div className="action-bar">
        {savedName && <Toast text={`"${savedName}" נשמר בארון`} actionLabel="לארון" onAction={onOpenCloset} />}
        {error && <p className="error">{error}</p>}
        {aiState === 'filled' && !savedName && (
          <p className="muted" role="status" style={{ textAlign: 'center' }}>
            ה־AI מילא את הפרטים · בדקי שהכול נכון
          </p>
        )}
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
