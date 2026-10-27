// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { parseAttributesAnswer } from '../core/attributes';
import { sampleAttributes } from '../test/data';
import { ATTRIBUTES_PROMPT, ATTRIBUTES_PROMPT_VERSION, ATTRIBUTES_SCHEMA } from './attributesPrompt';

type Property = { type: string | string[]; enum?: (string | null)[]; items?: Property };
const properties = ATTRIBUTES_SCHEMA.properties as Record<string, Property>;

describe('attributes prompt and schema', () => {
  it('describes exactly the stored attributes plus valid_image', () => {
    expect(Object.keys(properties).sort()).toEqual(['valid_image', ...Object.keys(sampleAttributes())].sort());
  });

  it('is strict the way Venice requires: every field required, nothing extra', () => {
    expect(ATTRIBUTES_SCHEMA.required).toEqual(Object.keys(properties));
    expect(ATTRIBUTES_SCHEMA.additionalProperties).toBe(false);
  });

  it('lists null in the enum of every nullable enum', () => {
    for (const [name, p] of Object.entries(properties)) {
      if (p.enum && Array.isArray(p.type)) expect(p.enum, name).toContain(null);
      if (p.enum && !Array.isArray(p.type)) expect(p.enum, name).not.toContain(null);
    }
  });

  it('names every field and every allowed value in the prompt', () => {
    for (const [name, p] of Object.entries(properties)) {
      expect(ATTRIBUTES_PROMPT, name).toContain(`"${name}"`);
      for (const value of [...(p.enum ?? []), ...(p.items?.enum ?? [])]) {
        if (value !== null) expect(ATTRIBUTES_PROMPT, `${name}: ${value}`).toContain(`"${value}"`);
      }
    }
  });

  it('asks for the photo only, never for anything about the person or a parent note', () => {
    expect(ATTRIBUTES_PROMPT).toContain('Never describe a person');
    expect(ATTRIBUTES_PROMPT).not.toMatch(/parent/i);
    expect(ATTRIBUTES_PROMPT_VERSION).toBe(1);
  });

  it('accepts an answer shaped like the prompt asks', () => {
    expect(parseAttributesAnswer(JSON.stringify({ valid_image: true, ...sampleAttributes() })).result).toBe('ok');
  });
});
