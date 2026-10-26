import { useEffect, useId, useRef, useState } from 'react';
import {
  aiReady,
  isValidApiKey,
  maskKey,
  nextResetDate,
  readApiKey,
  readMonthlyUse,
  removeApiKey,
  saveApiKey,
  type DeviceStorage,
} from '../app/aiDevice';
import { useCloset } from '../app/ClosetContext';
import { AI_PROVIDERS, effectiveModel } from '../ai/catalog';
import { DEFAULT_PROMPT } from '../ai/prompt';
import { MAX_MODEL_LENGTH, MAX_PROMPT_LENGTH } from '../core/closet';
import { AI_PROVIDER_IDS, MAX_MONTHLY_CAP, type AiProviderId } from '../core/model';
import type { ImageDeps } from '../image/processImage';
import { Icon, explainedElsewhere } from './common';
import { DollPanel } from './DollPanel';

type Message = { text: string; error: boolean } | null;

function formatDay(date: Date): string {
  return `${date.getDate()}.${date.getMonth() + 1}`;
}

/** The short panel on the parent page: is AI set up, how much is used this month, and the way to its settings. */
export function AiPanel({ deviceStorage, now, onOpen }: { deviceStorage: DeviceStorage; now: Date; onOpen: () => void }) {
  const { data } = useCloset();
  const { provider, monthlyCap } = data.ai;
  const ready = aiReady(data.ai, deviceStorage);
  const used = readMonthlyUse(deviceStorage, now);
  const percent = monthlyCap > 0 ? Math.min(100, Math.round((used / monthlyCap) * 100)) : 100;

  return (
    <section className="panel" aria-labelledby="ai-h">
      <h2 id="ai-h">בובה ו־AI</h2>
      <div className="status-line" role="status">
        <span className={ready ? 'status-dot on' : 'status-dot'} aria-hidden="true" />
        {ready && provider ? `מוגדר · ${AI_PROVIDERS[provider].label}` : 'לא מוגדר. הכפתור "להלביש את הבובה" לא יופיע לה עד שתגדירי ספק ומפתח.'}
      </div>
      <div className="kv">
        <span className="muted">השימוש החודש</span>
        <span>
          {used} מתוך {monthlyCap} · מתאפס ב־{formatDay(nextResetDate(now))}
        </span>
      </div>
      <div
        className="usage-bar"
        role="progressbar"
        aria-label="השימוש החודש"
        aria-valuemin={0}
        aria-valuemax={Math.max(1, monthlyCap)}
        aria-valuenow={monthlyCap === 0 ? 1 : Math.min(used, monthlyCap)}
      >
        <span style={{ width: `${percent}%` }} />
      </div>
      <button type="button" className="row-btn" onClick={onOpen}>
        <span>הגדרות AI</span>
        <Icon name="next" />
      </button>
    </section>
  );
}

/** The "הגדרות AI" screen inside the parent area. */
export function AiSettingsScreen({ deviceStorage, imageDeps }: { deviceStorage: DeviceStorage; imageDeps: ImageDeps }) {
  const { data, setAiSettings } = useCloset();
  const { provider } = data.ai;
  const [message, setMessage] = useState<Message>(null);
  // The screen is long: bring a confirmation or error into view where it is shown.
  const messageRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (message) messageRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [message]);

  const save = async (patch: Parameters<typeof setAiSettings>[0], done: string): Promise<boolean> => {
    setMessage(null);
    try {
      await setAiSettings(patch);
      setMessage({ text: done, error: false });
      return true;
    } catch (err) {
      if (!explainedElsewhere(err)) setMessage({ text: 'השמירה לא הצליחה. נסי שוב.', error: true });
      return false;
    }
  };

  return (
    <>
      <p className="muted">
        כשהיא לוחצת "להלביש את הבובה", שלוש תמונות נשלחות לספק שבחרת: הבובה, החולצה (או השכבה העליונה) והמכנסיים. בלי שמות
        ובלי מיקום. שום דבר לא נשלח עד שתגדירי ספק ומפתח.
      </p>
      {message && (
        <p ref={messageRef} role="status" className={message.error ? 'error' : 'muted'}>
          {message.text}
        </p>
      )}

      <section className="panel" aria-labelledby="provider-h">
        <h2 id="provider-h">ספק</h2>
        <div className="segmented" role="group" aria-label="ספק">
          {AI_PROVIDER_IDS.map((id) => (
            <button
              key={id}
              type="button"
              className="chip"
              aria-pressed={provider === id}
              onClick={() => {
                // A model name belongs to one provider; switching goes back to the new one's default.
                if (provider !== id) void save({ provider: id, model: '' }, `נבחר ${AI_PROVIDERS[id].label}.`);
              }}
            >
              {AI_PROVIDERS[id].label}
            </button>
          ))}
        </div>
        {provider && (
          <a className="text-link" href={AI_PROVIDERS[provider].keysUrl} target="_blank" rel="noopener noreferrer">
            איפה יוצרים מפתח ב־{AI_PROVIDERS[provider].label}
          </a>
        )}
      </section>

      {provider && <KeyPanel key={provider} provider={provider} deviceStorage={deviceStorage} onMessage={setMessage} />}

      {provider && <UsagePanel key={`${provider}:${data.ai.model}:${data.ai.monthlyCap}`} provider={provider} save={save} />}

      <DollPanel imageDeps={imageDeps} />

      <PromptPanel save={save} />
    </>
  );
}

function KeyPanel({
  provider,
  deviceStorage,
  onMessage,
}: {
  provider: AiProviderId;
  deviceStorage: DeviceStorage;
  onMessage: (m: Message) => void;
}) {
  const [saved, setSaved] = useState(() => readApiKey(deviceStorage, provider));
  const [editing, setEditing] = useState(saved === null);
  const [draft, setDraft] = useState('');
  const id = useId();
  const label = AI_PROVIDERS[provider].label;

  const [left, setLeft] = useState(false);
  const key = draft.trim();
  const invalid = key !== '' && !isValidApiKey(key);
  // While she is still typing, "too short" isn't a mistake yet; a space or odd character is.
  const showInvalid = invalid && (left || key.length >= 8 || /[^\x21-\x7e]/.test(key));
  const store = () => {
    if (!key || invalid) return;
    if (!saveApiKey(deviceStorage, provider, key)) {
      onMessage({ text: 'הטלפון לא מאפשר לשמור את המפתח (אולי גלישה פרטית).', error: true });
      return;
    }
    setSaved(key);
    setDraft('');
    setEditing(false);
    onMessage({ text: 'המפתח נשמר בטלפון הזה.', error: false });
  };

  return (
    <section className="panel" aria-labelledby="key-h">
      <h2 id="key-h">מפתח API של {label}</h2>
      <p className="muted">נשמר רק בטלפון הזה ולא נכנס לגיבוי.</p>
      {saved && !editing ? (
        <>
          <div className="kv">
            <span className="muted">המפתח</span>
            <span dir="ltr">{maskKey(saved)}</span>
          </div>
          <div className="btn-row">
            <button type="button" className="btn" onClick={() => setEditing(true)}>
              החלפה
            </button>
            <button
              type="button"
              className="btn"
              style={{ borderColor: 'var(--line)', color: 'var(--danger-text)' }}
              onClick={() => {
                removeApiKey(deviceStorage, provider);
                setSaved(null);
                setEditing(true);
                onMessage({ text: 'המפתח נמחק מהטלפון.', error: false });
              }}
            >
              מחיקה
            </button>
          </div>
        </>
      ) : (
        <form
          className="field"
          onSubmit={(e) => {
            e.preventDefault();
            store();
          }}
        >
          <label className="label" htmlFor={id}>
            מפתח חדש
          </label>
          {/* A text field drawn as dots, not type="password": Safari would offer to save a password to
              iCloud Keychain, which would take the key off this phone. */}
          <input
            id={id}
            className="text-input secret-input"
            type="text"
            dir="ltr"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            data-1p-ignore=""
            data-lpignore="true"
            value={draft}
            aria-invalid={showInvalid}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => setLeft(true)}
          />
          {showInvalid && <p className="error">מפתח לא תקין: בלי רווחים, לפחות 8 תווים. כדאי להעתיק אותו שוב מהאתר של הספק.</p>}
          <div className="btn-row">
            <button type="submit" className="btn btn-dark" disabled={!key || invalid}>
              שמירת המפתח
            </button>
            {saved && (
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setDraft('');
                  setEditing(false);
                }}
              >
                ביטול
              </button>
            )}
          </div>
        </form>
      )}
    </section>
  );
}

function UsagePanel({
  provider,
  save,
}: {
  provider: AiProviderId;
  save: (patch: { model?: string; monthlyCap?: number }, done: string) => Promise<boolean>;
}) {
  const { data } = useCloset();
  const [model, setModel] = useState(data.ai.model);
  const [cap, setCap] = useState(String(data.ai.monthlyCap));
  const modelId = useId();
  const capId = useId();
  const capNumber = Number(cap);
  // Plain digits only: Number() would also take "1e2", "0x10" or padded spaces.
  const capValid = /^\d{1,4}$/.test(cap) && capNumber <= MAX_MONTHLY_CAP;
  const changed = model.trim() !== data.ai.model || (capValid && capNumber !== data.ai.monthlyCap);

  return (
    <form
      className="panel"
      aria-labelledby="usage-h"
      onSubmit={(e) => {
        e.preventDefault();
        if (capValid && changed) void save({ model: model.trim(), monthlyCap: capNumber }, 'ההגדרות נשמרו.');
      }}
    >
      <h2 id="usage-h">מודל ומגבלה</h2>
      <div className="field">
        <label className="label" htmlFor={modelId}>
          מודל <small>(ריק = {effectiveModel(provider, '')})</small>
        </label>
        <input
          id={modelId}
          className="text-input"
          dir="ltr"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          maxLength={MAX_MODEL_LENGTH}
          placeholder={effectiveModel(provider, '')}
          value={model}
          onChange={(e) => setModel(e.target.value)}
        />
      </div>
      <div className="field">
        <label className="label" htmlFor={capId}>
          מקסימום תמונות בחודש <small>(כולל יצירה מחדש שלך)</small>
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
        {!capValid && <p className="error">מספר שלם בין 0 ל־{MAX_MONTHLY_CAP}</p>}
      </div>
      <button type="submit" className="btn btn-dark" disabled={!capValid || !changed}>
        שמירה
      </button>
    </form>
  );
}

function PromptPanel({ save }: { save: (patch: { prompt?: string | null }, done: string) => Promise<boolean> }) {
  const { data } = useCloset();
  const current = data.ai.prompt ?? DEFAULT_PROMPT;
  const [draft, setDraft] = useState(current);
  // Follow a saved or reset prompt without remounting, so the section stays open.
  const [basis, setBasis] = useState(data.ai.prompt);
  if (basis !== data.ai.prompt) {
    setBasis(data.ai.prompt);
    setDraft(current);
  }
  const id = useId();
  const isDefault = data.ai.prompt === null;

  return (
    <section className="panel">
      <details className="advanced">
        <summary>מתקדם: ההנחיה ל־AI</summary>
        <div className="field">
          <label className="label" htmlFor={id}>
            ההנחיה <small>(באנגלית זה עובד הכי טוב)</small>
          </label>
          <textarea
            id={id}
            className="text-input text-area"
            dir="ltr"
            maxLength={MAX_PROMPT_LENGTH}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <p className="muted">תמונה 1 היא הבובה, 2 החולצה או השכבה העליונה, 3 המכנסיים. שינוי לא מייצר מחדש תמונות קיימות.</p>
          <div className="btn-row">
            <button
              type="button"
              className="btn btn-dark"
              disabled={!draft.trim() || draft === current}
              onClick={() => void save({ prompt: draft === DEFAULT_PROMPT ? null : draft }, 'ההנחיה נשמרה.')}
            >
              שמירה
            </button>
            <button
              type="button"
              className="btn"
              disabled={isDefault}
              onClick={() => void save({ prompt: null }, 'חזרנו להנחיה הרגילה.')}
            >
              חזרה לברירת מחדל
            </button>
          </div>
        </div>
      </details>
    </section>
  );
}
