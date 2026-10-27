import { useEffect, useId, useRef, useState } from 'react';
import { readAnalysisUse, readApiKey, recordAnalysisUse, type DeviceStorage } from '../app/aiDevice';
import { useCloset } from '../app/ClosetContext';
import { SAMPLE_GARMENT_URL } from '../app/sampleGarment';
import { effectiveAnalysisModel } from '../ai/catalog';
import { AiError, countsTowardCap, type FetchLike } from '../ai/providers';
import { requestAttributes, type AttributesResponse } from '../ai/send';
import { MAX_ANALYSIS_CAP, MAX_MODEL_LENGTH, type AiProviderId, type AnalysisSettings } from '../core/model';
import { explainedElsewhere } from './common';
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
  const [used, setUsed] = useState(() => readAnalysisUse(deviceStorage, now()));
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
    const count = () => {
      recordAnalysisUse(deviceStorage, now());
      if (mounted.current) setUsed(readAnalysisUse(deviceStorage, now()));
    };
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
    </section>
  );
}
