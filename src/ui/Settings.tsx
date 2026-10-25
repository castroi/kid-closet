import type { ThemeChoice } from '../app/theme';
import { Icon, Sheet } from './common';

const OPTIONS: { value: ThemeChoice; label: string; icon: 'phone' | 'sun' | 'moon' }[] = [
  { value: 'system', label: 'כמו בטלפון', icon: 'phone' },
  { value: 'light', label: 'בהיר', icon: 'sun' },
  { value: 'dark', label: 'כהה', icon: 'moon' },
];

export function Settings({
  theme,
  onThemeChange,
  onClose,
}: {
  theme: ThemeChoice;
  onThemeChange: (choice: ThemeChoice) => void;
  onClose: () => void;
}) {
  return (
    <Sheet title="הגדרות" onClose={onClose}>
      <div className="field" role="group" aria-label="מראה">
        <span className="label">מראה</span>
        <div className="segmented theme-options">
          {OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              className="chip"
              aria-pressed={theme === o.value}
              onClick={() => onThemeChange(o.value)}
            >
              <Icon name={o.icon} size={24} />
              {o.label}
            </button>
          ))}
        </div>
      </div>
      <button type="button" className="btn btn-dark" onClick={onClose}>
        סיום
      </button>
    </Sheet>
  );
}
