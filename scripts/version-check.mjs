#!/usr/bin/env node
/**
 * Checks that a pull request bumps the app version the way its branch type requires.
 * Run by CI on every pull request; same input, same verdict.
 *
 *   feat/...                    → next minor (1.3.0 → 1.4.0), or next major (→ 2.0.0) for a big change
 *   fix/...                     → next patch (1.3.0 → 1.3.1)
 *   chore/... docs/... test/... → unchanged, or next patch
 *
 * The version in package-lock.json must match package.json.
 *
 * Usage: node scripts/version-check.mjs --branch <head branch> [--base-ref HEAD^1]
 *   --base-ref is the git commit holding main's package.json; in a pull request
 *   checkout (a merge commit) its first parent is main.
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

/** The versions a branch may have, given main's version. */
export function allowedVersions(branch, base) {
  const type = String(branch).split('/')[0];
  const next = nextVersions(base);
  switch (type) {
    case 'feat':
      return { type, allowed: [next.minor, next.major], hint: 'npm version minor --no-git-tag-version' };
    case 'fix':
      return { type, allowed: [next.patch], hint: 'npm version patch --no-git-tag-version' };
    case 'chore':
    case 'docs':
    case 'test':
      return { type, allowed: [base, next.patch], hint: 'no change needed' };
    default:
      return null;
  }
}

/** Returns { ok, message }. */
export function checkVersion({ branch, base, head, lock }) {
  try {
    parseVersion(base);
    parseVersion(head);
  } catch (err) {
    return { ok: false, message: err.message };
  }
  if (lock !== head) {
    return {
      ok: false,
      message: `package-lock.json has version ${lock} but package.json has ${head}. Bump with "npm version", which updates both, or push and let the "Update lockfile" workflow fix it.`,
    };
  }
  const rule = allowedVersions(branch, base);
  if (!rule) {
    return {
      ok: false,
      message: `Branch "${branch}" doesn't start with feat/, fix/, chore/, docs/ or test/, so its version bump can't be checked. Rename the branch (see CLAUDE.md).`,
    };
  }
  if (rule.allowed.includes(head)) {
    return { ok: true, message: `${branch}: version ${head} (main has ${base}) is right for a ${rule.type} change.` };
  }
  return {
    ok: false,
    message:
      `${branch}: a ${rule.type} change needs version ${rule.allowed.join(' or ')} (main has ${base}), but package.json has ${head}. ` +
      `Run: ${rule.hint}` +
      (rule.type === 'feat' || rule.type === 'fix' ? ' (after merging main, if main moved on).' : '.'),
  };
}

function readArg(args, name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

function main(args) {
  const branch = readArg(args, '--branch');
  const baseRef = readArg(args, '--base-ref') ?? 'HEAD^1';
  if (!branch) {
    console.error('Missing --branch <name>');
    return 2;
  }
  // execFileSync without a shell: the ref is passed as one argument, never interpreted.
  const base = JSON.parse(execFileSync('git', ['show', `${baseRef}:package.json`], { encoding: 'utf8' })).version;
  const head = JSON.parse(readFileSync('package.json', 'utf8')).version;
  const lock = JSON.parse(readFileSync('package-lock.json', 'utf8')).version;
  const result = checkVersion({ branch, base, head, lock });
  (result.ok ? console.log : console.error)(result.message);
  return result.ok ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exitCode = main(process.argv.slice(2));
}
