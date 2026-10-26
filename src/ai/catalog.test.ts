// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { AI_PROVIDER_IDS } from '../core/model';
import { AI_PROVIDERS, effectiveModel } from './catalog';
import { DEFAULT_PROMPT, effectivePrompt } from './prompt';

describe('AI provider catalog', () => {
  it('describes every provider the closet can name', () => {
    expect(Object.keys(AI_PROVIDERS).sort()).toEqual([...AI_PROVIDER_IDS].sort());
    for (const id of AI_PROVIDER_IDS) {
      expect(AI_PROVIDERS[id].id).toBe(id);
      expect(AI_PROVIDERS[id].origin).toMatch(/^https:\/\/[a-z0-9.-]+$/);
      expect(AI_PROVIDERS[id].keysUrl).toMatch(/^https:\/\//);
    }
  });

  it("uses the parent's model, or the provider's default when it is empty", () => {
    expect(effectiveModel('venice', '  my-model ')).toBe('my-model');
    expect(effectiveModel('venice', '  ')).toBe(AI_PROVIDERS.venice.defaultModel);
  });

  it("uses the parent's prompt, or the built-in one", () => {
    expect(effectivePrompt(null)).toBe(DEFAULT_PROMPT);
    expect(effectivePrompt('   ')).toBe(DEFAULT_PROMPT);
    expect(effectivePrompt('Dress the doll.')).toBe('Dress the doll.');
    expect(DEFAULT_PROMPT).toMatch(/image 1.*image 2.*image 3/);
  });
});
