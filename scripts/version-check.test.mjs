// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  allowedVersions,
  branchFromMergeMessage,
  checkVersion,
  nextVersions,
  parseVersion,
  lockfileMatches,
  targetVersion,
  withVersion,
} from './version-check.mjs';

const ok = (branch, base, head) => checkVersion({ branch, base, head, lock: head });

describe('parseVersion', () => {
  it('reads plain versions only', () => {
    expect(parseVersion('1.4.0')).toEqual([1, 4, 0]);
    expect(parseVersion('0.10.12')).toEqual([0, 10, 12]);
    for (const bad of ['v1.4.0', '1.4', '1.4.0-beta', '01.4.0', '', undefined]) {
      expect(() => parseVersion(bad)).toThrow('is not a version');
    }
  });

  it('computes the next versions', () => {
    expect(nextVersions('1.3.7')).toEqual({ patch: '1.3.8', minor: '1.4.0', major: '2.0.0' });
  });
});

describe('checkVersion', () => {
  it('feat needs the next minor (or major)', () => {
    expect(ok('feat/gallery', '1.3.0', '1.4.0').ok).toBe(true);
    expect(ok('feat/gallery', '1.3.0', '2.0.0').ok).toBe(true);
    const missed = ok('feat/gallery', '1.3.0', '1.3.0');
    expect(missed.ok).toBe(false);
    expect(missed.message).toContain('needs version 1.4.0 or 2.0.0');
    expect(missed.message).toContain('npm run version:bump');
    expect(missed.message).toContain('"Update version and lockfile" workflow');
    expect(ok('feat/gallery', '1.3.0', '1.3.1').ok).toBe(false);
    expect(ok('feat/gallery', '1.3.0', '1.5.0').ok).toBe(false);
  });

  it('fix needs the next patch', () => {
    expect(ok('fix/swipe', '1.3.0', '1.3.1').ok).toBe(true);
    expect(ok('fix/swipe', '1.3.0', '1.4.0').ok).toBe(false);
    expect(ok('fix/swipe', '1.3.0', '1.3.0').message).toContain('npm run version:bump');
  });

  it('chore, docs and test may keep the version or bump the patch', () => {
    for (const type of ['chore', 'docs', 'test']) {
      expect(ok(`${type}/x`, '1.3.0', '1.3.0').ok).toBe(true);
      expect(ok(`${type}/x`, '1.3.0', '1.3.1').ok).toBe(true);
      expect(ok(`${type}/x`, '1.3.0', '1.4.0').ok).toBe(false);
    }
  });

  it('never lets the version go down', () => {
    expect(ok('feat/x', '1.3.0', '1.2.0').ok).toBe(false);
    expect(ok('docs/x', '1.3.0', '1.2.9').ok).toBe(false);
  });

  it('asks for a typed branch name', () => {
    const r = ok('patch-1', '1.3.0', '1.3.1');
    expect(r.ok).toBe(false);
    expect(r.message).toContain('feat/..., fix/..., chore/..., docs/... or test/...');
    expect(allowedVersions('main', '1.0.0')).toBeNull();
    // A type alone, or a type without the slash, isn't a typed branch name.
    expect(allowedVersions('feat', '1.0.0')).toBeNull();
    expect(allowedVersions('feat/', '1.0.0')).toBeNull();
    expect(allowedVersions('feature/x', '1.0.0')).toBeNull();
  });

  it('tells chore, docs and test branches what versions they may have', () => {
    const r = ok('docs/readme', '1.3.0', '1.4.0');
    expect(r.ok).toBe(false);
    expect(r.message).toContain('needs version 1.3.0 or 1.3.1');
    expect(r.message).toContain('npm run version:bump');
  });

  it('requires both versions in package-lock.json to match', () => {
    const r = checkVersion({ branch: 'feat/x', base: '1.3.0', head: '1.4.0', lock: '1.3.0' });
    expect(r.ok).toBe(false);
    expect(r.message).toContain('package-lock.json has version 1.3.0');
    const root = checkVersion({ branch: 'feat/x', base: '1.3.0', head: '1.4.0', lock: '1.4.0', rootLock: '1.3.0' });
    expect(root.ok).toBe(false);
    expect(root.message).toContain('package-lock.json has version 1.3.0');
    expect(checkVersion({ branch: 'feat/x', base: '1.3.0', head: '1.4.0', lock: '1.4.0', rootLock: '1.4.0' }).ok).toBe(true);
  });

  it('rejects malformed versions', () => {
    expect(ok('feat/x', '1.3', '1.4.0').message).toContain('is not a version');
    expect(ok('feat/x', '1.3.0', 'v1.4.0').message).toContain('is not a version');
  });
});

describe('branchFromMergeMessage', () => {
  it('reads the branch of a GitHub pull request merge', () => {
    expect(branchFromMergeMessage('Merge pull request #40 from castroi/feat/gallery')).toBe('feat/gallery');
    expect(branchFromMergeMessage('Merge pull request #7 from someone/fix/a-b')).toBe('fix/a-b');
  });

  it('ignores other commits', () => {
    expect(branchFromMergeMessage('Add the gallery (#40)')).toBeNull();
    expect(branchFromMergeMessage('Initial commit')).toBeNull();
    expect(branchFromMergeMessage('')).toBeNull();
  });
});

describe('targetVersion', () => {
  it('sets what the branch type needs', () => {
    expect(targetVersion('feat/x', '1.3.0', '1.3.0')).toBe('1.4.0');
    expect(targetVersion('fix/x', '1.3.0', '1.3.0')).toBe('1.3.1');
    expect(targetVersion('docs/x', '1.3.0', '1.3.0')).toBe('1.3.0');
  });

  it('keeps a version that is already right', () => {
    expect(targetVersion('feat/x', '1.3.0', '1.4.0')).toBe('1.4.0');
    expect(targetVersion('feat/x', '1.3.0', '2.0.0')).toBe('2.0.0'); // a deliberate major
    expect(targetVersion('chore/x', '1.3.0', '1.3.1')).toBe('1.3.1');
  });

  it('re-bumps when main moved on', () => {
    // This branch took 1.4.0, then another feat merged 1.4.0 first.
    expect(targetVersion('feat/x', '1.4.0', '1.4.0')).toBe('1.5.0');
    expect(targetVersion('fix/x', '1.3.1', '1.3.1')).toBe('1.3.2');
  });

  it('undoes a wrong bump on chore, docs and test', () => {
    expect(targetVersion('test/x', '1.3.0', '1.4.0')).toBe('1.3.0');
  });

  it('fixes an unreadable version', () => {
    expect(targetVersion('fix/x', '1.3.0', 'oops')).toBe('1.3.1');
  });

  it('leaves untyped branches alone', () => {
    expect(targetVersion('patch-1', '1.3.0', '1.3.0')).toBeNull();
  });
});

describe('withVersion', () => {
  const pkg = `${JSON.stringify({ name: 'kid-closet', version: '1.3.0', scripts: { test: 'vitest run' } }, null, 2)}\n`;
  const lock = `${JSON.stringify(
    { name: 'kid-closet', version: '1.3.0', lockfileVersion: 3, packages: { '': { name: 'kid-closet', version: '1.3.0' }, 'node_modules/a': { version: '9.9.9' } } },
    null,
    2,
  )}\n`;

  it('changes only the version, in package.json and both lockfile fields', () => {
    const out = withVersion(pkg, lock, '1.4.0');
    expect(out.packageText).toBe(pkg.replace('"version": "1.3.0"', '"version": "1.4.0"'));
    expect(out.lockText).toBe(lock.replace(/"version": "1\.3\.0"/g, '"version": "1.4.0"'));
    expect(out.lockText).toContain('"version": "9.9.9"'); // dependencies untouched
  });

  it('gives back identical text when the version is already right', () => {
    const out = withVersion(pkg, lock, '1.3.0');
    expect(out.packageText).toBe(pkg);
    expect(out.lockText).toBe(lock);
  });
});

describe('lockfileMatches', () => {
  const pkg = { dependencies: { react: '19.3.1', fflate: '0.8.3' }, devDependencies: { vitest: '^3.2.0' } };
  const lockFor = (root) => ({ packages: { '': root } });

  it('is true when the lockfile lists the same dependencies, in any order', () => {
    expect(lockfileMatches(pkg, lockFor({ dependencies: { fflate: '0.8.3', react: '19.3.1' }, devDependencies: { vitest: '^3.2.0' } }))).toBe(true);
  });

  it('is false when a dependency was added, removed or changed', () => {
    expect(lockfileMatches(pkg, lockFor({ dependencies: { react: '19.3.1' }, devDependencies: { vitest: '^3.2.0' } }))).toBe(false);
    expect(lockfileMatches(pkg, lockFor({ dependencies: { react: '19.3.0', fflate: '0.8.3' }, devDependencies: { vitest: '^3.2.0' } }))).toBe(false);
    expect(lockfileMatches({ ...pkg, optionalDependencies: { a: '1.0.0' } }, lockFor({ dependencies: pkg.dependencies, devDependencies: pkg.devDependencies }))).toBe(false);
  });

  it('treats a missing field like an empty one, and a missing root as out of date', () => {
    expect(lockfileMatches({ dependencies: { a: '1' }, devDependencies: {} }, lockFor({ dependencies: { a: '1' } }))).toBe(true);
    expect(lockfileMatches(pkg, {})).toBe(false);
  });
});

