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
import { ColorPicker, Icon } from './common';

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

/** A field the AI filled on the add screen, until she touches it. */
export type AiFilledField = 'type' | 'occasions' | 'colorGroup';

/** The small sparkle after a label the AI filled (docs/ai-item-attributes.md decision 13). */
function AiMark({ on }: { on: boolean }) {
  if (!on) return null;
  return (
    <span className="ai-field-mark" role="img" aria-label="מולא על ידי ה־AI">
      <Icon name="sparkle" size={14} />
    </span>
  );
}

export function ItemFields({
  draft,
  onChange,
  aiFilled,
}: {
  draft: ItemDraft;
  onChange: (d: ItemDraft) => void;
  /** Fields the AI filled and she hasn't touched yet; only the add screen passes them. */
  aiFilled?: ReadonlySet<AiFilledField>;
}) {
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
          <AiMark on={aiFilled?.has('type') ?? false} />
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
          <AiMark on={aiFilled?.has('occasions') ?? false} />
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
        <span className="label">
          איזה צבע?
          <AiMark on={aiFilled?.has('colorGroup') ?? false} />
        </span>
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
