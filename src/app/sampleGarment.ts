import sampleGarmentUrl from '../assets/sample-garment.webp';

/**
 * A garment photo bundled with the app (a navy and white striped t-shirt). "בדיקת זיהוי" sends
 * it instead of one of her photos, so the whole path can be checked before any of hers leave the
 * phone (docs/ai-item-attributes.md §7). Part of the build, so the service worker caches it.
 */
export const SAMPLE_GARMENT_URL: string = sampleGarmentUrl;
