import { useRef, useState } from 'react';
import { useCloset } from '../app/ClosetContext';
import {
  NO_FILTER,
  applyFilter,
  availableColors,
  hasOutfit,
  resolveSelection,
  slotPool,
  stepSelection,
  type SlotFilter,
} from '../core/closet';
import {
  COLOR_INFO,
  ITEM_TYPES,
  OCCASIONS,
  OCCASION_LABEL,
  SLOT_LABEL,
  TYPE_INFO,
  type Item,
  type Occasion,
  type Outfit,
  type Slot,
} from '../core/model';
import { ColorPicker, Garment, Icon, Sheet, Swatch, Toast, explainedElsewhere } from './common';

/** November to March counts as cold by default (Israel). */
export function isColdSeason(date: Date): boolean {
  const month = date.getMonth();
  return month >= 10 || month <= 2;
}

const COLD_BOTTOM: SlotFilter = { type: 'pants', color: null };

type Filters = Record<Slot, SlotFilter>;
type Selection = Record<Slot, string | null>;

interface Props {
  initialOutfit?: Outfit | null;
  today?: Date;
  onOpenFavorites: () => void;
}

export function DressUp({ initialOutfit = null, today = new Date(), onOpenFavorites }: Props) {
  const { data, addOutfit } = useCloset();
  const [occasion, setOccasion] = useState<Occasion>(initialOutfit?.occasion ?? 'school');
  const [cold, setCold] = useState<boolean>(initialOutfit ? initialOutfit.layerId !== null : isColdSeason(today));
  const [layerOn, setLayerOn] = useState<boolean>(initialOutfit ? initialOutfit.layerId !== null : true);
  const [filters, setFilters] = useState<Filters>(() => ({
    layer: NO_FILTER,
    top: NO_FILTER,
    bottom: !initialOutfit && cold ? COLD_BOTTOM : NO_FILTER,
  }));
  const [selected, setSelected] = useState<Selection>({
    layer: initialOutfit?.layerId ?? null,
    top: initialOutfit?.topId ?? null,
    bottom: initialOutfit?.bottomId ?? null,
  });
  const [sheet, setSheet] = useState<Slot | null>(null);
  const [preview, setPreview] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [saveError, setSaveError] = useState(false);

  const slots: Slot[] = cold ? ['layer', 'top', 'bottom'] : ['top', 'bottom'];

  const view = (slot: Slot) => {
    const pool = slotPool(data.items, slot, occasion);
    const list = applyFilter(pool, filters[slot]);
    const off = slot === 'layer' && !layerOn;
    const current = off ? null : resolveSelection(list, selected[slot]);
    return { pool, list, off, current };
  };

  const layer = cold ? view('layer').current : null;
  const top = view('top').current;
  const bottom = view('bottom').current;
  const canPreview = top !== null && bottom !== null;

  const setFilter = (slot: Slot, filter: SlotFilter) => {
    setFilters((f) => ({ ...f, [slot]: filter }));
    setJustSaved(false);
  };

  const step = (slot: Slot, list: Item[], delta: 1 | -1) => {
    setSelected((s) => ({ ...s, [slot]: stepSelection(list, s[slot], delta) }));
    setJustSaved(false);
  };

  const chooseOccasion = (o: Occasion) => {
    setOccasion(o);
    // Colours rarely carry over between occasions; keep the type filter, drop the colour.
    setFilters((f) => ({
      layer: { ...f.layer, color: null },
      top: { ...f.top, color: null },
      bottom: { ...f.bottom, color: null },
    }));
    setJustSaved(false);
  };

  const chooseWeather = (isCold: boolean) => {
    setCold(isCold);
    setFilters((f) => ({ ...f, bottom: { ...f.bottom, type: isCold ? 'pants' : null } }));
    setJustSaved(false);
  };

  const outfitInput = canPreview
    ? { occasion, layerId: layer?.id ?? null, topId: top.id, bottomId: bottom.id }
    : null;
  const alreadySaved = outfitInput !== null && hasOutfit(data, outfitInput);

  const save = async () => {
    if (!outfitInput) return;
    setSaveError(false);
    try {
      await addOutfit(outfitInput);
      setJustSaved(true);
    } catch (err) {
      setSaveError(!explainedElsewhere(err));
    }
  };

  if (preview && canPreview) {
    return (
      <div className="screen">
        <div className="screen-header">
          <h1>הלוק של היום</h1>
        </div>
        <div className="preview">
          <span className="badge">{OCCASION_LABEL[occasion]}</span>
          <div className="preview-top">
            {layer && (
              <div style={{ width: '38%' }}>
                <Garment item={layer} height={130} />
              </div>
            )}
            <div style={{ width: layer ? '55%' : '70%' }}>
              <Garment item={top} height={180} />
            </div>
          </div>
          <div style={{ width: '60%' }}>
            <Garment item={bottom} height={220} />
          </div>
          <ul className="muted" style={{ listStyle: 'none', padding: 0, margin: 0, textAlign: 'center' }}>
            {layer && <li>{layer.name}</li>}
            <li>{top.name}</li>
            <li>{bottom.name}</li>
          </ul>
        </div>
        {justSaved && <Toast text="נשמר במועדפים" actionLabel="למועדפים" onAction={onOpenFavorites} />}
        {saveError && <p className="error">השמירה לא הצליחה. נסי שוב.</p>}
        <div className="btn-row">
          <button type="button" className="btn" onClick={() => setPreview(false)}>
            לשנות משהו
          </button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={alreadySaved}>
            <Icon name="heart" filled={alreadySaved} />
            {alreadySaved ? 'שמור במועדפים' : 'לשמור'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="screen">
      <div className="screen-header">
        <h1>לאן הולכים היום?</h1>
        <div className="switch" role="group" aria-label="מזג אוויר">
          <button type="button" aria-pressed={cold} onClick={() => chooseWeather(true)}>
            קר
          </button>
          <button type="button" aria-pressed={!cold} onClick={() => chooseWeather(false)}>
            חם
          </button>
        </div>
      </div>

      <div className="segmented" role="group" aria-label="לאן הולכים">
        {OCCASIONS.map((o) => (
          <button key={o} type="button" className="chip" aria-pressed={occasion === o} onClick={() => chooseOccasion(o)}>
            {OCCASION_LABEL[o]}
          </button>
        ))}
      </div>

      <div className="rows">
        {slots.map((slot) => {
          const { list, off, current } = view(slot);
          const filter = filters[slot];
          const filterParts = [
            filter.type ? TYPE_INFO[filter.type].short : null,
            filter.color ? COLOR_INFO[filter.color].label : null,
          ].filter(Boolean);
          const hasFilter = filterParts.length > 0;
          return (
            <section key={slot} aria-label={SLOT_LABEL[slot]}>
              <div className="row-header">
                <h2>{SLOT_LABEL[slot]}</h2>
                {hasFilter && (
                  <button
                    type="button"
                    className="filter-tag"
                    aria-label={`ניקוי סינון: ${filterParts.join(' ')}`}
                    onClick={() => setFilter(slot, NO_FILTER)}
                  >
                    {filter.color && <Swatch color={filter.color} />}
                    <span>{filterParts.join(' · ')}</span>
                    <Icon name="close" size={12} />
                  </button>
                )}
                <span className="spacer" />
                {slot === 'layer' && (
                  <button
                    type="button"
                    className="small-btn"
                    aria-pressed={!layerOn}
                    onClick={() => {
                      setLayerOn((v) => !v);
                      setJustSaved(false);
                    }}
                  >
                    בלי
                  </button>
                )}
                <button
                  type="button"
                  className="small-btn"
                  onClick={() => setSheet(slot)}
                  disabled={off}
                  aria-label={`סוג וצבע של ${SLOT_LABEL[slot]}`}
                >
                  <Icon name="filter" size={16} />
                  סוג וצבע
                </button>
              </div>
              {off ? (
                <div className="empty-slot">בלי שכבה עליונה היום</div>
              ) : current ? (
                <Carousel
                  item={current}
                  index={list.indexOf(current)}
                  total={list.length}
                  height={cold ? 112 : 150}
                  onStep={(d) => step(slot, list, d)}
                />
              ) : (
                <div className="empty-slot">
                  {hasFilter ? 'אין בגדים שמתאימים לסינון' : 'אין עדיין בגדים כאן. אפשר להוסיף בלשונית "הוספה".'}
                  {hasFilter && (
                    <button type="button" className="chip" onClick={() => setFilter(slot, NO_FILTER)}>
                      לבטל סינון
                    </button>
                  )}
                </div>
              )}
            </section>
          );
        })}
      </div>

      <button type="button" className="btn btn-primary" disabled={!canPreview} onClick={() => setPreview(true)}>
        <Icon name="eye" />
        {canPreview ? 'לראות את הלוק' : 'צריך לבחור חולצה ומכנסיים'}
      </button>

      {sheet && (
        <FilterSheet
          slot={sheet}
          pool={view(sheet).pool}
          filter={filters[sheet]}
          onChange={(f) => setFilter(sheet, f)}
          onClose={() => setSheet(null)}
        />
      )}
    </div>
  );
}

function Carousel({
  item,
  index,
  total,
  height,
  onStep,
}: {
  item: Item;
  index: number;
  total: number;
  height: number;
  onStep: (delta: 1 | -1) => void;
}) {
  const startX = useRef<number | null>(null);
  return (
    <div
      className="carousel"
      onPointerDown={(e) => {
        startX.current = e.clientX;
      }}
      onPointerUp={(e) => {
        if (startX.current === null) return;
        const dx = e.clientX - startX.current;
        startX.current = null;
        if (Math.abs(dx) > 40 && total > 1) onStep(dx < 0 ? 1 : -1);
      }}
    >
      <button type="button" className="icon-btn step" aria-label="הקודם" onClick={() => onStep(-1)} disabled={total < 2}>
        <Icon name="prev" />
      </button>
      <div className="garment-box">
        <Garment item={item} height={height} />
        <span className="garment-name">
          {item.name} <span className="count">· {index + 1}/{total}</span>
        </span>
      </div>
      <button type="button" className="icon-btn step" aria-label="הבא" onClick={() => onStep(1)} disabled={total < 2}>
        <Icon name="next" />
      </button>
    </div>
  );
}

export function FilterSheet({
  slot,
  pool,
  filter,
  onChange,
  onClose,
}: {
  slot: Slot;
  pool: Item[];
  filter: SlotFilter;
  onChange: (filter: SlotFilter) => void;
  onClose: () => void;
}) {
  const types = ITEM_TYPES.filter((t) => TYPE_INFO[t].slot === slot);
  const byType = applyFilter(pool, { type: filter.type, color: null });
  const colors = availableColors(byType);
  if (filter.color && !colors.includes(filter.color)) colors.push(filter.color);
  const count = applyFilter(pool, filter).length;

  return (
    <Sheet title={`סינון ${SLOT_LABEL[slot]}`} onClose={onClose}>
      <p className="muted" aria-live="polite">
        נמצאו {count}
      </p>
      <div className="field">
        <span className="label">סוג</span>
        <div className="chips">
          <button type="button" className="chip" aria-pressed={filter.type === null} onClick={() => onChange({ ...filter, type: null })}>
            הכל
          </button>
          {types.map((t) => (
            <button key={t} type="button" className="chip" aria-pressed={filter.type === t} onClick={() => onChange({ ...filter, type: t })}>
              {TYPE_INFO[t].short}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <span className="label">צבע</span>
        {colors.length === 0 ? (
          <p className="muted">אין בגדים בסוג הזה</p>
        ) : (
          <ColorPicker
            colors={colors}
            value={filter.color}
            onChange={(c) => onChange({ ...filter, color: filter.color === c ? null : c })}
          />
        )}
      </div>
      <div className="btn-row">
        <button type="button" className="btn" onClick={() => onChange(NO_FILTER)}>
          ניקוי
        </button>
        <button type="button" className="btn btn-dark" onClick={onClose}>
          סיום
        </button>
      </div>
    </Sheet>
  );
}
