# kid-closet

An outfit picker for an 11-year-old, made as a web app that is added to the iPhone home screen.
She picks where she is going (school, a regular day, a festive event), the weather, and swipes
through her own clothes: an outer layer when it is cold, a shirt and trousers.

Everything runs **on the phone**. There is no server and no account; photos never leave the device
unless a parent exports a backup.

## Screens

| Screen | What it does |
| --- | --- |
| להתלבש (Dress up) | Occasion, cold/warm switch, rows for outer layer / shirt / trousers with arrows and swipe, per-row type & colour filter, preview of the look, save to favourites. |
| מועדפים (Favourites) | Saved looks, filter by occasion, tap to open, remove. |
| הארון שלי (My closet) | Items by category, tap to edit, select several to move to / from "outgrown" with undo. |
| הוספה (Add) | Take or choose a photo, pick type, occasions and colour. The name is optional. |
| אזור הורים (Parents) | Behind a simple question: backup export / restore, storage status, permanent delete. |

## How data is stored

The app writes plain files into the browser's private folder for this site
([Origin Private File System](https://webkit.org/?p=12257)):

```
closet-a.json   ┐ the closet list, written alternately with an increasing
closet-b.json   ┘ generation number, so an interrupted save never loses data
images/<id>.webp  one photo per item (JPEG if WebP encoding fails)
```

- Photos are resized on the phone to at most 800 px and encoded to WebP with a WebAssembly
  encoder ([`@jsquash/webp`](https://github.com/jamsinclair/jSquash)), because Safari cannot encode
  WebP itself.
- These files are **not visible in the Files app**, and they are deleted if the app is removed from
  the home screen or Safari's website data is cleared. Use **Parents → Export backup** regularly; it
  creates one ZIP with `closet.json` and all photos that can be saved to iCloud Drive and restored
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
(linked to GitHub). Each pull request sets the version itself, and CI checks it against `main`:

| Branch | Version | Command |
| --- | --- | --- |
| `feat/...` | next minor (1.3.0 → 1.4.0), or next major for a big change | `npm version minor --no-git-tag-version` |
| `fix/...` | next patch (1.3.0 → 1.3.1) | `npm version patch --no-git-tag-version` |
| `chore/...`, `docs/...`, `test/...` | unchanged, or next patch | — |

If `main` gets a new version while your PR is open, merge `main` into the branch and bump again.

