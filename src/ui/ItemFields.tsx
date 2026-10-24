import { useId } from 'react';
import {
  COLOR_GROUPS,
  ITEM_TYPES,
  OCCASIONS,
  OCCASION_LABEL,
  TYPE_INFO,
  defaultName,
  type ColorGroup,
  type ItemType,
  type Occasion,
} from '../core/model';
import { ColorPicker } from './common';

export interface ItemDraft {
  name: string;
  type: ItemType | null;
  colorGroup: ColorGroup | null;
  occasions: Occasion[];
}

export function missingFields(d: ItemDraft): string[] {
  const missing: string[] = [];
  if (!d.type) missing.push('סוג');
  if (d.occasions.length === 0) missing.push('לאן לובשים');
  if (!d.colorGroup) missing.push('צבע');
  return missing;
}

/** The name to store: what was typed, or "<type> <colour>". */
export function finalName(d: ItemDraft): string {
  const typed = d.name.trim();
  if (typed) return typed;
  return d.type && d.colorGroup ? defaultName(d.type, d.colorGroup) : '';
}

export function ItemFields({ draft, onChange }: { draft: ItemDraft; onChange: (d: ItemDraft) => void }) {
  const nameId = useId();
  const toggleOccasion = (o: Occasion) =>
    onChange({
      ...draft,
      occasions: draft.occasions.includes(o) ? draft.occasions.filter((x) => x !== o) : [...draft.occasions, o],
    });

  return (
    <>
      <div className="field" role="group" aria-label="מה זה?">
        <span className="label">
          מה זה? <small>(חובה)</small>
        </span>
        <div className="grid" style={{ gap: 8 }}>
          {ITEM_TYPES.map((t) => (
            <button key={t} type="button" className="chip" aria-pressed={draft.type === t} onClick={() => onChange({ ...draft, type: t })}>
              {TYPE_INFO[t].label}
            </button>
          ))}
        </div>
      </div>

      <div className="field" role="group" aria-label="לאן לובשים?">
        <span className="label">
          לאן לובשים? <small>(אפשר כמה)</small>
        </span>
        <div className="segmented">
          {OCCASIONS.map((o) => (
            <button key={o} type="button" className="chip" aria-pressed={draft.occasions.includes(o)} onClick={() => toggleOccasion(o)}>
              {OCCASION_LABEL[o]}
            </button>
          ))}
        </div>
      </div>

      <div className="field" role="group" aria-label="איזה צבע?">
        <span className="label">איזה צבע?</span>
        <ColorPicker colors={COLOR_GROUPS} value={draft.colorGroup} onChange={(c) => onChange({ ...draft, colorGroup: c })} />
      </div>

      <div className="field">
        <label className="label" htmlFor={nameId}>
          שם <small>(לא חובה)</small>
        </label>
        <input
          id={nameId}
          className="text-input"
          type="text"
          value={draft.name}
          placeholder={draft.type && draft.colorGroup ? defaultName(draft.type, draft.colorGroup) : 'למשל: החולצה עם הכוכבים'}
          onChange={(e) => onChange({ ...draft, name: e.target.value })}
          maxLength={60}
        />
      </div>
    </>
  );
}
