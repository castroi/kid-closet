#!/usr/bin/env node
/**
 * Checks that a pull request bumps the app version the way its branch type requires.
 * Run by CI on every pull request; same input, same verdict.
 *
 *   feat/...                    → next minor (1.3.0 → 1.4.0), or next major (→ 2.0.0) for a big change
 *   fix/...                     → next patch (1.3.0 → 1.3.1)
 *   chore/... docs/... test/... → unchanged, or next patch
 *
 * The version in package-lock.json (both of its fields) must match package.json.
 *
 * Usage:
 *   node scripts/version-check.mjs --branch <head branch> --base-ref origin/main
 *     A branch, against main's current package.json (CI fetches main first).
 *   node scripts/version-check.mjs --merge-commit HEAD
 *     On main after a pull request was merged: the merged branch's type comes from the
 *     merge message ("Merge pull request #12 from owner/feat/x"), the base is the
 *     merge's first parent. Catches two PRs that took the same version.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
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
      return { type, allowed: [next.minor, next.major], hint: 'npm version minor --no-git-tag-version' };
    case 'fix':
      return { type, allowed: [next.patch], hint: 'npm version patch --no-git-tag-version' };
    case 'chore':
    case 'docs':
    case 'test':
      return { type, allowed: [base, next.patch], hint: `set "version" in package.json back to ${base} (or ${next.patch}) and run npm install --package-lock-only` };
  }
}

/** Returns { ok, message }. */
/**
 * The branch a GitHub merge commit came from, e.g. "Merge pull request #12 from castroi/feat/x" → "feat/x";
 * null for any other commit message (a squash merge, a direct commit).
 */
export function branchFromMergeMessage(message) {
  const m = /^Merge pull request #\d+ from [^/\s]+\/(\S+)/.exec(String(message));
  return m ? m[1] : null;
}

/** lock is package-lock.json's top-level version, rootLock its packages[""].version. */
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
      message: `package-lock.json has version ${lock !== head ? lock : rootLock} but package.json has ${head}. Bump with "npm version", which updates both, or push and let the "Update lockfile" workflow fix it.`,
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
      `Fix: ${rule.hint}` +
      (rule.type === 'feat' || rule.type === 'fix' ? ' (after merging main, if main moved on).' : '.'),
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

function main(args) {
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
