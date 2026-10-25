import { useId, useState } from 'react';
import { BackupTooLargeError, InvalidBackupError, readBackupFile } from '../storage/backup';
import { ClosetCorruptedError } from '../storage/repository';

interface Props {
  error: Error;
  onRestore: (zip: Uint8Array) => Promise<void>;
  onRetry?: () => void;
}

/** Error names the browser uses when it refuses or cannot provide storage (e.g. a Safari private tab). */
const STORAGE_ERROR_NAMES = new Set([
  'UnknownError',
  'SecurityError',
  'NotAllowedError',
  'InvalidStateError',
  'NotReadableError',
  'NoModificationAllowedError',
  'QuotaExceededError',
]);

export function isStorageRefusal(error: Error): boolean {
  return STORAGE_ERROR_NAMES.has(error.name);
}

/**
 * Shown when the closet cannot be opened. Three different cases:
 * - the saved files exist but cannot be read → offer a restore from backup;
 * - the phone refused access to storage (e.g. a Safari private tab) → explain and offer a retry;
 * - anything else (an unexpected fault) → say so plainly and offer a retry.
 * Nothing is overwritten in any case.
 */
export function RecoveryScreen({ error, onRestore, onRetry = () => window.location.reload() }: Props) {
  if (error instanceof ClosetCorruptedError) return <RestoreFromBackup error={error} onRestore={onRestore} />;
  if (!isStorageRefusal(error)) {
    return (
      <div className="center-message" dir="rtl">
        <h1>משהו השתבש בפתיחת הארון</h1>
        <p className="muted">קרתה תקלה לא צפויה. הקבצים בטלפון לא נמחקו ולא שונו.</p>
        <p className="muted">אפשר לנסות שוב. אם זה חוזר, כדאי לסגור את האפליקציה ולפתוח אותה מחדש.</p>
        <button type="button" className="btn btn-dark" onClick={onRetry}>
          לנסות שוב
        </button>
        <p className="muted" style={{ fontSize: 12 }}>
          {error.message}
        </p>
      </div>
    );
  }
  return (
    <div className="center-message" dir="rtl">
      <h1>אין גישה לאחסון בטלפון</h1>
      <p className="muted">
        הדפדפן לא מאפשר לאפליקציה לשמור קבצים. זה קורה בגלישה פרטית או כשפותחים את הקישור מתוך אפליקציה אחרת.
      </p>
      <p className="muted">צריך לפתוח את האפליקציה ב־Safari רגיל, או מהסמל במסך הבית.</p>
      <button type="button" className="btn btn-dark" onClick={onRetry}>
        לנסות שוב
      </button>
      <p className="muted" style={{ fontSize: 12 }}>
        {error.message}
      </p>
    </div>
  );
}

function RestoreFromBackup({ error, onRestore }: { error: Error; onRestore: (zip: Uint8Array) => Promise<void> }) {
  const id = useId();
  const [message, setMessage] = useState<string | null>(null);
  return (
    <div className="center-message" dir="rtl">
      <h1>לא הצלחנו לפתוח את הארון</h1>
      <p className="muted">הקבצים בטלפון פגומים. אפשר לשחזר מקובץ גיבוי.</p>
      <p className="muted" style={{ fontSize: 12 }}>
        {error.message}
      </p>
      <label className="btn btn-dark file-btn" htmlFor={id}>
        שחזור מגיבוי
        <input
          id={id}
          type="file"
          accept=".zip,application/zip"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            try {
              await onRestore(await readBackupFile(file));
            } catch (err) {
              setMessage(
                err instanceof BackupTooLargeError
                  ? 'קובץ הגיבוי גדול מדי לשחזור בטלפון.'
                  : err instanceof InvalidBackupError
                    ? 'הקובץ אינו גיבוי תקין.'
                    : 'השחזור נכשל.',
              );
            }
          }}
        />
      </label>
      {message && (
        <p role="alert" className="error">
          {message}
        </p>
      )}
    </div>
  );
}
