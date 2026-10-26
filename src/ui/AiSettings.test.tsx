import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it, vi } from 'vitest';
import { AI_CHECK_KEY, AI_KEY_PREFIX, AI_USAGE_KEY } from '../app/aiDevice';
import type { FetchLike } from '../ai/providers';
import { DEFAULT_PROMPT } from '../ai/prompt';
import { emptyCloset, type AiSettings, type ClosetData } from '../core/model';
import { exportBackup } from '../storage/backup';
import { NOW, fakeImageDeps, memoryStorage, renderWithCloset } from '../test/fixtures';
import { AiPanel, AiSettingsScreen } from './AiSettings';

const OCT = new Date(2026, 9, 26, 12);

function closetWithAi(ai: Partial<AiSettings>): ClosetData {
  const data = emptyCloset();
  return { ...data, ai: { ...data.ai, ...ai } };
}

async function renderScreen(ai: Partial<AiSettings> = {}, storage = memoryStorage(), fetchFn?: FetchLike) {
  const result = await renderWithCloset(
    <AiSettingsScreen deviceStorage={storage} imageDeps={fakeImageDeps()} fetchFn={fetchFn} />,
    closetWithAi(ai),
  );
  return { ...result, storage };
}

describe('AiPanel', () => {
  it('adds the last key check to the status', async () => {
    const storage = memoryStorage({
      [`${AI_KEY_PREFIX}venice`]: 'sk-venice-123',
      [AI_CHECK_KEY]: JSON.stringify({ provider: 'venice', at: '2026-10-25T10:00:00.000Z', ok: true }),
    });
    const { unmount } = await renderWithCloset(
      <AiPanel deviceStorage={storage} now={OCT} onOpen={vi.fn()} />,
      closetWithAi({ provider: 'venice' }),
    );
    expect(screen.getByRole('status')).toHaveTextContent('מוגדר · Venice · נבדק ב־25.10');
    unmount();
    storage.setItem(AI_CHECK_KEY, JSON.stringify({ provider: 'venice', at: '2026-10-25T10:00:00.000Z', ok: false }));
    await renderWithCloset(<AiPanel deviceStorage={storage} now={OCT} onOpen={vi.fn()} />, closetWithAi({ provider: 'venice' }));
    expect(screen.getByRole('status')).toHaveTextContent('הבדיקה האחרונה נכשלה');
  });

  it('says AI is not set up until there is a provider and a key', async () => {
    await renderWithCloset(<AiPanel deviceStorage={memoryStorage()} now={OCT} onOpen={vi.fn()} />, closetWithAi({ provider: 'venice' }));
    expect(screen.getByRole('status')).toHaveTextContent('לא מוגדר');
  });

  it("shows the provider, this month's use against the cap, and the reset day", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const storage = memoryStorage({
      [`${AI_KEY_PREFIX}venice`]: 'k',
      [AI_USAGE_KEY]: JSON.stringify({ month: '2026-10', count: 23 }),
    });
    await renderWithCloset(<AiPanel deviceStorage={storage} now={OCT} onOpen={onOpen} />, closetWithAi({ provider: 'venice' }));
    expect(screen.getByRole('status')).toHaveTextContent('מוגדר · Venice');
    expect(screen.getByText('23 מתוך 100 · מתאפס ב־1.11')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'השימוש החודש' })).toHaveAttribute('aria-valuenow', '23');
    await user.click(screen.getByRole('button', { name: 'הגדרות AI' }));
    expect(onOpen).toHaveBeenCalled();
  });

  it('shows a full bar when the cap is 0, with a valid range for screen readers', async () => {
    await renderWithCloset(<AiPanel deviceStorage={memoryStorage()} now={OCT} onOpen={vi.fn()} />, closetWithAi({ monthlyCap: 0 }));
    expect(screen.getByText('0 מתוך 0 · מתאפס ב־1.11')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuemax', '1');
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1');
  });
});

describe('AiSettingsScreen', () => {
  it('explains what is sent, and shows only the provider choice before one is picked', async () => {
    await renderScreen();
    expect(screen.getByText(/שלוש תמונות נשלחות לספק שבחרת/)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /מפתח API/ })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'הבובה' })).toBeInTheDocument();
  });

  it('picks a provider, back to its default model', async () => {
    const user = userEvent.setup();
    const { repo } = await renderScreen({ provider: 'venice', model: 'custom-venice-model' });
    await user.click(screen.getByRole('button', { name: 'OpenRouter' }));
    expect(await screen.findByText('נבחר OpenRouter.')).toBeInTheDocument();
    expect(repo.getData().ai).toMatchObject({ provider: 'openrouter', model: '' });
    expect(screen.getByRole('button', { name: 'OpenRouter' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('link', { name: 'איפה יוצרים מפתח ב־OpenRouter' })).toHaveAttribute('href', 'https://openrouter.ai/keys');
  });

  it('saves the key on the device only, shows it masked, and can replace or delete it', async () => {
    const user = userEvent.setup();
    const { repo, storage } = await renderScreen({ provider: 'venice' });
    await user.type(screen.getByLabelText('מפתח חדש'), 'sk-secret-1234');
    await user.click(screen.getByRole('button', { name: 'שמירת המפתח' }));

    expect(storage.data.get(`${AI_KEY_PREFIX}venice`)).toBe('sk-secret-1234');
    expect(JSON.stringify(repo.getData())).not.toContain('sk-secret');
    const backup = unzipSync(await exportBackup(repo, NOW));
    expect(Object.values(backup).some((bytes) => strFromU8(bytes).includes('sk-secret'))).toBe(false);
    expect(screen.getByText('••••1234')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('sk-secret-1234')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'החלפה' }));
    expect(screen.getByLabelText('מפתח חדש')).toHaveValue('');
    await user.click(screen.getByRole('button', { name: 'ביטול' }));
    expect(screen.getByText('••••1234')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'מחיקה' }));
    expect(storage.data.has(`${AI_KEY_PREFIX}venice`)).toBe(false);
    expect(screen.getByText('המפתח נמחק מהטלפון.')).toBeInTheDocument();
  });

  it('says so when the phone refuses to store the key', async () => {
    const user = userEvent.setup();
    const storage = { ...memoryStorage(), setItem: () => { throw new Error('blocked'); } };
    await renderWithCloset(
      <AiSettingsScreen deviceStorage={storage} imageDeps={fakeImageDeps()} />,
      closetWithAi({ provider: 'venice' }),
    );
    await user.type(screen.getByLabelText('מפתח חדש'), 'sk-valid-key-1');
    await user.click(screen.getByRole('button', { name: 'שמירת המפתח' }));
    expect(screen.getByText(/הטלפון לא מאפשר לשמור את המפתח/)).toBeInTheDocument();
  });

  it('refuses a key with a space or that is too short, and keeps it out of password managers', async () => {
    const user = userEvent.setup();
    const { storage } = await renderScreen({ provider: 'openrouter' });
    const input = screen.getByLabelText('מפתח חדש');
    expect(input).toHaveAttribute('type', 'text');
    expect(input).toHaveAttribute('autocomplete', 'off');
    await user.type(input, 'sk-or');
    expect(screen.queryByText(/מפתח לא תקין/)).not.toBeInTheDocument(); // still typing
    expect(screen.getByRole('button', { name: 'שמירת המפתח' })).toBeDisabled();
    for (const bad of ['sk-or v1-abcdef', 'short']) {
      await user.clear(input);
      await user.type(input, bad);
      await user.tab();
      expect(screen.getByText(/מפתח לא תקין/)).toBeInTheDocument();
      expect(input).toHaveAttribute('aria-invalid', 'true');
      expect(screen.getByRole('button', { name: 'שמירת המפתח' })).toBeDisabled();
    }
    await user.clear(input);
    await user.type(input, '  sk-or-v1-abcdef  ');
    await user.click(screen.getByRole('button', { name: 'שמירת המפתח' }));
    expect(storage.data.get(`${AI_KEY_PREFIX}openrouter`)).toBe('sk-or-v1-abcdef');
  });

  it('saves the model and the monthly cap, and refuses a bad cap', async () => {
    const user = userEvent.setup();
    const { repo } = await renderScreen({ provider: 'openrouter' });
    const form = within(screen.getByRole('form', { name: 'מודל ומגבלה' }));
    expect(form.getByRole('button', { name: 'שמירה' })).toBeDisabled();

    const cap = form.getByLabelText(/מקסימום תמונות בחודש/);
    for (const bad of ['5000', '1e2', '0x10', ' 50']) {
      await user.clear(cap);
      await user.type(cap, bad);
      expect(form.getByText('מספר שלם בין 0 ל־1000')).toBeInTheDocument();
      expect(form.getByRole('button', { name: 'שמירה' })).toBeDisabled();
    }

    await user.clear(cap);
    await user.type(cap, '30');
    await user.type(form.getByLabelText(/מודל/), ' google/gemini-nano-banana-2.1 ');
    await user.click(form.getByRole('button', { name: 'שמירה' }));
    expect(await screen.findByText('ההגדרות נשמרו.')).toBeInTheDocument();
    expect(repo.getData().ai).toMatchObject({ model: 'google/gemini-nano-banana-2.1', monthlyCap: 30 });
  });

  it('edits the prompt under "מתקדם" and goes back to the built-in one', async () => {
    const user = userEvent.setup();
    const { repo } = await renderScreen();
    await user.click(screen.getByText('מתקדם: ההנחיה ל־AI'));
    const box = screen.getByLabelText(/ההנחיה/);
    expect(box).toHaveValue(DEFAULT_PROMPT);
    expect(screen.getByRole('button', { name: 'חזרה לברירת מחדל' })).toBeDisabled();

    await user.clear(box);
    await user.type(box, 'Dress the doll.');
    await user.click(screen.getAllByRole('button', { name: 'שמירה' }).at(-1)!);
    expect(await screen.findByText('ההנחיה נשמרה.')).toBeInTheDocument();
    expect(repo.getData().ai.prompt).toBe('Dress the doll.');
    expect(screen.getByLabelText(/ההנחיה/)).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'חזרה לברירת מחדל' }));
    expect(await screen.findByText('חזרנו להנחיה הרגילה.')).toBeInTheDocument();
    expect(repo.getData().ai.prompt).toBeNull();
    expect(screen.getByLabelText(/ההנחיה/)).toHaveValue(DEFAULT_PROMPT);
  });

  it('checks the saved key with the provider and remembers the result', async () => {
    const user = userEvent.setup();
    const storage = memoryStorage({ [`${AI_KEY_PREFIX}openrouter`]: 'sk-or-v1-abcdef' });
    const fetchFn = vi.fn<FetchLike>().mockResolvedValue(Response.json({ data: { limit_remaining: 4.2 } }));
    await renderScreen({ provider: 'openrouter' }, storage, fetchFn);
    await user.click(screen.getByRole('button', { name: 'בדיקת חיבור' }));
    expect(await screen.findByText('המפתח עובד. נשארו USD 4.20 במגבלה של המפתח.')).toBeInTheDocument();
    expect(fetchFn).toHaveBeenCalledWith('https://openrouter.ai/api/v1/key', expect.objectContaining({ method: 'GET' }));
    expect(JSON.parse(storage.data.get(AI_CHECK_KEY)!)).toMatchObject({ provider: 'openrouter', ok: true });
  });

  it('explains a failed check to the parent, with the provider\'s words', async () => {
    const user = userEvent.setup();
    const storage = memoryStorage({ [`${AI_KEY_PREFIX}venice`]: 'sk-venice-123' });
    const fetchFn = vi.fn<FetchLike>().mockResolvedValue(Response.json({ error: 'Authentication failed' }, { status: 401 }));
    await renderScreen({ provider: 'venice' }, storage, fetchFn);
    await user.click(screen.getByRole('button', { name: 'בדיקת חיבור' }));
    const status = await screen.findByText(/הספק לא קיבל את המפתח/);
    expect(status).toHaveTextContent('(401 Authentication failed)');
    // The provider's English words keep their own direction inside the Hebrew sentence.
    expect(within(status).getByText('401 Authentication failed')).toHaveAttribute('dir', 'ltr');
    expect(JSON.parse(storage.data.get(AI_CHECK_KEY)!)).toMatchObject({ provider: 'venice', ok: false });
  });

  it('forgets the last check when the key changes', async () => {
    const user = userEvent.setup();
    const storage = memoryStorage({
      [`${AI_KEY_PREFIX}venice`]: 'sk-venice-123',
      [AI_CHECK_KEY]: JSON.stringify({ provider: 'venice', at: '2026-10-25T10:00:00.000Z', ok: false }),
    });
    await renderScreen({ provider: 'venice' }, storage);
    await user.click(screen.getByRole('button', { name: 'מחיקה' }));
    expect(storage.data.has(AI_CHECK_KEY)).toBe(false);
  });

  it('says so when saving a setting fails', async () => {
    const user = userEvent.setup();
    const { repo } = await renderScreen();
    vi.spyOn(repo, 'update').mockRejectedValueOnce(new Error('disk full'));
    await user.click(screen.getByRole('button', { name: 'Venice' }));
    expect(await screen.findByText('השמירה לא הצליחה. נסי שוב.')).toBeInTheDocument();
    expect(repo.getData().ai.provider).toBeNull();
  });
});
