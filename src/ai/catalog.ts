import type { AiProviderId } from '../core/model';

export interface AiProviderInfo {
  id: AiProviderId;
  label: string;
  /** The only address the app may call for this provider; it must also be in the CSP's connect-src (vercel.json). */
  origin: string;
  /** Used when the parent leaves the model empty. Checked against the provider in PR 3 (docs/ai-doll-look.md). */
  defaultModel: string;
  /** Where the parent creates an API key. */
  keysUrl: string;
}

/**
 * Providers the app can send a look to. Adding one = an entry here, its adapter (PR 3),
 * its origin in vercel.json's connect-src, and their tests.
 */
export const AI_PROVIDERS: Record<AiProviderId, AiProviderInfo> = {
  venice: {
    id: 'venice',
    label: 'Venice',
    origin: 'https://api.venice.ai',
    defaultModel: 'muse-image-edit',
    keysUrl: 'https://venice.ai/settings/api',
  },
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter',
    origin: 'https://openrouter.ai',
    defaultModel: 'meta/muse-image',
    keysUrl: 'https://openrouter.ai/keys',
  },
};

/** The model to send: the parent's, or the provider's default when she left it empty. */
export function effectiveModel(provider: AiProviderId, model: string): string {
  return model.trim() || AI_PROVIDERS[provider].defaultModel;
}
