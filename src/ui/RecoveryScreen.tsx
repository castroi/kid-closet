import { useId, useState } from 'react';
import { InvalidBackupError } from '../storage/backup';
import { blobToBytes } from '../storage/fileStore';
import { ClosetCorruptedError } from '../storage/repository';

interface Props {
  error: Error;
  onRestore: (zip: Uint8Array) => Promise<void>;
  onRetry?: () => void;
}

/**
 * Shown when the closet cannot be opened. Two different cases:
 * - the saved files exist but cannot be read → offer a restore from backup;
 * - the phone refused access to storage (e.g. a Safari private tab) → explain and offer a retry.
 * Nothing is overwritten in either case.
 */
export function RecoveryScreen({ error, onRestore, onRetry = () => window.location.reload() }: Props) {
  if (!(error instanceof ClosetCorruptedError)) {
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
  return <RestoreFromBackup error={error} onRestore={onRestore} />;
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
              await onRestore(await blobToBytes(file));
            } catch (err) {
              setMessage(err instanceof InvalidBackupError ? 'הקובץ אינו גיבוי תקין.' : 'השחזור נכשל.');
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
