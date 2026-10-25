import { useState } from 'react';
import { useCloset } from '../app/ClosetContext';
import { OCCASION_LABEL, SLOTS, slotOf, type Item, type ItemStatus, type Slot } from '../core/model';
import { Garment, Icon, Sheet, Toast, explainedElsewhere } from './common';
import { ItemFields, finalName, missingFields, type ItemDraft } from './ItemFields';

type Tab = Slot | 'outgrown';

const TAB_LABEL: Record<Tab, string> = {
  layer: 'שכבות עליונות',
  top: 'חולצות',
  bottom: 'מכנסיים',
  outgrown: 'קטן עליי',
};

const TABS: Tab[] = [...SLOTS, 'outgrown'];

function inTab(item: Item, tab: Tab): boolean {
  return tab === 'outgrown' ? item.status === 'outgrown' : item.status === 'active' && slotOf(item.type) === tab;
}

interface Undo {
  text: string;
  ids: string[];
  previous: ItemStatus;
}

export function Closet({ onOpenParent, onOpenSettings }: { onOpenParent: () => void; onOpenSettings: () => void }) {
  const { data, setStatus } = useCloset();
  const [tab, setTab] = useState<Tab>('top');
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<Item | null>(null);
  const [undo, setUndo] = useState<Undo | null>(null);
  const [error, setError] = useState<string | null>(null);

  const visible = data.items.filter((it) => inTab(it, tab));
  const activeCount = data.items.filter((it) => it.status === 'active').length;
  const isOutgrownTab = tab === 'outgrown';

  const changeTab = (t: Tab) => {
    setTab(t);
    setSelected(new Set());
  };

  /** Moves items between the closet and "קטן עליי". Throws on failure; the caller shows the error where she is looking. */
  const move = async (ids: string[], to: ItemStatus) => {
    setError(null);
    await setStatus(ids, to);
    setUndo({
      text: to === 'outgrown' ? `הועבר ל"קטן עליי" (${ids.length})` : `הוחזר לארון (${ids.length})`,
      ids,
      previous: to === 'outgrown' ? 'active' : 'outgrown',
    });
    setSelected(new Set());
    setSelecting(false);
    setEditing(null);
  };

  const moveSelected = async () => {
    try {
      await move([...selected], isOutgrownTab ? 'active' : 'outgrown');
    } catch (err) {
      if (!explainedElsewhere(err)) setError('לא הצלחנו לשמור. נסי שוב.');
    }
  };

  const undoMove = async () => {
    if (!undo) return;
    setError(null);
    try {
      await setStatus(undo.ids, undo.previous);
      setUndo(null);
    } catch (err) {
      if (!explainedElsewhere(err)) setError('לא הצלחנו לבטל. נסי שוב.');
    }
  };

  // Shown in the action bar, next to the button or toast she just tapped, never below a long list.
  const errorLine = error && (
    <p className="error" role="alert">
      {error}
    </p>
  );

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <>
      <div className="screen">
        <div className="screen-header">
          <div>
            <h1>הארון שלי</h1>
            <p className="muted">{selecting ? (selected.size ? `נבחרו ${selected.size}` : 'סמני בגדים') : `${activeCount} בגדים בארון`}</p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {selecting ? (
              <button type="button" className="small-btn" aria-pressed="true" onClick={() => { setSelecting(false); setSelected(new Set()); }}>
                ביטול
              </button>
            ) : (
              <>
                <button type="button" className="labeled-icon-btn" onClick={onOpenSettings}>
                  <Icon name="gear" size={22} />
                  הגדרות
                </button>
                <button type="button" className="icon-btn parent-btn" aria-label="אזור הורים" onClick={onOpenParent}>
                  <Icon name="lock" size={18} />
                </button>
                <button type="button" className="small-btn" onClick={() => { setSelecting(true); setUndo(null); }} disabled={visible.length === 0}>
                  בחירה
                </button>
              </>
            )}
          </div>
        </div>

        <div className="chips scroll" role="group" aria-label="קטגוריה">
          {TABS.map((t) => (
            <button key={t} type="button" className="chip" aria-pressed={tab === t} onClick={() => changeTab(t)}>
              {TAB_LABEL[t]} ({data.items.filter((it) => inTab(it, t)).length})
            </button>
          ))}
        </div>

        {visible.length === 0 ? (
          <div className="center-message muted">
            {isOutgrownTab ? 'אין כאן בגדים. בגדים שקטנים עלייך יופיעו כאן.' : 'אין עדיין בגדים כאן. אפשר להוסיף בלשונית "הוספה".'}
          </div>
        ) : (
          <div className="grid">
            {visible.map((it) => {
              const on = selected.has(it.id);
              return (
                <button
                  key={it.id}
                  type="button"
                  className="card"
                  aria-pressed={selecting ? on : undefined}
                  aria-label={selecting ? it.name : `עריכת ${it.name}`}
                  onClick={() => (selecting ? toggle(it.id) : setEditing(it))}
                >
                  <div className="thumb">
                    <Garment item={it} height={100} />
                  </div>
                  <span style={{ fontSize: 14, fontWeight: 500 }}>{it.name}</span>
                  <span className="tags">
                    {it.occasions.map((o) => (
                      <span key={o} className="tag">
                        {OCCASION_LABEL[o]}
                      </span>
                    ))}
                  </span>
                  {selecting && (
                    <span className={`check${on ? ' on' : ''}`} aria-hidden="true">
                      {on && <Icon name="check" size={16} />}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {undo && !selecting && (
        <div className="action-bar">
          {errorLine}
          <Toast text={undo.text} actionLabel="ביטול" onAction={undoMove} />
        </div>
      )}

      {selecting && (
        <div className="action-bar">
          {errorLine}
          <button type="button" className="btn btn-dark" disabled={selected.size === 0} onClick={moveSelected}>
            {isOutgrownTab ? `החזרה לארון (${selected.size})` : `העברה ל"קטן עליי" (${selected.size})`}
          </button>
        </div>
      )}

      {editing && (
        <ItemEditor
          item={editing}
          onClose={() => setEditing(null)}
          onMove={() => move([editing.id], editing.status === 'outgrown' ? 'active' : 'outgrown')}
        />
      )}
    </>
  );
}

function ItemEditor({ item, onClose, onMove }: { item: Item; onClose: () => void; onMove: () => Promise<void> }) {
  const { updateItem } = useCloset();
  const [draft, setDraft] = useState<ItemDraft>({
    name: item.name,
    type: item.type,
    colorGroup: item.colorGroup,
    occasions: item.occasions,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const missing = missingFields(draft);

  const save = async () => {
    if (missing.length > 0 || !draft.type || !draft.colorGroup) return;
    setSaving(true);
    setError(null);
    try {
      await updateItem(item.id, {
        name: finalName(draft),
        type: draft.type,
        colorGroup: draft.colorGroup,
        occasions: draft.occasions,
      });
      onClose();
    } catch (err) {
      if (!explainedElsewhere(err)) setError('לא הצלחנו לשמור. נסי שוב.');
      setSaving(false);
    }
  };

  // On success the closet screen closes this sheet; on failure the error shows here, where she is looking.
  const move = async () => {
    setSaving(true);
    setError(null);
    try {
      await onMove();
    } catch (err) {
      if (!explainedElsewhere(err)) setError('לא הצלחנו לשמור. נסי שוב.');
      setSaving(false);
    }
  };

  return (
    <Sheet title="עריכת בגד" onClose={onClose}>
      <div className="photo-pick">
        <div className="thumb">
          <Garment item={item} height={110} />
        </div>
      </div>
      <ItemFields draft={draft} onChange={setDraft} />
      {missing.length > 0 && <p className="muted">חסר: {missing.join(', ')}</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="btn-row">
        <button type="button" className="btn" onClick={move} disabled={saving}>
          {item.status === 'outgrown' ? 'החזרה לארון' : 'קטן עליי'}
        </button>
        <button type="button" className="btn btn-primary" onClick={save} disabled={missing.length > 0 || saving}>
          שמירה
        </button>
      </div>
    </Sheet>
  );
}
