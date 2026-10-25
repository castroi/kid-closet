import { useEffect, useRef } from 'react';
import { NO_FILTER, applyFilter, availableColors, type SlotFilter } from '../core/closet';
import { galleryCount, galleryTitle, isFiltered, noMatchLabel, showAllLabel } from '../core/gallery';
import { COLOR_INFO, ITEM_TYPES, TYPE_INFO, type Item, type Slot } from '../core/model';
import { ColorPicker, Garment, Icon, Sheet } from './common';

interface Props {
  slot: Slot;
  /** Everything that fits this row right now (occasion, status), before the row's filter. */
  pool: Item[];
  filter: SlotFilter;
  selectedId: string | null;
  /** What the other rows currently show, for colour matching. */
  context: Item[];
  onFilterChange: (filter: SlotFilter) => void;
  onPick: (id: string) => void;
  onClose: () => void;
}

/**
 * A grid of the row's garments. It uses the row's own filter (one filter per row):
 * changing or clearing it here changes the row too.
 */
export function Gallery({ slot, pool, filter, selectedId, context, onFilterChange, onPick, onClose }: Props) {
  const list = applyFilter(pool, filter);
  const filtered = isFiltered(filter);
  const current = list.find((it) => it.id === selectedId) ?? list[0] ?? null;
  const types = ITEM_TYPES.filter((t) => TYPE_INFO[t].slot === slot);
  const colors = availableColors(applyFilter(pool, { type: filter.type, color: null }));
  if (filter.color && !colors.includes(filter.color)) colors.push(filter.color);
  const filterText = [filter.type ? TYPE_INFO[filter.type].short : null, filter.color ? COLOR_INFO[filter.color].label : null]
    .filter(Boolean)
    .join(' · ');

  const currentRef = useRef<HTMLButtonElement | null>(null);
  const currentId = current?.id ?? null;
  useEffect(() => {
    // Show the garment she's wearing now, even if it's far down the grid.
    currentRef.current?.scrollIntoView?.({ block: 'center' });
  }, [currentId]);

  return (
    <Sheet title={galleryTitle(slot, filter)} onClose={onClose} className="tall">
      <div className="gallery-head">
        <p className="muted" aria-live="polite">
          {galleryCount(list.length, pool.length, filtered)}
        </p>
        {filtered && (
          <button type="button" className="clear-chip" aria-label={`ביטול הסינון: ${filterText}`} onClick={() => onFilterChange(NO_FILTER)}>
            {filter.color && <span className={`swatch${filter.color === 'multi' ? ' multi' : ''}`} style={{ background: COLOR_INFO[filter.color].hex }} aria-hidden="true" />}
            {filterText}
            <Icon name="close" size={14} />
          </button>
        )}
        {context.length > 0 && (
          <div className="look-strip">
            <span className="muted">כרגע בלוק:</span>
            {context.map((it) => (
              <span key={it.id} className="look-thumb">
                <Garment item={it} height={36} />
              </span>
            ))}
          </div>
        )}
        <div className="chips scroll-row" role="group" aria-label="סוג">
          <button type="button" className="chip" aria-pressed={filter.type === null} onClick={() => onFilterChange({ ...filter, type: null })}>
            הכל
          </button>
          {types.map((t) => (
            <button key={t} type="button" className="chip" aria-pressed={filter.type === t} onClick={() => onFilterChange({ ...filter, type: t })}>
              {TYPE_INFO[t].short}
            </button>
          ))}
        </div>
        {colors.length > 0 && (
          <ColorPicker
            compact
            colors={colors}
            value={filter.color}
            onChange={(c) => onFilterChange({ ...filter, color: filter.color === c ? null : c })}
          />
        )}
      </div>

      <div className="gallery-scroll">
        {list.length === 0 ? (
          <div className="empty-slot">
            {pool.length === 0 ? 'אין עדיין בגדים כאן. אפשר להוסיף בלשונית "הוספה".' : noMatchLabel(slot)}
            {filtered && (
              <button type="button" className="btn btn-dark" onClick={() => onFilterChange(NO_FILTER)}>
                לבטל סינון
              </button>
            )}
          </div>
        ) : (
          <div className="gallery-grid">
            {list.map((it) => {
              const isCurrent = it.id === current?.id;
              return (
                <button
                  key={it.id}
                  ref={isCurrent ? currentRef : undefined}
                  type="button"
                  className="gallery-tile"
                  aria-current={isCurrent ? 'true' : undefined}
                  aria-label={it.name}
                  onClick={() => onPick(it.id)}
                >
                  <span className="gallery-photo">
                    <Garment item={it} height={150} />
                  </span>
                  <span className="gallery-name">{it.name}</span>
                  {isCurrent && (
                    <span className="check on" aria-hidden="true">
                      <Icon name="check" size={16} />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
        {filtered && list.length > 0 && list.length < pool.length && (
          <button type="button" className="btn show-all" onClick={() => onFilterChange(NO_FILTER)}>
            {showAllLabel(slot, pool.length)}
          </button>
        )}
      </div>
    </Sheet>
  );
}
