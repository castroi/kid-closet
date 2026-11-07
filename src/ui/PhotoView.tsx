import { useEffect, useRef } from 'react';
import { COLOR_INFO, type Item } from '../core/model';
import { Icon, useImageUrl } from './common';

/** A finger moving down this far closes the view. */
const SWIPE_DOWN_PX = 60;

/**
 * One garment's photo, as big as the screen allows, to check its colour and details.
 * Only for looking: closing it in any way (✕, a tap beside the photo, a swipe down, Escape)
 * never changes what she picked.
 */
export function PhotoView({ item, onClose }: { item: Item; onClose: () => void }) {
  const url = useImageUrl(item.image);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const startY = useRef<number | null>(null);

  useEffect(() => {
    closeRef.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="photo-view"
      role="dialog"
      aria-modal="true"
      aria-label={item.name}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onPointerDown={(e) => {
        startY.current = e.clientY;
      }}
      onPointerUp={(e) => {
        const from = startY.current;
        startY.current = null;
        if (from !== null && e.clientY - from > SWIPE_DOWN_PX) onClose();
      }}
      onPointerCancel={() => {
        startY.current = null;
      }}
    >
      <button ref={closeRef} type="button" className="icon-btn photo-view-close" aria-label="סגירה" onClick={onClose}>
        <Icon name="close" />
      </button>
      {url ? (
        <img className="photo-view-img" src={url} alt={item.name} draggable={false} decoding="async" />
      ) : (
        <div
          className="garment-placeholder photo-view-placeholder"
          style={{ background: COLOR_INFO[item.colorGroup].hex }}
          role="img"
          aria-label={item.name}
        />
      )}
      <p className="photo-view-name">{item.name}</p>
    </div>
  );
}
