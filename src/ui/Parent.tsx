import { useEffect, useId, useRef, useState } from 'react';
import { useCloset } from '../app/ClosetContext';
import { BUILD_INFO, REPO_URL, commitUrl, shortCommit, type BuildInfo } from '../app/buildInfo';
import {
  daysSince,
  formatBytes,
  readStorageStatus,
  shareOrDownload,
  type ShareEnv,
  type StorageLike,
  type StorageStatus,
} from '../app/device';
import { COLOR_INFO } from '../core/model';
import type { ImageDeps } from '../image/processImage';
import { backupFileName, readBackupFile } from '../storage/backup';
import { browserDeviceStorage, type DeviceStorage } from '../app/aiDevice';
import { AiPanel, AiSettingsScreen } from './AiSettings';
import { LooksToFix } from './LooksToFix';
import { Icon, Sheet, Swatch, restoreErrorText } from './common';

export const BACKUP_REMINDER_DAYS = 14;

/** Until AI looks are in backups (PR 6 of docs/ai-doll-look.md), say so where it matters: each one was paid for. */
const LOOKS_NOT_IN_BACKUP = 'תמונות הבובה מה־AI עוד לא נשמרות בגיבוי, ושחזור ימחק אותן מהטלפון. אפשר ליצור אותן שוב.';

export function randomQuestion(): [number, number] {
  const pick = () => 6 + Math.floor(Math.random() * 4); // 6..9
  return [pick(), pick()];
}

interface Props {
  onBack: () => void;
  imageDeps: ImageDeps;
  /** The phone's own storage for the API key and this month's use; never in the closet or backups. */
  deviceStorage?: DeviceStorage;
  shareEnv: ShareEnv;
  storage?: StorageLike;
  question?: [number, number];
  now?: () => Date;
}

export function Parent({
  onBack,
  imageDeps,
  deviceStorage: givenStorage,
  shareEnv,
  storage,
  question,
  now = () => new Date(),
}: Props) {
  const [unlocked, setUnlocked] = useState(false);
  const [view, setView] = useState<'main' | 'ai' | 'fix'>('main');
  const [deviceStorage] = useState<DeviceStorage>(() => (givenStorage === undefined ? browserDeviceStorage() : givenStorage));
  const shown = unlocked ? view : 'main';
  // Each view starts at its top, not at the scroll position of the one before.
  const screenRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (screenRef.current) screenRef.current.scrollTop = 0;
  }, [shown]);
  const title = shown === 'ai' ? 'הגדרות AI' : shown === 'fix' ? 'לוקים לתיקון' : 'אזור הורים';
  return (
    <div className="screen" ref={screenRef}>
      <div className="screen-header" style={{ justifyContent: 'flex-start' }}>
        <button
          type="button"
          className="icon-btn"
          aria-label={shown === 'main' ? 'חזרה לארון' : 'חזרה לאזור הורים'}
          onClick={shown === 'main' ? onBack : () => setView('main')}
        >
          <Icon name="back" />
        </button>
        <h1>{title}</h1>
      </div>
      {!unlocked ? (
        <Gate question={question} onUnlock={() => setUnlocked(true)} />
      ) : shown === 'ai' ? (
        <AiSettingsScreen deviceStorage={deviceStorage} imageDeps={imageDeps} />
      ) : shown === 'fix' ? (
        <LooksToFix />
      ) : (
        <ParentTools
          shareEnv={shareEnv}
          storage={storage}
          now={now}
          deviceStorage={deviceStorage}
          onOpenAi={() => setView('ai')}
          onOpenFix={() => setView('fix')}
        />
      )}
    </div>
  );
}

function Gate({ question, onUnlock }: { question?: [number, number]; onUnlock: () => void }) {
  const [[a, b]] = useState<[number, number]>(() => question ?? randomQuestion());
  const [answer, setAnswer] = useState('');
  const [wrong, setWrong] = useState(false);
  const id = useId();
  return (
    <form
      className="panel"
      onSubmit={(e) => {
        e.preventDefault();
        if (Number(answer) === a * b) onUnlock();
        else setWrong(true);
      }}
    >
      <label htmlFor={id} className="muted">
        כדי להיכנס, כמה זה {a} × {b}?
      </label>
      <input
        id={id}
        className="text-input"
        inputMode="numeric"
        value={answer}
        onChange={(e) => {
          setAnswer(e.target.value);
          setWrong(false);
        }}
      />
      {wrong && <p className="error">לא נכון</p>}
      <button type="submit" className="btn btn-dark">
        כניסה
      </button>
    </form>
  );
}

function ParentTools({
  shareEnv,
  storage,
  now,
  deviceStorage,
  onOpenAi,
  onOpenFix,
}: {
  shareEnv: ShareEnv;
  storage?: StorageLike;
  now: () => Date;
  deviceStorage: DeviceStorage;
  onOpenAi: () => void;
  onOpenFix: () => void;
}) {
  const api = useCloset();
  const { data } = api;
  const [status, setStatus] = useState<StorageStatus | null>(null);
  const [busy, setBusy] = useState<null | 'export' | 'import' | 'delete'>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [toDelete, setToDelete] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pendingImport, setPendingImport] = useState<Uint8Array | null>(null);
  const [prepared, setPrepared] = useState<Uint8Array | null>(null);
  const importId = useId();

  useEffect(() => {
    let active = true;
    readStorageStatus(storage).then((s) => active && setStatus(s));
    return () => {
      active = false;
    };
  }, [storage, data]);

  const age = daysSince(data.lastBackupAt, now());
  const needsBackup = data.items.length > 0 && (age === null || age >= BACKUP_REMINDER_DAYS);

  const deliver = async (bytes: Uint8Array) => {
    try {
      const done = await shareOrDownload(bytes, backupFileName(now()), shareEnv);
      setPrepared(null);
      if (done) {
        // The backup already exists at this point; failing to record its date only affects the reminder.
        await api.markBackedUp().catch(() => undefined);
        setMessage({ text: 'הגיבוי נוצר. כדאי לשמור אותו ב־iCloud Drive.', error: false });
      }
    } catch (err) {
      // Safari only opens the share sheet right after a tap; preparing many photos can take too long.
      if ((err as { name?: string })?.name === 'NotAllowedError') {
        setPrepared(bytes);
        setMessage({ text: 'הגיבוי מוכן. לחצי "שיתוף הגיבוי" כדי לשמור אותו.', error: false });
      } else {
        setMessage({ text: 'יצירת הגיבוי נכשלה.', error: true });
      }
    }
  };

  const doExport = async () => {
    setBusy('export');
    setMessage(null);
    try {
      await deliver(await api.exportBackup());
    } catch {
      setMessage({ text: 'יצירת הגיבוי נכשלה.', error: true });
    } finally {
      setBusy(null);
    }
  };

  const doImport = async (zip: Uint8Array) => {
    setBusy('import');
    setMessage(null);
    setPendingImport(null);
    try {
      await api.importBackup(zip);
      setMessage({ text: 'השחזור הושלם.', error: false });
    } catch (err) {
      setMessage({ text: restoreErrorText(err), error: true });
    } finally {
      setBusy(null);
    }
  };

  const doDelete = async () => {
    setBusy('delete');
    setMessage(null);
    try {
      const count = toDelete.size;
      await api.deleteItems([...toDelete]);
      setToDelete(new Set());
      setMessage({ text: `נמחקו ${count} בגדים.`, error: false });
    } catch {
      setMessage({ text: 'המחיקה נכשלה.', error: true });
    } finally {
      setConfirmDelete(false);
      setBusy(null);
    }
  };

  return (
    <>
      {message && (
        <p role="status" className={message.error ? 'error' : 'muted'}>
          {message.text}
        </p>
      )}

      <section className="panel" aria-labelledby="backup-h">
        <h2 id="backup-h">גיבוי</h2>
        {needsBackup && (
          <div className="warn">
            {age === null ? 'עוד לא נעשה גיבוי.' : `הגיבוי האחרון לפני ${age} ימים.`} מומלץ לגבות אחרי כל הוספת בגדים.
          </div>
        )}
        <p className="muted">
          הגיבוי הוא קובץ אחד עם כל התמונות והפרטים, כולל הבובה. אם האפליקציה תימחק מהמסך הראשי, אפשר לשחזר ממנו הכל.
        </p>
        {data.aiLooks.length > 0 && <p className="muted">{LOOKS_NOT_IN_BACKUP}</p>}
        {prepared && (
          <button type="button" className="btn btn-primary" onClick={() => deliver(prepared)}>
            שיתוף הגיבוי
          </button>
        )}
        <div className="btn-row">
          <button type="button" className="btn btn-dark" onClick={doExport} disabled={busy !== null}>
            {busy === 'export' ? 'מכין…' : 'ייצוא גיבוי'}
          </button>
          <label className="btn file-btn" htmlFor={importId}>
            {busy === 'import' ? 'משחזר…' : 'שחזור מגיבוי'}
            <input
              id={importId}
              type="file"
              accept=".zip,application/zip"
              disabled={busy !== null}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file) return;
                setMessage(null);
                try {
                  setPendingImport(await readBackupFile(file));
                } catch (err) {
                  setMessage({ text: restoreErrorText(err), error: true });
                }
              }}
            />
          </label>
        </div>
      </section>

      <AiPanel deviceStorage={deviceStorage} now={now()} onOpen={onOpenAi} onOpenFix={onOpenFix} />

      <section className="panel" aria-labelledby="storage-h">
        <h2 id="storage-h">אחסון בטלפון</h2>
        <div className="kv">
          <span className="muted">שמירה קבועה</span>
          <span>{status?.persisted === true ? 'מאושרת' : status?.persisted === false ? 'לא מאושרת' : 'לא ידוע'}</span>
        </div>
        <div className="kv">
          <span className="muted">בגדים שמורים</span>
          <span>{data.items.length}</span>
        </div>
        <div className="kv">
          <span className="muted">נפח בשימוש</span>
          <span>{status?.usageBytes != null ? formatBytes(status.usageBytes) : 'לא ידוע'}</span>
        </div>
      </section>

      <AboutApp />

      <section className="panel" aria-labelledby="delete-h">
        <h2 id="delete-h">מחיקת בגדים</h2>
        <p className="muted">מחיקה היא סופית. בגד שקטן עליה עדיף להעביר ל"קטן עליי".</p>
        {data.items.length === 0 ? (
          <p className="muted">אין בגדים.</p>
        ) : (
          <div>
            {data.items.map((it) => (
              <label key={it.id} className="check-row">
                <input
                  type="checkbox"
                  checked={toDelete.has(it.id)}
                  onChange={() =>
                    setToDelete((s) => {
                      const next = new Set(s);
                      if (next.has(it.id)) next.delete(it.id);
                      else next.add(it.id);
                      return next;
                    })
                  }
                />
                <Swatch color={it.colorGroup} />
                <span style={{ flex: 1 }}>{it.name}</span>
                <span className="muted" style={{ fontSize: 12 }}>
                  {it.status === 'outgrown' ? 'קטן עליי' : COLOR_INFO[it.colorGroup].label}
                </span>
              </label>
            ))}
          </div>
        )}
        <button
          type="button"
          className="btn btn-danger"
          disabled={toDelete.size === 0 || busy !== null}
          onClick={() => setConfirmDelete(true)}
        >
          מחיקת המסומנים ({toDelete.size})
        </button>
      </section>

      {confirmDelete && (
        <Sheet title={`למחוק ${toDelete.size} בגדים?`} onClose={() => setConfirmDelete(false)}>
          <p className="muted">התמונות יימחקו ואי אפשר להחזיר אותן, אלא מגיבוי.</p>
          <button type="button" className="btn btn-danger" onClick={doDelete} disabled={busy !== null}>
            כן, למחוק
          </button>
          <button type="button" className="btn" onClick={() => setConfirmDelete(false)}>
            לא, להשאיר
          </button>
        </Sheet>
      )}

      {pendingImport && (
        <Sheet title="לשחזר מהגיבוי?" onClose={() => setPendingImport(null)}>
          <p className="muted">השחזור מחליף את כל הארון הנוכחי בתוכן הגיבוי.</p>
          {data.aiLooks.length > 0 && <p className="warn">{LOOKS_NOT_IN_BACKUP}</p>}
          <button type="button" className="btn btn-danger" onClick={() => doImport(pendingImport)}>
            כן, לשחזר
          </button>
          <button type="button" className="btn" onClick={() => setPendingImport(null)}>
            ביטול
          </button>
        </Sheet>
      )}
    </>
  );
}

/** Which build is on this phone, linked to its commit on GitHub (the repository is public). */
export function AboutApp({ info = BUILD_INFO }: { info?: BuildInfo }) {
  const short = shortCommit(info.commit);
  const url = commitUrl(info.commit);
  return (
    <section className="panel" aria-labelledby="about-h">
      <h2 id="about-h">על האפליקציה</h2>
      <div className="kv">
        <span className="muted">גרסה</span>
        <span dir="ltr">
          {info.version}
          {url && (
            <>
              {' · '}
              <a href={url} target="_blank" rel="noopener noreferrer" aria-label={`השינויים בגרסה ${info.version} ב־GitHub (${short})`}>
                {short}
              </a>
            </>
          )}
        </span>
      </div>
      <a className="text-link" href={REPO_URL} target="_blank" rel="noopener noreferrer">
        הקוד של האפליקציה ב־GitHub
      </a>
    </section>
  );
}
