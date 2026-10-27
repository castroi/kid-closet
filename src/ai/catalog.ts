import type { AiProviderId } from '../core/model';

export interface AiProviderInfo {
  id: AiProviderId;
  label: string;
  origin: string;
  /**
   * The only URLs the app calls for this provider: making a look, checking the key, and
   * describing a garment photo (docs/ai-item-attributes.md). Exactly these are in the CSP's
   * connect-src (vercel.json); securityHeaders.test.ts checks it.
   */
  endpoints: { look: string; check: string; analyze: string };
  /** Used when the parent leaves the model empty. Unconfirmed until the first real look (docs/ai-doll-look.md §3). */
  defaultModel: string;
  /**
   * The vision chat model that describes garment photos when the parent leaves its field empty:
   * DeepSeek V4.1 Flash. Unconfirmed until "בדיקת זיהוי" on her iPhone (docs/ai-item-attributes.md §3).
   */
  defaultAnalysisModel: string;
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
      analyze: 'https://api.venice.ai/api/v1/chat/completions',
    },
    defaultModel: 'muse-image-edit',
    defaultAnalysisModel: 'deepseek-v4-1-flash',
    keysUrl: 'https://venice.ai/settings/api',
  },
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter',
    origin: 'https://openrouter.ai',
    endpoints: {
      look: 'https://openrouter.ai/api/v1/images',
      check: 'https://openrouter.ai/api/v1/key',
      analyze: 'https://openrouter.ai/api/v1/chat/completions',
    },
    defaultModel: 'meta/muse-image',
    defaultAnalysisModel: 'deepseek/deepseek-v4.1-flash',
    keysUrl: 'https://openrouter.ai/keys',
  },
};

/** The model to send: the parent's, or the provider's default when she left it empty. */
export function effectiveModel(provider: AiProviderId, model: string): string {
  return model.trim() || AI_PROVIDERS[provider].defaultModel;
}

/** The analysis model to send: the parent's, or the provider's default analysis model. */
export function effectiveAnalysisModel(provider: AiProviderId, model: string): string {
  return model.trim() || AI_PROVIDERS[provider].defaultAnalysisModel;
}

/** Every URL the app may call, for the CSP check. */
export function allEndpoints(): string[] {
  return Object.values(AI_PROVIDERS).flatMap((p) => [p.endpoints.look, p.endpoints.check, p.endpoints.analyze]);
}
