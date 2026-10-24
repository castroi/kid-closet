import { useId, useState } from 'react';
import { InvalidBackupError } from '../storage/backup';
import { blobToBytes } from '../storage/fileStore';

/** Shown when the saved closet exists but cannot be read. Nothing is overwritten until a backup is restored. */
export function RecoveryScreen({ error, onRestore }: { error: Error; onRestore: (zip: Uint8Array) => Promise<void> }) {
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
