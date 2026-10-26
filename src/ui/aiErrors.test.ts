// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { AiError, type AiErrorReason } from '../ai/providers';
import { aiErrorDetail, aiErrorText } from './aiErrors';

const REASONS: AiErrorReason[] = [
  'unauthorized',
  'no-credit',
  'rate-limited',
  'bad-request',
  'provider-down',
  'refused',
  'network',
  'timeout',
  'cancelled',
  'bad-response',
  'bad-photo',
];

describe('aiErrorText', () => {
  it('has its own Hebrew explanation for every reason', () => {
    const texts = REASONS.map((r) => aiErrorText(new AiError(r)));
    expect(new Set(texts).size).toBe(REASONS.length);
    for (const t of texts) expect(t).toMatch(/[֐-׿]/);
  });

  it('has a fallback for anything else, and gives the provider detail only for AiErrors', () => {
    expect(aiErrorText(new Error('x'))).toBe('משהו השתבש. כדאי לנסות שוב.');
    expect(aiErrorDetail(new AiError('bad-request', '400 Invalid modelId'))).toBe('400 Invalid modelId');
    expect(aiErrorDetail(new Error('x'))).toBe('');
  });
});
