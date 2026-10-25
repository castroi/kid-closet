// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { allowedVersions, checkVersion, nextVersions, parseVersion } from './version-check.mjs';

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
    expect(missed.message).toContain('npm version minor --no-git-tag-version');
    expect(ok('feat/gallery', '1.3.0', '1.3.1').ok).toBe(false);
    expect(ok('feat/gallery', '1.3.0', '1.5.0').ok).toBe(false);
  });

  it('fix needs the next patch', () => {
    expect(ok('fix/swipe', '1.3.0', '1.3.1').ok).toBe(true);
    expect(ok('fix/swipe', '1.3.0', '1.4.0').ok).toBe(false);
    expect(ok('fix/swipe', '1.3.0', '1.3.0').message).toContain('npm version patch');
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
    expect(r.message).toContain('feat/, fix/, chore/, docs/ or test/');
    expect(allowedVersions('main', '1.0.0')).toBeNull();
  });

  it('requires package-lock.json to match', () => {
    const r = checkVersion({ branch: 'feat/x', base: '1.3.0', head: '1.4.0', lock: '1.3.0' });
    expect(r.ok).toBe(false);
    expect(r.message).toContain('package-lock.json has version 1.3.0');
  });

  it('rejects malformed versions', () => {
    expect(ok('feat/x', '1.3', '1.4.0').message).toContain('is not a version');
    expect(ok('feat/x', '1.3.0', 'v1.4.0').message).toContain('is not a version');
  });
});
