import defaultDollUrl from '../assets/doll-default.webp';

/**
 * The doll bundled with the app, used until the parent picks her own. It is part of
 * the build, so the service worker caches it for offline use like any other file.
 */
export const DEFAULT_DOLL_URL: string = defaultDollUrl;
