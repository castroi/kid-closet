# kid-closet — project rules

Outfit picker for one 11-year-old on her iPhone. Static PWA on Vercel; no server, no database.

## Git workflow

- Every change gets its own branch from `main`, named `<type>/<short-description>` (`feat`, `fix`, `chore`, `docs`, `test`). Why: `main` is what Vercel deploys.
- Never commit directly to `main`; push the branch and open a pull request. Only the owner merges, after CI is green.
- Run `npm run lint`, `npm run typecheck` and `npm run test:coverage` before pushing.
- Commit `package-lock.json` with every dependency change. If `npm install` can't run locally, just push the `package.json` change to your branch: the "Update lockfile" workflow commits the lockfile there by itself and reruns CI (never on `main`).
- A code review agent reviews every change before it is pushed.

## Platform decisions

| Rule | Why |
|---|---|
| Data is plain files in OPFS: `closet-a.json` / `closet-b.json` written alternately with a rising `generation`, photos in `images/<id>.webp` (`.jpg` fallback) | Runs fully on the phone; an interrupted save never loses the previous version |
| Always save above the highest generation on disk, even one that can't be read | A newer app version's data is never outranked by mistake |
| An item's photo is always `images/<id>.<ext>` | Deleting one item can never remove another's photo |
| If the closet files exist but can't be read, show the recovery screen; never start empty over them | No silent data loss |
| Writes go through `ClosetRepository`, one at a time | Saves never interleave |
| Photos: resize to ≤800 px on the phone, WebP via `@jsquash/webp`, JPEG if that fails | Safari can't encode WebP itself |
| Backup = one ZIP (`closet.json` + photos); restore validates everything, unpacks only known files, caps sizes | The only copy that survives removing the app |
| Hebrew, right to left; touch targets ≥ 44 px | It's for the kid |
| Theme: "כמו בטלפון" (follows the phone, default) / בהיר / כהה, chosen by her in הגדרות (gear next to the lock in the closet screen), saved per device in localStorage (`src/app/theme.ts`), never in the closet or backups | It's her preference and belongs to the device; the dress-up screen keeps its 3 decisions |
| Colours only through the tokens in `src/styles.css`; text on an `--ink` fill uses `--on-ink`; accent/danger as text use `--accent-text` / `--danger-text` | Both themes keep readable contrast |
| The inline script in `index.html` applies the theme before paint and must match `applyTheme()` (key, colours) | No flash of the wrong theme |
| Garment photos are never filtered or dimmed in dark mode | She matches real colours |
| Delete only in the parent area (behind a question); the kid has "outgrown" with undo | Safe from accidental taps |
| Bump `SCHEMA_VERSION` when `closet.json` changes shape, and keep reading old versions | Saved closets and backups keep working |
