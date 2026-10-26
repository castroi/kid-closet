import type { AiProviderId } from '../core/model';

export interface AiProviderInfo {
  id: AiProviderId;
  label: string;
  origin: string;
  /**
   * The only URLs the app calls for this provider: making a look, and checking the key.
   * Exactly these are in the CSP's connect-src (vercel.json); securityHeaders.test.ts checks it.
   */
  endpoints: { look: string; check: string };
  /** Used when the parent leaves the model empty. Unconfirmed until the first real look (docs/ai-doll-look.md §3). */
  defaultModel: string;
  /** Where the parent creates an API key. */
  keysUrl: string;
}

/**
 * Providers the app can send a look to. Adding one = an entry here, its adapter in
 * src/ai/providers.ts, its endpoints in vercel.json's connect-src, and their tests.
 */
export const AI_PROVIDERS: Record<AiProviderId, AiProviderInfo> = {
  venice: {
    id: 'venice',
    label: 'Venice',
    origin: 'https://api.venice.ai',
    endpoints: {
      look: 'https://api.venice.ai/api/v1/image/multi-edit',
      check: 'https://api.venice.ai/api/v1/api_keys/rate_limits',
    },
    defaultModel: 'muse-image-edit',
    keysUrl: 'https://venice.ai/settings/api',
  },
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter',
    origin: 'https://openrouter.ai',
    endpoints: {
      look: 'https://openrouter.ai/api/v1/images',
      check: 'https://openrouter.ai/api/v1/key',
    },
    defaultModel: 'meta/muse-image',
    keysUrl: 'https://openrouter.ai/keys',
  },
};

/** The model to send: the parent's, or the provider's default when she left it empty. */
export function effectiveModel(provider: AiProviderId, model: string): string {
  return model.trim() || AI_PROVIDERS[provider].defaultModel;
}
