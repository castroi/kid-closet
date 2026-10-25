// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { BUILD_INFO, REPO_URL, commitUrl, shortCommit } from './buildInfo';
import pkg from '../../package.json';

const SHA = 'd8d5480aa1b2c3d4e5f60718293a4b5c6d7e8f90';

describe('build info', () => {
  it('takes the version from package.json', () => {
    expect(BUILD_INFO.version).toBe(pkg.version);
  });

  it('shortens and links a commit', () => {
    expect(shortCommit(SHA)).toBe('d8d5480');
    expect(commitUrl(SHA)).toBe(`${REPO_URL}/commit/${SHA}`);
  });

  it('shows nothing for an unknown or odd commit', () => {
    for (const bad of ['', 'dev', 'D8D5480', '<script>', `${SHA}0`]) {
      expect(shortCommit(bad)).toBe('');
      expect(commitUrl(bad)).toBeNull();
    }
  });
});
