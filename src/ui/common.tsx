import { useEffect, useState, type ReactNode } from 'react';
import { useCloset } from '../app/ClosetContext';
import { COLOR_INFO, type ColorGroup, type Item } from '../core/model';

/** Object URL for a stored photo; revoked when the component unmounts or the path changes. */
export function useImageUrl(path: string | null): string | null {
  const { readImage } = useCloset();
  const [loaded, setLoaded] = useState<{ path: string; url: string } | null>(null);

  useEffect(() => {
    if (!path) return;
    let active = true;
    let created: string | null = null;
    readImage(path).then(
      (blob) => {
        if (!active || !blob) return;
        created = URL.createObjectURL(blob);
        setLoaded({ path, url: created });
      },
      () => undefined,
    );
    return () => {
      active = false;
      if (created) URL.revokeObjectURL(created);
    };
  }, [path, readImage]);

  return loaded && loaded.path === path ? loaded.url : null;
}

export function Garment({ item, height }: { item: Item; height: number }) {
  const url = useImageUrl(item.image);
  if (!url) {
    return (
      <div
        className="garment-placeholder"
        style={{ height, width: height, background: COLOR_INFO[item.colorGroup].hex }}
        role="img"
        aria-label={item.name}
      />
    );
  }
  return <img className="garment" src={url} alt={item.name} style={{ height }} draggable={false} />;
}

export function Swatch({ color }: { color: ColorGroup }) {
  return (
    <span
      className={`swatch${color === 'multi' ? ' multi' : ''}`}
      style={{ background: COLOR_INFO[color].hex }}
      aria-hidden="true"
    />
  );
}

export function ColorPicker({
  colors,
  value,
  onChange,
}: {
  colors: ColorGroup[];
  value: ColorGroup | null;
  onChange: (color: ColorGroup) => void;
}) {
  return (
    <div className="colors">
      {colors.map((c) => (
        <button key={c} type="button" className="color-btn" aria-pressed={value === c} onClick={() => onChange(c)}>
          <span
            className={`dot${c === 'multi' ? ' multi' : ''}`}
            style={{ background: COLOR_INFO[c].hex }}
            aria-hidden="true"
          />
          {COLOR_INFO[c].label}
        </button>
      ))}
    </div>
  );
}

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="sheet-header">
          <h2>{title}</h2>
          <button type="button" className="icon-btn" style={{ background: 'var(--bg)' }} aria-label="סגירה" onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Toast({ text, actionLabel, onAction }: { text: string; actionLabel?: string; onAction?: () => void }) {
  return (
    <div className="toast" role="status">
      <span>{text}</span>
      {actionLabel && onAction && (
        <button type="button" onClick={onAction}>
          {actionLabel}
        </button>
      )}
    </div>
  );
}

const ICONS: Record<string, ReactNode> = {
  close: <path d="M6 6l12 12M18 6L6 18" />,
  prev: <path d="M9 6l6 6-6 6" />,
  next: <path d="M15 6l-6 6 6 6" />,
  filter: <path d="M4 6h16M7 12h10M10 18h4" />,
  eye: (
    <>
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  heart: <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" />,
  shirt: <path d="M9 3L4 6l2 4 2-1v12h8V9l2 1 2-4-5-3c-1 2-5 2-6 0z" />,
  closet: (
    <>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M12 3v18M9.5 11v2M14.5 11v2" />
    </>
  ),
  plus: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v8M8 12h8" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </>
  ),
  check: <path d="M5 12l5 5 9-10" />,
  camera: (
    <>
      <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
      <circle cx="12" cy="13" r="3.5" />
    </>
  ),
  back: <path d="M9 6l6 6-6 6" />,
};

export function Icon({ name, size = 20, filled = false }: { name: keyof typeof ICONS; size?: number; filled?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICONS[name]}
    </svg>
  );
}
