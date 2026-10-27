# AI item attributes — decisions and implementation plan

Feature for `castroi/kid-closet`. Status: **in progress**. PR 0 merged; PR 1 `feat/item-attributes-model`. Date: 2026-10-27.

## 1. Goal

Each garment photo is sent once to a vision AI model, which describes it in a fixed set of attributes (colours, pattern, busyness, season and more). The attributes are saved on the item. They are the groundwork for a later feature that suggests matching outfits; this plan covers only collecting and storing them.

## 2. Decisions taken

| # | Decision | Notes |
|---|---|---|
| 1 | Only the photo is sent | No name, type, colour or occasion. The prompt has no parent note. Same rule as the doll looks (`docs/ai-doll-look.md` §4). |
| 2 | Same provider and API key as the doll looks, a **separate model** | Default model: DeepSeek V4.1 Flash (`deepseek-v4-1-flash` on Venice, `deepseek/deepseek-v4.1-flash` on OpenRouter), a cheap vision chat model. The doll's image model can't read photos into text. |
| 3 | Off until the parent turns it on | Photos now leave the phone automatically and in bulk, so it needs its own switch in "הגדרות AI", even when doll looks are set up. |
| 4 | New items are analysed automatically after she adds them | Only when the feature is on and the phone is online. |
| 5 | The kid can resend one item | Only for an item that isn't analysed yet, or failed. Never for one that is done: the same photo costs again and gives the same answer. |
| 6 | Bulk analysis of existing items is parent-only | Behind a confirmation; it costs money. Outgrown items are skipped. |
| 7 | Separate monthly counter and cap: **300 analyses**, editable by the parent | A bulk run must never use up her dolls. Same counting rules as the dolls (`docs/ai-doll-look.md` §8). |
| 8 | Attributes are stored as the AI returned them, separate from her own fields | Her type, colour and occasion are never overwritten or prefilled. Mapping the AI's categories (dress, shoes, sport…) to the app's types belongs to the matching feature. |
| 9 | The kid sees only a "done" sign, never the attributes | A sparkle mark on the photo. Not analysed and failed items carry no mark. |
| 10 | Each item has a photo revision number; the analysis records the revision it was made from | It changes only when she replaces the photo (PR 4), so those attributes become stale and the item counts as not analysed. A number, not a hash of the bytes: a backup restore re-encodes photos (`cleanPhoto()` in `src/storage/backup.ts`) and must not make every item look unanalysed. |
| 11 | She can replace a garment's photo (PR 4) | Without it, a photo the AI couldn't read is a dead end. |
| 12 | The app validates every answer itself | Schema enforcement for this model is not confirmed on either provider (§3). An answer that doesn't match the schema is a failed call. |

## 3. Open questions

| # | Question | Proposal |
|---|---|---|
| 1 | Do the providers allow `chat/completions` calls from a web page (CORS)? | **Left to the owner after PR 2:** "בדיקת זיהוי" with a real key on her iPhone, as for the doll looks. |
| 2 | Does DeepSeek V4.1 Flash enforce `response_format` with `json_schema`? | OpenRouter's model page says it accepts images and supports a JSON schema in `response_format`, though support can vary by upstream provider, so PR 2 also sets `provider.require_parameters`. Venice's model page mentions structured JSON output without detail. PR 2 sends the schema with `strict: true` and validates the answer anyway. If a provider rejects the parameter, send without it and rely on the prompt plus validation. Confirm with the first real call. |
| 3 | Do provider-specific request options apply? | Venice may need its own system prompt turned off. Checked against Venice's docs in PR 2, not assumed here. |
| 4 | Replacing a photo (PR 4): what happens to that item's AI doll looks? | They show the old garment. Proposal: ask the parent whether to delete them, like the doll-change question. Decide in PR 4. |

## 4. Privacy and security changes

- **CSP** (`vercel.json`): `connect-src` adds exactly two URLs, `https://api.venice.ai/api/v1/chat/completions` and `https://openrouter.ai/api/v1/chat/completions`. `securityHeaders.test.ts` checks the list against `src/ai/catalog.ts`.
- **Sent data:** the photo (metadata stripped again by `stripPhotoMetadata()` right before sending) and the prompt. Nothing else.
- **Docs and code comments that PR 2 updates**, because each one describes today's endpoints or behaviour:
  - README "How data is stored", and the status text in the parent's AI panel: when the parent turns it on, garment photos are sent to the provider automatically and in bulk
  - `CLAUDE.md` rows: the CSP row ("one for a look, one for the key check"), the provider-calls row ("checks the answer is a picture"), the AI-settings row (the new `analysis` settings and the second usage counter)
  - `docs/ai-doll-look.md` §4, which says `connect-src` lists four exact URLs and nothing else
  - the `endpoints` comment in `src/ai/catalog.ts`
  - `src/app/securityHeaders.test.ts`, which lists `look` and `check` and must add `analyze`
- **Answer size cap:** the answer is text; anything over 64 KB is refused before parsing.

## 5. Data model

`SCHEMA_VERSION` **5** adds `photoRevision` and `analysis` to items and `analysis` to the AI settings. Versions 1–4 load with `photoRevision: 0`, no analysis and the feature off.

```ts
type AttrCategory = 'top' | 'bottom' | 'dress' | 'outerwear' | 'shoes' | 'accessory' | 'other';
type AttrPattern = 'solid' | 'stripes' | 'checks_plaid' | 'dots' | 'floral' | 'graphic_print'
  | 'character_print' | 'camo' | 'animal_print' | 'other';

interface ItemAttributes {          // exactly the prompt's schema, snake_case kept as sent
  category: AttrCategory;
  subcategory: string;
  primary_color: string;
  primary_color_hex: string | null; // '#RRGGBB', null when the model's value isn't one
  secondary_colors: string[];
  color_family: 'neutral' | 'colorful';
  pattern: AttrPattern;
  graphic_description: string | null;
  text_on_item: string | null;
  busyness: 'low' | 'medium' | 'high';
  formality: ('play' | 'school' | 'sport' | 'party')[];
  season: ('summer' | 'mid' | 'winter')[];
  warmth: 'light' | 'medium' | 'heavy';
  sleeve_length: 'sleeveless' | 'short' | 'three_quarter' | 'long' | null;
  leg_length: 'shorts' | 'capri' | 'full' | null;
  material_guess: 'cotton' | 'denim' | 'knit' | 'fleece' | 'synthetic' | 'wool' | 'leather' | 'other' | null;
  fit: 'slim' | 'regular' | 'loose' | null;
  closure: 'none' | 'buttons' | 'zipper' | 'velcro' | 'laces' | 'elastic' | null;
  style_tags: string[];             // up to 5
  short_title: string;
  kid_friendly_description: string;
  confidence: 'high' | 'medium' | 'low';
  notes: string | null;
}

interface AnalysisMeta {
  photoRevision: number;            // the item's photoRevision when it was analysed
  provider: AiProviderId;
  model: string;
  promptVersion: number;
  analyzedAt: string;
}

type ItemAnalysis =
  | ({ result: 'ok'; attributes: ItemAttributes } & AnalysisMeta)
  | ({ result: 'invalid-photo'; notes: string | null } & AnalysisMeta);   // valid_image = false

interface Item {
  // ...existing fields
  photoRevision: number;            // 0 for every existing item; +1 on each photo replacement (PR 4)
  analysis: ItemAnalysis | null;    // null = not analysed
}

interface AiSettings {
  // ...existing fields
  analysis: {
    enabled: boolean;               // default false
    model: string;                  // empty = the provider's default analysis model
    monthlyCap: number;             // default 300
  };
}
```

Device-only (not in backup): a second usage counter, `kid-closet:ai-analysis-usage` (`{ month, count }`), next to the dolls' counter in `src/app/aiDevice.ts`.

Rules:
- Failures (offline, provider errors, a broken answer) are **not** saved in `closet.json`. They live in the queue's state for the session; the parent sees them in the bulk-run summary.
- **A bad stored analysis never blocks the closet.** On load (and restore), an analysis that fails validation becomes `null`; the item is simply not analysed. It can be made again; she must never land on the recovery screen because of it.
- **When an answer is stored:** a wrong type, a missing field or an enum value outside the list fails the call. Strings are trimmed and cut to their limit, arrays to their maximum length:
  - `short_title` 60 characters; `subcategory`, `primary_color` and each colour or tag 40; `graphic_description`, `text_on_item`, `kid_friendly_description` 200; `notes` 300
  - `secondary_colors` at most 5, `style_tags` at most 5, `formality` and `season` without duplicates; an empty `formality` or `season` fails the call (it is not cut or filled in)
  - `primary_color_hex` must match `#RRGGBB`, otherwise it is stored as `null`
- Restore applies the same validation; the existing restore size caps already cover `closet.json`.
- **An answer that arrives late is dropped** when the item was deleted or its `photoRevision` changed while the call ran (the same check as `kept` in `src/app/AiLooks.tsx`). It still counts toward the cap.
- An analysis made with an older `promptVersion` still counts as done. The bulk run doesn't resend it; a later PR can offer "re-analyse with the new prompt" if the prompt changes.
- Deleting an item removes its analysis with it. Backups carry it inside `closet.json`.
- Every write goes through `ClosetRepository`, one at a time.

## 6. AI provider layer

`src/ai/catalog.ts` gets `endpoints.analyze` and `defaultAnalysisModel` per provider. Each adapter in `src/ai/providers.ts` gets `analyzeItem()`; `src/ai/send.ts` gets `requestAttributes()`, which strips metadata, applies a **60 s** timeout, caps the answer size and validates it. Errors reuse `AiError` and its reasons.

Request (OpenAI-compatible chat completions on both providers):
- one system message with the prompt below, one user message holding the photo as an `image_url` data URL
- `temperature: 0`
- `response_format: { type: 'json_schema', json_schema: { name: 'garment', strict: true, schema } }`, with `additionalProperties: false` on every object and every field listed in `required` (nullable fields use `["string", "null"]`, and a nullable enum also lists `null` in its `enum`), as Venice requires
- the answer is `choices[0].message.content`; a surrounding code fence is removed before `JSON.parse`

### Prompt (version 1)

```
You are a clothing-cataloging assistant for a children's closet app.
You will receive one photo of a single clothing item. Analyze the item
and return ONLY a JSON object that follows the schema below. No extra text.

RULES
- Describe only the clothing item. Never describe a person, face, body
  or background, even if visible.
- Use ONLY the allowed values listed for each enum field. For "category",
  "pattern" and "material_guess", use "other" when nothing fits and explain
  in "notes". For every other enum field, pick the closest value.
- Fields marked "| null" may be null when the detail is not visible or you
  are unsure. Fields without "| null" always need your best estimate.
- Colors: judge the true fabric color, correcting for lighting and shadows.
  Name colors with simple words a child understands.
- If the photo contains no clothing item, or more than one item, set
  "valid_image" to false, explain in "notes", and still fill every other
  field with your best guess (it will be ignored).

SCHEMA
{
  "valid_image": true | false,
  "category": "top" | "bottom" | "dress" | "outerwear" | "shoes" | "accessory" | "other",
  "subcategory": string,              // e.g. "t-shirt", "hoodie", "jeans", "leggings", "sneakers", "cap"
  "primary_color": string,            // e.g. "navy", "white", "red"
  "primary_color_hex": string,        // approximate, e.g. "#1F2A44"
  "secondary_colors": [string],       // empty array if none
  "color_family": "neutral" | "colorful",
                                      // neutral = black, white, gray, navy, beige, brown, denim blue
  "pattern": "solid" | "stripes" | "checks_plaid" | "dots" | "floral" | "graphic_print" | "character_print" | "camo" | "animal_print" | "other",
  "graphic_description": string | null, // short description of any print, e.g. "small dinosaur on chest"
  "text_on_item": string | null,      // any visible words or slogans
  "busyness": "low" | "medium" | "high",
                                      // low = plain or tiny detail; high = large or all-over bold print
  "formality": ["play", "school", "sport", "party"],
                                      // one or more suitable occasions
  "season": ["summer", "mid", "winter"],
                                      // one or more seasons it suits
  "warmth": "light" | "medium" | "heavy",
  "sleeve_length": "sleeveless" | "short" | "three_quarter" | "long" | null,
                                      // tops, dresses, outerwear only
  "leg_length": "shorts" | "capri" | "full" | null,
                                      // bottoms only
  "material_guess": "cotton" | "denim" | "knit" | "fleece" | "synthetic" | "wool" | "leather" | "other" | null,
  "fit": "slim" | "regular" | "loose" | null,
  "closure": "none" | "buttons" | "zipper" | "velcro" | "laces" | "elastic" | null,
  "style_tags": [string],             // up to 5, e.g. "sporty", "cozy", "dressy", "casual"
  "short_title": string,              // max 5 words, e.g. "Navy dinosaur t-shirt"
  "kid_friendly_description": string, // one sentence a child can read
  "confidence": "high" | "medium" | "low",
  "notes": string | null
}
```

When `valid_image` is false the answer is stored as `invalid-photo` with its `notes` only; the other fields are not validated.

The prompt is built in; the parent can't edit it, because the code validates against its schema. A change to it raises `promptVersion`.

## 7. UX

Reviewed by the UI/UX agent (2026-10-27). All existing UX rules apply: Hebrew RTL, touch targets ≥ 44 px, colours only through tokens, garment photos never dimmed.

**Processed sign (kid)**
- Done: the existing `.fav-ai-mark` (28 px `--surface` circle, `sparkle` icon in `--ai`) at the top `inset-inline-start` corner of the photo in "הארון שלי" and next to the photo in the edit sheet.
- In progress: the same mark at reduced opacity, no animation in the grid. Only the mark is faded, never the photo.
- Not analysed, failed: no mark.
- The edit sheet explains the mark once: "ה־AI כבר מכיר את הבגד הזה". Card `aria-label`: "עריכת {name} · ה־AI מכיר".

**Auto-analysis after adding**
- The add flow doesn't change: "נשמר בארון" with "לארון", no extra toast.
- Offline: nothing is sent; the session's items are retried on the `online` event. An item added offline whose app is closed before the phone reconnects is not retried automatically; her resend or the parent's bulk run covers it.
- Failures are silent for her; the parent sees the reason. No automatic retry after a counted failure.
- Its own one-at-a-time queue in shared state (like `src/app/AiLooks.tsx`), separate from the doll queue, so analysis never delays a doll she is waiting for.

**Kid's resend (edit sheet, under the photo, `.ai-btn`)**
- Not analysed: "להראות ל־AI". Failed or invalid photo: "לנסות שוב עם ה־AI".
- Waiting: "ה־AI מסתכל על הבגד…", button disabled.
- Error: "לא הצלחנו הפעם. נסי שוב אחר כך." in `--danger-text`.
- At the cap: disabled, "אפשר לנסות שוב ב־1 בנובמבר" (the real date of next month).
- Hidden when the item is done.
- Invalid photo: a muted line, not an error: "ה־AI לא הצליח לזהות את הבגד בתמונה. כדאי לצלם על רקע חלק ובהיר." It counts toward the cap (it was paid) and is not retried automatically.

**Parent: "הגדרות AI" → new section "זיהוי בגדים"**
- Switch to turn it on, model field (placeholder = the provider's default), monthly cap (default 300), counts ("38 מזוהים · 2 נכשלו · 1 תמונה לא ברורה").
- **"בדיקת זיהוי"** checks the whole path (CORS, key, model, schema) before any of her photos leave the phone: it sends a bundled sample garment photo (`src/assets/sample-garment.webp`, pre-cached by the service worker; like the default doll, the build fails if it isn't in the pre-cache list), never one of hers, and works with the switch still off. On success it shows the answer's `short_title` ("הזיהוי עובד · Blue striped t-shirt"); on failure, the reason from `src/ui/aiErrors.ts`. It counts toward the analysis cap, because it is paid.
- Button "לשלוח N בגדים לזיהוי" (not analysed, not outgrown).
- Confirmation sheet like the delete flow in `Parent.tsx`: "לשלוח N תמונות בגדים ל־AI?" / "כל בגד = בקשה אחת. נשארו החודש: M." A cost estimate only when the catalog has a confirmed price, in ISO currency format (USD); never guessed.
- Progress: a determinate `.usage-bar`, "נשלחו 12 מתוך 47". It keeps running when she leaves the parent area.
- "עצירה" doesn't start the next item; the current one finishes and is saved.
- A 401, 402 or 429 stops the run at once and shows the reason.
- End summary: "45 זוהו · 2 נכשלו", with each failure's reason.

**Parent: "בובה ו־AI" panel** stays short: two usage lines, "בובות: 23 מתוך 100" and "זיהוי בגדים: 40 מתוך 300", plus progress while a bulk run is going.

**Photo replacement (PR 4)**: "החלפת תמונה" in the edit sheet, through the same take/choose flow as `AddItem.tsx`. The new photo replaces `images/<id>.<ext>`, and the same write raises `photoRevision` and clears `analysis`, so the item counts as not analysed and is sent again automatically by PR 3's queue when the feature is on. `useImageUrl` (`src/ui/common.tsx`) caches by path, which stays the same, so its key must include `photoRevision`; otherwise the old photo keeps showing.

## 8. Pull requests

Each PR follows `CLAUDE.md`: branch from `main`, draft PR, review agent, fixes as new commits (no force-push), ready when CI is green and the review is confirmed.

| # | Branch | Scope | Depends on |
|---|---|---|---|
| 0 | `docs/ai-item-attributes` | This plan, `CLAUDE.md` pointer | — |
| 1 | `feat/item-attributes-model` | Schema v5 and migration, types and enums, validation on load, the prompt and JSON schema as constants, strict parser of the AI answer, `photoRevision` on items. No UI, no network. | 0 |
| 2 | `feat/ai-analyze-provider` | `analyze` endpoint and default model in the catalog, CSP, `analyzeItem` in both adapters, `requestAttributes` in `send.ts`, analysis usage counter, "זיהוי בגדים" settings (switch, model, cap) and "בדיקת זיהוי" with the bundled sample photo, the docs and comments listed in §4, privacy text in README / `CLAUDE.md` / AI panel | 1 |
| 3 | `feat/analyze-items` | Analysis queue in shared state, auto-analysis after adding, retry on `online`, kid's resend, sparkle mark, parent bulk run with confirmation, progress, stop and summary, panel usage line | 2 |
| 4 | `feat/replace-item-photo` | "החלפת תמונה" in the edit sheet, `photoRevision` raised and `analysis` cleared in one write, image cache key with the revision, the decision on that item's doll looks (§3.4) | 3 |
| 5 | `feat/item-attributes-view` (later) | Parent sees and corrects an item's attributes | 3 |

## 9. Tests

Coverage thresholds stay: 80 % lines/statements/functions, 75 % branches.

**Core**
- v4 `closet.json` loads as v5 with `photoRevision: 0` and `analysis: null` on every item and the feature off.
- Storing an answer fails on unknown enum values, wrong types, missing fields and an empty `formality` or `season`; it cuts too-long strings and arrays and stores a bad hex as `null`.
- Deleting an item removes its analysis; an analysis whose `photoRevision` differs from the item's counts as not analysed.
- An invalid stored analysis (bad enum, wrong type, unknown provider) loads as `null`; the rest of the closet loads normally.
- Strings and arrays over their limits are cut to the limit when an answer is stored; on load, an analysis over the limits is dropped to `null`.

**Parser**
- A valid answer, an answer in a code fence, `valid_image: false`, missing fields, extra fields, non-JSON, and an answer over 64 KB.

**Providers (fake `fetch`)**
- Both adapters: URL, headers, model, system prompt, the photo as a data URL, `temperature: 0`, `response_format`.
- `stripPhotoMetadata()` runs on the photo before sending.
- 401, 402, 429, 5xx, refusal, timeout, a broken answer → the right reason; the key never appears in errors.

**Storage and backup**
- A backup round trip keeps every analysis and its `photoRevision`, so no item looks unanalysed after a restore.
- The analysis counter is device-only and never in the backup.

**Queue and UI**
- Auto-analysis after adding only when on and online; one call at a time; nothing sent when off.
- Resend shown only when not done; disabled while waiting and at the cap.
- Bulk run skips analysed and outgrown items, counts usage, stops on 401/402/429 and on "עצירה" after the current item.
- The mark shows only for done items; garment photos are never dimmed.
- A late answer is dropped when the item was deleted or its photo replaced while the call ran, and still counts.
- Analysis uses only its own counter and cap; the dolls' count and countdown never change.
- "בדיקת זיהוי" sends the bundled sample, never one of her photos, works with the switch off, and counts toward the analysis cap.
- The CSP list matches the catalog's endpoints, including `analyze`.
