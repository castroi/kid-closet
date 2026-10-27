# kid-closet

An outfit picker for an 11-year-old, made as a web app that is added to the iPhone home screen.
She picks where she is going (school, a regular day, a festive event), the weather, and swipes
through her own clothes: an outer layer when it is cold, a shirt and trousers.

Everything runs **on the phone**. There is no server and no account. Photos leave the device only when a parent
exports a backup, or after a parent sets up AI looks (an AI provider and her own API key, in the parent area): then
the doll and the two garments of a look are sent to that provider, and nowhere else. When the parent also turns on
"זיהוי בגדים" (garment analysis), garment photos are sent to the same provider automatically, so a vision model can
describe them (colours, pattern, season); only the photo is sent.

## Screens

| Screen | What it does |
| --- | --- |
| להתלבש (Dress up) | Occasion, cold/warm switch, rows for outer layer / shirt / trousers with arrows and swipe, per-row type & colour filter, preview of the look (with "להלביש את הבובה" once a parent set up AI), save to favourites. |
| מועדפים (Favourites) | Saved looks, filter by occasion, tap to open, remove. |
| הארון שלי (My closet) | Items by category, tap to edit, select several to move to / from "outgrown" with undo. |
| הוספה (Add) | Take or choose a photo, pick type, occasions and colour. The name is optional. |
| אזור הורים (Parents) | Behind a simple question: backup export / restore, "בובה ו־AI" (status, monthly use, and the "הגדרות AI" screen: provider, API key, model, monthly cap, garment analysis with its own model and cap and "בדיקת זיהוי", doll, prompt), storage status, permanent delete. |

## How data is stored

The app writes plain files into the browser's private folder for this site
([Origin Private File System](https://webkit.org/?p=12257)):

```
closet-a.json   ┐ the closet list, written alternately with an increasing
closet-b.json   ┘ generation number, so an interrupted save never loses data
images/<id>.webp  one photo per item (JPEG if WebP encoding fails)
images/doll-<id>.webp  the parent's doll picture, if she replaced the bundled one
images/look-<id>.webp  a picture of the doll wearing a look, made by the AI
```

- Photos are resized on the phone to at most 800 px and encoded to WebP with a WebAssembly
  encoder ([`@jsquash/webp`](https://github.com/jamsinclair/jSquash)), because Safari cannot encode
  WebP itself.
- These files are **not visible in the Files app**, and they are deleted if the app is removed from
  the home screen or Safari's website data is cleared. Use **Parents → Export backup** regularly; it
  creates one ZIP with `closet.json` and all photos (including the doll) that can be saved to iCloud Drive and restored
  later.
- On start the app asks the browser to keep its storage persistent (`navigator.storage.persist()`).

Requires iOS 15.2 or later.

## Development

```bash
npm install
npm run dev            # local dev server
npm run lint
npm run typecheck
npm test               # unit and component tests
npm run test:coverage  # same, with coverage thresholds (80% lines/statements/functions, 75% branches)
npm run build          # production build into dist/
```

Code layout:

```
src/core      pure logic: data model, filtering, validation of closet.json
src/storage   file store (OPFS + in-memory), repository with safe saves, backup ZIP
src/image     resize + WebP/JPEG encoding
src/app       app shell, React context, device helpers (share, persistence)
src/ui        screens
public/sw.js  offline cache (service worker)
```

Browser-only glue that jsdom cannot execute (the OPFS write worker, canvas/WebP encoding, service
worker registration and `main.tsx`) is excluded from coverage; the logic around it is tested with
fakes.

## CI

GitHub Actions (`.github/workflows/ci.yml`) runs lint, typecheck, tests with coverage and the build on
every push to `main` and every pull request. The coverage report is uploaded as a build artifact.

## Deploying to Vercel

1. Import the repository in Vercel. The framework is detected as Vite; `vercel.json` sets the build
   command and output folder.
2. Open the deployed URL in **Safari** on the iPhone, tap Share → **Add to Home Screen**.
3. Open the app from the home screen and add the clothes **there**. The home-screen app keeps its own
   storage, separate from the Safari tab.

## Versions

The app's version is in `package.json` and is shown in the parent area together with the commit it was built from
(linked to GitHub). The version follows the branch type, against `main`:

| Branch | Version |
| --- | --- |
| `feat/...` | next minor (1.3.0 → 1.4.0), or a deliberate next major |
| `fix/...` | next patch (1.3.0 → 1.3.1) |
| `chore/...`, `docs/...`, `test/...` | unchanged, or next patch |

**You don't set it by hand.** On every push to a branch, the "Update version and lockfile" workflow sets the
version against `main` as it is at that moment, updates `package-lock.json` if it's out of date, commits to the
branch and reruns CI. It never changes `main`. If it made a commit, pull before you push again. On a branch's
first push, CI on your own commit may show red for a minute while the workflow adds the version; the PR follows
the workflow's commit, which goes green.

**When `main` moves on while a PR is open,** press GitHub's **"Update branch"** button on the PR (or merge `main`
into the branch yourself). That merge is a push, so the workflow then sets the next version. Until the branch
contains the latest `main`, the workflow leaves the version alone, because bumping past a `main` the branch
hasn't merged would make the version lines conflict.

**If the version lines conflict anyway** (for example a fix at 0.2.1 meets a `main` at 0.3.0): when resolving,
take `main`'s version in `package.json` and both places in `package-lock.json`, and push. The workflow then sets
the right one.

**Locally**, `git fetch origin main` first, then `npm run version:bump` does the same as the workflow.

CI checks the version on every run of a branch and again on `main` after each merge. To have GitHub require an
up-to-date branch before the merge button works, turn on Settings → Branches → the rule for `main` → "Require
status checks to pass" and "Require branches to be up to date before merging".

The commit shown in the app is set by Vercel's build from the commit it deployed, so it changes on every merge
without anyone doing anything.
