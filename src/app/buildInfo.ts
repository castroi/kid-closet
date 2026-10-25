/*
 * What build is running, for the parent area. Both values are set at build time by
 * vite.config.ts from package.json and the git commit, so the same commit always
 * produces the same text (no dates or random parts).
 */
declare const __APP_VERSION__: string | undefined;
declare const __APP_COMMIT__: string | undefined;

export const REPO_URL = 'https://github.com/castroi/kid-closet';

export interface BuildInfo {
  version: string;
  /** Full commit SHA, or '' when the build didn't know it (local development). */
  commit: string;
}

export const BUILD_INFO: BuildInfo = {
  version: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev',
  commit: typeof __APP_COMMIT__ === 'string' ? __APP_COMMIT__ : '',
};

const SHA = /^[0-9a-f]{7,40}$/;

/** The first 7 characters of the commit, as GitHub shows it; '' if unknown or not a SHA. */
export function shortCommit(commit: string): string {
  return SHA.test(commit) ? commit.slice(0, 7) : '';
}

/** The commit's page on GitHub, or null if the commit is unknown. */
export function commitUrl(commit: string): string | null {
  return SHA.test(commit) ? `${REPO_URL}/commit/${commit}` : null;
}
