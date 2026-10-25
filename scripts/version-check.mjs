#!/usr/bin/env node
/**
 * Checks, and can set, the app version a branch needs for its type. One set of rules
 * for both, so the bump and the check can never disagree; same input, same result.
 *
 *   feat/...                    → next minor (1.3.0 → 1.4.0), or next major (→ 2.0.0) for a big change
 *   fix/...                     → next patch (1.3.0 → 1.3.1)
 *   chore/... docs/... test/... → unchanged, or next patch
 *
 * The version in package-lock.json (both of its fields) must match package.json.
 *
 * Usage:
 *   node scripts/version-check.mjs --branch <head branch> --base-ref origin/main
 *     Check a branch against main's current package.json (CI fetches main first).
 *   node scripts/version-check.mjs --bump [--branch <name>] [--base-ref origin/main]
 *     Set the version the branch needs (keeps it if it's already right) in package.json
 *     and both fields of package-lock.json. `npm run version:bump`; the "Update version
 *     and lockfile" workflow runs it on every push to a branch. Does nothing until the
 *     branch contains main: bumping past a main the branch hasn't merged yet would make
 *     the version lines conflict.
 *   node scripts/version-check.mjs --lock-in-sync
 *     Exit 0 if package-lock.json already records package.json's dependencies (so there's
 *     nothing for npm install to do), 1 if not.
 *   node scripts/version-check.mjs --merge-commit HEAD
 *     On main after a pull request was merged: the merged branch's type comes from the
 *     merge message ("Merge pull request #12 from owner/feat/x"), the base is the
 *     merge's first parent. Catches two PRs that took the same version.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/** "1.4.0" → [1, 4, 0]; throws on anything else (no pre-release tags, no "v"). */
export function parseVersion(text) {
  const m = VERSION.exec(String(text));
  if (!m) throw new Error(`"${text}" is not a version like 1.4.0`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

export function formatVersion([major, minor, patch]) {
  return `${major}.${minor}.${patch}`;
}

export function nextVersions(base) {
  const [major, minor, patch] = parseVersion(base);
  return {
    patch: formatVersion([major, minor, patch + 1]),
    minor: formatVersion([major, minor + 1, 0]),
    major: formatVersion([major + 1, 0, 0]),
  };
}

const TYPED_BRANCH = /^(feat|fix|chore|docs|test)\/./;

/** The versions a branch may have, given main's version; null if the branch has no type prefix. */
export function allowedVersions(branch, base) {
  const m = TYPED_BRANCH.exec(String(branch));
  if (!m) return null;
  const type = m[1];
  const next = nextVersions(base);
  switch (type) {
    case 'feat':
      return { type, allowed: [next.minor, next.major] };
    case 'fix':
      return { type, allowed: [next.patch] };
    case 'chore':
    case 'docs':
    case 'test':
      return { type, allowed: [base, next.patch] };
  }
}

const FIX_HINT = 'run npm run version:bump, or just push: the "Update version and lockfile" workflow sets it on the branch';

/**
 * The version a branch should have: its current one when that's already allowed (e.g. a feat
 * that chose the next major), otherwise the first allowed one (feat → next minor, fix → next
 * patch, chore/docs/test → main's). null for a branch without a type prefix.
 */
export function targetVersion(branch, base, head) {
  const rule = allowedVersions(branch, base);
  if (!rule) return null;
  return rule.allowed.includes(head) ? head : rule.allowed[0];
}

const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];

/**
 * Whether package-lock.json's root entry lists exactly package.json's dependencies. When it does,
 * the lockfile is already in sync and npm install has nothing to do (and can't add churn).
 */
export function lockfileMatches(pkg, lock) {
  const root = lock?.packages?.[''] ?? {};
  return DEPENDENCY_FIELDS.every((field) => JSON.stringify(sorted(pkg[field])) === JSON.stringify(sorted(root[field])));
}

function sorted(deps) {
  if (!deps || Object.keys(deps).length === 0) return {};
  return Object.fromEntries(Object.entries(deps).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/** package.json and package-lock.json text with the version set; formatted the way npm writes them. */
export function withVersion(packageText, lockText, version) {
  const pkg = JSON.parse(packageText);
  const lock = JSON.parse(lockText);
  pkg.version = version;
  lock.version = version;
  if (lock.packages?.['']) lock.packages[''].version = version;
  return { packageText: `${JSON.stringify(pkg, null, 2)}\n`, lockText: `${JSON.stringify(lock, null, 2)}\n` };
}

/**
 * The branch a GitHub merge commit came from, e.g. "Merge pull request #12 from castroi/feat/x" → "feat/x";
 * null for any other commit message (a squash merge, a direct commit).
 */
export function branchFromMergeMessage(message) {
  const m = /^Merge pull request #\d+ from [^/\s]+\/(\S+)/.exec(String(message));
  return m ? m[1] : null;
}

/** Returns { ok, message }. lock is package-lock.json's top-level version, rootLock its packages[""].version. */
export function checkVersion({ branch, base, head, lock, rootLock = lock }) {
  try {
    parseVersion(base);
    parseVersion(head);
  } catch (err) {
    return { ok: false, message: err.message };
  }
  if (lock !== head || rootLock !== head) {
    return {
      ok: false,
      message: `package-lock.json has version ${lock !== head ? lock : rootLock} but package.json has ${head}. Fix: ${FIX_HINT}.`,
    };
  }
  const rule = allowedVersions(branch, base);
  if (!rule) {
    return {
      ok: false,
      message: `Branch "${branch}" isn't named feat/..., fix/..., chore/..., docs/... or test/..., so its version bump can't be checked. Rename the branch (see CLAUDE.md).`,
    };
  }
  if (rule.allowed.includes(head)) {
    return { ok: true, message: `${branch}: version ${head} (main has ${base}) is right for a ${rule.type} change.` };
  }
  return {
    ok: false,
    message:
      `${branch}: a ${rule.type} change needs version ${rule.allowed.join(' or ')} (main has ${base}), but package.json has ${head}. ` +
      `Fix: ${FIX_HINT}.`,
  };
}

function readArg(args, name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

// execFileSync without a shell: refs and names are passed as single arguments, never interpreted.
function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8' });
}

function bump(args) {
  const branch = readArg(args, '--branch') ?? git('branch', '--show-current').trim();
  const baseRef = readArg(args, '--base-ref') ?? 'origin/main';
  let base;
  try {
    base = JSON.parse(git('show', `${baseRef}:package.json`)).version;
  } catch {
    console.error(`Can't read ${baseRef}:package.json. Fetch main first: git fetch origin main`);
    return 2;
  }
  if (!containsCommit(baseRef)) {
    console.log(
      `${branch} doesn't contain ${baseRef} yet; version left as is. Merge main into the branch (GitHub's "Update branch" button), then the version is set.`,
    );
    return 0;
  }
  const packageText = readFileSync('package.json', 'utf8');
  const lockText = readFileSync('package-lock.json', 'utf8');
  const head = JSON.parse(packageText).version;
  const target = targetVersion(branch, base, head);
  if (!target) {
    console.log(`Branch "${branch}" has no type prefix (feat/, fix/, chore/, docs/, test/); version left as ${head}.`);
    return 0;
  }
  const next = withVersion(packageText, lockText, target);
  if (next.packageText === packageText && next.lockText === lockText) {
    console.log(`${branch}: version ${head} is already right (main has ${base}).`);
    return 0;
  }
  writeFileSync('package.json', next.packageText);
  writeFileSync('package-lock.json', next.lockText);
  console.log(`${branch}: version ${head} → ${target} (main has ${base}).`);
  return 0;
}

/** Whether HEAD already contains ref (git merge-base --is-ancestor: exit 0 yes, 1 no). */
function containsCommit(ref) {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', ref, 'HEAD'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function main(args) {
  if (args.includes('--bump')) return bump(args);
  if (args.includes('--lock-in-sync')) {
    const inSync = lockfileMatches(JSON.parse(readFileSync('package.json', 'utf8')), JSON.parse(readFileSync('package-lock.json', 'utf8')));
    console.log(inSync ? 'package-lock.json lists the same dependencies as package.json.' : 'package-lock.json is out of date.');
    return inSync ? 0 : 1;
  }
  let branch = readArg(args, '--branch');
  let baseRef = readArg(args, '--base-ref');
  const mergeCommit = readArg(args, '--merge-commit');
  if (mergeCommit) {
    branch = branchFromMergeMessage(git('log', '-1', '--format=%s', mergeCommit));
    if (!branch) {
      console.log(`${mergeCommit} is not a pull request merge; nothing to check.`);
      return 0;
    }
    baseRef = `${mergeCommit}^1`;
  }
  if (!branch || !baseRef) {
    console.error('Usage: --branch <name> --base-ref <ref>, or --merge-commit <ref>');
    return 2;
  }
  const base = JSON.parse(git('show', `${baseRef}:package.json`)).version;
  const head = JSON.parse(readFileSync('package.json', 'utf8')).version;
  const lockFile = JSON.parse(readFileSync('package-lock.json', 'utf8'));
  const result = checkVersion({ branch, base, head, lock: lockFile.version, rootLock: lockFile.packages?.['']?.version });
  (result.ok ? console.log : console.error)(result.message);
  return result.ok ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exitCode = main(process.argv.slice(2));
}
