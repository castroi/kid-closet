import { useEffect, useId, useRef, useState } from 'react';
import { readAnalysisUse, readApiKey, type DeviceStorage } from '../app/aiDevice';
import { useCloset } from '../app/ClosetContext';
import { AnalysisCapReached, useItemAnalysis, type BulkRun } from '../app/ItemAnalysis';
import { SAMPLE_GARMENT_URL } from '../app/sampleGarment';
import { effectiveAnalysisModel } from '../ai/catalog';
import { AiError, countsTowardCap, type FetchLike } from '../ai/providers';
import { requestAttributes, type AttributesResponse } from '../ai/send';
import { isAnalysed, itemsToAnalyse } from '../core/closet';
import { MAX_ANALYSIS_CAP, MAX_MODEL_LENGTH, type AiProviderId, type AnalysisSettings } from '../core/model';
import { Sheet, explainedElsewhere } from './common';
import { aiErrorDetail, aiErrorText } from './aiErrors';

/** `detail` is the provider's own (English) words, shown in their own direction inside the Hebrew line. */
type Message = { text: string; error: boolean; detail?: string } | null;

const defaultFetch: FetchLike = (url, init) => fetch(url, init);

/**
 * "זיהוי בגדים" in the AI settings: the switch, the analysis model and its own monthly cap, and
 * "בדיקת זיהוי", which sends the bundled sample photo (docs/ai-item-attributes.md §7).
 */
export function AnalysisPanel({
  provider,
  deviceStorage,
  fetchFn = defaultFetch,
  now = () => new Date(),
}: {
  provider: AiProviderId;
  deviceStorage: DeviceStorage;
  /** Only for tests; the app uses the browser's fetch. */
  fetchFn?: FetchLike;
  now?: () => Date;
}) {
  const { data, setAiSettings } = useCloset();
  const queue = useItemAnalysis();
  const settings = data.ai.analysis;
  const [model, setModel] = useState(settings.model);
  const [cap, setCap] = useState(String(settings.monthlyCap));
  // Follow a model or cap saved elsewhere (a provider switch, a restore) without remounting, so a message stays.
  const [basis, setBasis] = useState({ model: settings.model, monthlyCap: settings.monthlyCap });
  if (basis.model !== settings.model || basis.monthlyCap !== settings.monthlyCap) {
    setBasis({ model: settings.model, monthlyCap: settings.monthlyCap });
    setModel(settings.model);
    setCap(String(settings.monthlyCap));
  }
  const [message, setMessage] = useState<Message>(null);
  const [checking, setChecking] = useState(false);
  // Read on every render; the queue's usageVersion changes after each counted analysis, which renders this again.
  const used = readAnalysisUse(deviceStorage, now());
  const modelId = useId();
  const capId = useId();
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const capNumber = Number(cap);
  // Plain digits only: Number() would also take "1e2", "0x10" or padded spaces.
  const capValid = /^\d{1,4}$/.test(cap) && capNumber <= MAX_ANALYSIS_CAP;
  const changed = model.trim() !== settings.model || (capValid && capNumber !== settings.monthlyCap);
  const defaultModel = effectiveAnalysisModel(provider, '');

  const save = async (patch: Partial<AnalysisSettings>, done: string) => {
    setMessage(null);
    try {
      await setAiSettings({ analysis: { ...settings, ...patch } });
      if (mounted.current) setMessage({ text: done, error: false });
    } catch (err) {
      if (!explainedElsewhere(err) && mounted.current) setMessage({ text: 'השמירה לא הצליחה. נסי שוב.', error: true });
    }
  };

  const runCheck = async () => {
    const apiKey = readApiKey(deviceStorage, provider);
    if (!apiKey) {
      setMessage({ text: 'צריך קודם לשמור מפתח API.', error: true });
      return;
    }
    if (readAnalysisUse(deviceStorage, now()) >= settings.monthlyCap) {
      setMessage({ text: 'הגעת למגבלת הזיהויים של החודש. אפשר להגדיל אותה כאן.', error: true });
      return;
    }
    setChecking(true);
    setMessage(null);
    const count = () => queue.countUse();
    try {
      const response = await fetchFn(SAMPLE_GARMENT_URL, {});
      if (!response.ok) throw new AiError('bad-photo', 'the bundled sample photo is missing');
      const photo = { bytes: new Uint8Array(await response.arrayBuffer()), ext: 'webp' as const };
      let result: AttributesResponse;
      try {
        result = await requestAttributes({ provider, settings: data.ai, apiKey, photo, fetch: fetchFn });
      } catch (err) {
        if (countsTowardCap(err)) count();
        throw err;
      }
      count();
      if (!mounted.current) return;
      if (result.analysis.result === 'ok') {
        setMessage({ text: 'הזיהוי עובד.', error: false, detail: result.analysis.attributes.short_title });
      } else {
        setMessage({ text: 'הספק ענה, אבל לא זיהה בגד בתמונת הדוגמה. כדאי לנסות מודל אחר.', error: true });
      }
    } catch (err) {
      if (mounted.current) setMessage({ text: aiErrorText(err), error: true, detail: aiErrorDetail(err) });
    } finally {
      if (mounted.current) setChecking(false);
    }
  };

  return (
    <section className="panel" aria-labelledby="analysis-h">
      <h2 id="analysis-h">זיהוי בגדים</h2>
      <p className="muted">
        כשזה פועל, כל בגד חדש שהיא מוסיפה נשלח לספק שבחרת כדי שה־AI יתאר אותו (צבעים, דוגמה, עונה). נשלחת רק התמונה, בלי
        שם ובלי מיקום. זה הבסיס להתאמת בגדים בהמשך.
      </p>
      <div className="segmented" role="group" aria-label="זיהוי בגדים">
        <button
          type="button"
          className="chip"
          aria-pressed={!settings.enabled}
          onClick={() => settings.enabled && void save({ enabled: false }, 'זיהוי הבגדים כבוי.')}
        >
          כבוי
        </button>
        <button
          type="button"
          className="chip"
          aria-pressed={settings.enabled}
          onClick={() => !settings.enabled && void save({ enabled: true }, 'זיהוי הבגדים פועל. בגדים חדשים יישלחו לזיהוי.')}
        >
          פועל
        </button>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (capValid && changed) void save({ model: model.trim(), monthlyCap: capNumber }, 'ההגדרות נשמרו.');
        }}
      >
        <div className="field">
          <label className="label" htmlFor={modelId}>
            מודל לזיהוי <small>(ריק = {defaultModel})</small>
          </label>
          <input
            id={modelId}
            className="text-input"
            dir="ltr"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            maxLength={MAX_MODEL_LENGTH}
            placeholder={defaultModel}
            value={model}
            onChange={(e) => setModel(e.target.value)}
          />
        </div>
        <div className="field">
          <label className="label" htmlFor={capId}>
            מקסימום זיהויים בחודש <small>(נפרד מהבובות)</small>
          </label>
          <input
            id={capId}
            className="text-input"
            inputMode="numeric"
            dir="ltr"
            style={{ width: 120 }}
            value={cap}
            onChange={(e) => setCap(e.target.value)}
          />
          {!capValid && <p className="error">מספר שלם בין 0 ל־{MAX_ANALYSIS_CAP}</p>}
        </div>
        <button type="submit" className="btn btn-dark" disabled={!capValid || !changed}>
          שמירה
        </button>
      </form>

      <div className="kv">
        <span className="muted">זיהויים החודש</span>
        <span>
          {used} מתוך {settings.monthlyCap}
        </span>
      </div>
      <p className="muted">"בדיקת זיהוי" שולחת תמונת דוגמה של חולצה, לא תמונה שלה, ונספרת בזיהויים של החודש.</p>
      <button type="button" className="btn" disabled={checking} onClick={() => void runCheck()}>
        {checking ? 'בודק…' : 'בדיקת זיהוי'}
      </button>
      {message && (
        <p role="status" className={message.error ? 'error' : 'muted'}>
          {message.text}
          {message.detail && (
            <>
              {' ('}
              <bdi dir="ltr">{message.detail}</bdi>
              {')'}
            </>
          )}
        </p>
      )}
      <BulkSection deviceStorage={deviceStorage} now={now} />
    </section>
  );
}

/** "בגד אחד" / "5 בגדים". */
function garments(n: number): string {
  return n === 1 ? 'בגד אחד' : `${n} בגדים`;
}

/** Why a run ended early, in the parent's words. */
function stopReasonText(reason: unknown): string {
  if (reason === 'off') return 'הריצה נעצרה כי זיהוי הבגדים כובה או שהמפתח הוסר.';
  if (reason instanceof AnalysisCapReached) return 'הריצה נעצרה: הגעת למגבלת הזיהויים של החודש. אפשר להגדיל אותה למעלה.';
  return `הריצה נעצרה: ${aiErrorText(reason)}`;
}

/**
 * The parent's "send all": what is already known, the button with a confirmation, progress with
 * "עצירה", and a summary (docs/ai-item-attributes.md §7). Outgrown items are never sent.
 */
function BulkSection({ deviceStorage, now }: { deviceStorage: DeviceStorage; now: () => Date }) {
  const { data } = useCloset();
  const queue = useItemAnalysis();
  const [confirm, setConfirm] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const run = queue.bulk;
  const current = data.items.filter((it) => isAnalysed(it));
  const known = current.filter((it) => it.analysis?.result === 'ok').length;
  const unclear = current.length - known;
  const failedJobs = Object.values(queue.jobs).filter((j) => j.kind === 'failed');
  // No answer at all isn't a failure of the garment: it goes out again when the phone is back online.
  const offlineNow = failedJobs.filter((j) => j.error instanceof AiError && j.error.reason === 'network').length;
  const failedNow = failedJobs.length - offlineNow;
  // From the closet on screen, not the queue's copy, so the button follows every saved analysis.
  const pending = itemsToAnalyse(data.items).filter((it) => queue.jobs[it.id] === undefined || queue.jobs[it.id].kind === 'failed');
  const left = Math.max(0, data.ai.analysis.monthlyCap - readAnalysisUse(deviceStorage, now()));
  const ready = queue.isReady();

  const counts = [known === 1 ? 'בגד אחד מזוהה' : `${known} מזוהים`];
  if (failedNow > 0) counts.push(failedNow === 1 ? 'אחד נכשל' : `${failedNow} נכשלו`);
  if (offlineNow > 0) counts.push(offlineNow === 1 ? 'אחד מחכה לאינטרנט' : `${offlineNow} מחכים לאינטרנט`);
  if (unclear > 0) counts.push(unclear === 1 ? 'תמונה אחת לא ברורה' : `${unclear} תמונות לא ברורות`);

  const start = () => {
    setConfirm(false);
    const refused = queue.startBulk();
    setRefusal(
      refused === 'cap'
        ? 'הגעת למגבלת הזיהויים של החודש.'
        : refused === 'not-ready'
          ? 'צריך להפעיל את זיהוי הבגדים ולשמור מפתח.'
          : refused === 'done'
            ? 'אין בגדים שמחכים לזיהוי.'
            : null,
    );
  };

  return (
    <div className="bulk-analysis">
      <div className="kv">
        <span className="muted">בגדים בארון</span>
        <span>{counts.join(' · ')}</span>
      </div>
      {run?.running ? (
        <BulkProgress run={run} onStop={queue.stopBulk} />
      ) : (
        <>
          <button
            type="button"
            className="btn btn-dark"
            disabled={!ready || pending.length === 0}
            onClick={() => {
              setRefusal(null);
              setConfirm(true);
            }}
          >
            {pending.length === 0 ? 'כל הבגדים כבר נשלחו לזיהוי' : `לשלוח ${garments(pending.length)} לזיהוי`}
          </button>
          {!ready && pending.length > 0 && <p className="muted">צריך להפעיל את זיהוי הבגדים כדי לשלוח.</p>}
        </>
      )}
      {refusal && (
        <p className="error" role="alert">
          {refusal}
        </p>
      )}
      {run && !run.running && <BulkSummary run={run} onClose={queue.clearBulk} />}
      {confirm && (
        <Sheet
          title={pending.length === 1 ? 'לשלוח תמונת בגד אחת ל־AI?' : `לשלוח ${pending.length} תמונות בגדים ל־AI?`}
          onClose={() => setConfirm(false)}
        >
          <p className="muted">
            כל בגד = בקשה אחת. נשארו החודש: {left}. בגדים שקטנים עליה לא נשלחים.
            {pending.length > left && ` אחרי ${left} הריצה תיעצר, והשאר יחכו לחודש הבא או להגדלת המגבלה.`}
          </p>
          <button type="button" className="btn btn-dark" onClick={start}>
            כן, לשלוח
          </button>
          <button type="button" className="btn" onClick={() => setConfirm(false)}>
            לא עכשיו
          </button>
        </Sheet>
      )}
    </div>
  );
}

function BulkProgress({ run, onStop }: { run: BulkRun; onStop: () => void }) {
  const done = run.analysed + run.skipped + run.failed.length;
  return (
    <>
      <div className="kv">
        <span className="muted">שליחה לזיהוי</span>
        <span role="status">
          נשלחו {done} מתוך {run.total}
        </span>
      </div>
      <div
        className="usage-bar"
        role="progressbar"
        aria-label="שליחה לזיהוי"
        aria-valuemin={0}
        aria-valuemax={run.total}
        aria-valuenow={done}
      >
        <span style={{ width: `${Math.round((done / run.total) * 100)}%` }} />
      </div>
      <button type="button" className="btn" disabled={run.stopping} onClick={onStop}>
        {run.stopping ? 'עוצר אחרי הבגד הנוכחי…' : 'עצירה'}
      </button>
    </>
  );
}

function BulkSummary({ run, onClose }: { run: BulkRun; onClose: () => void }) {
  const { data } = useCloset();
  const name = (id: string) => data.items.find((it) => it.id === id)?.name ?? 'בגד שנמחק';
  return (
    <div className="bulk-summary" role="status">
      <p>
        {run.analysed === 1 ? 'בגד אחד זוהה' : `${run.analysed} זוהו`}
        {run.failed.length === 1 ? ' · אחד נכשל' : run.failed.length > 1 ? ` · ${run.failed.length} נכשלו` : ''}
      </p>
      {run.stoppedBy !== null && <p className="error">{stopReasonText(run.stoppedBy)}</p>}
      {run.failed.length > 0 && (
        <ul className="bulk-failures">
          {run.failed.map((f) => (
            <li key={f.id}>
              {name(f.id)}: {aiErrorText(f.error)}
              {aiErrorDetail(f.error) && (
                <>
                  {' ('}
                  <bdi dir="ltr">{aiErrorDetail(f.error)}</bdi>
                  {')'}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="btn" onClick={onClose}>
        סגירה
      </button>
    </div>
  );
}
