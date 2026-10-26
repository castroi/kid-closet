// @vitest-environment node
import { describe, expect, it } from 'vitest';
import indexHtml from '../../index.html?raw';
import vercel from '../../vercel.json';
import { AI_PROVIDERS } from '../ai/catalog';

const siteHeaders = vercel.headers.find((rule) => rule.source === '/(.*)')?.headers ?? [];
const header = (key: string) => siteHeaders.find((h) => h.key === key)?.value;

async function sha256Base64(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return btoa(String.fromCharCode(...new Uint8Array(digest)));
}

describe('security headers (vercel.json)', () => {
  it('allows the inline theme script by its exact hash', async () => {
    // Editing the script in index.html changes its hash; the CSP must be updated with it,
    // or the browser blocks the script and the wrong theme flashes on start.
    const inline = [...indexHtml.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    expect(inline).toHaveLength(1);
    const csp = header('Content-Security-Policy') ?? '';
    expect(csp).toContain(`'sha256-${await sha256Base64(inline[0])}'`);
  });

  it('locks the page down to its own origin', () => {
    const csp = header('Content-Security-Policy') ?? '';
    for (const directive of ["default-src 'self'", "object-src 'none'", "base-uri 'none'", "frame-ancestors 'none'"]) {
      expect(csp).toContain(directive);
    }
    expect(csp).not.toContain('unsafe-inline');
    expect(csp).not.toMatch(/'unsafe-eval'/);
  });

  it('lets the page call only its own origin and the AI providers the parent can pick', () => {
    // Photos may leave the phone only to these addresses (docs/ai-doll-look.md); anything else stays blocked.
    const csp = header('Content-Security-Policy') ?? '';
    const connect = csp
      .split(';')
      .map((d) => d.trim())
      .find((d) => d.startsWith('connect-src '));
    const sources = connect?.split(/\s+/).slice(1) ?? [];
    const providers = Object.values(AI_PROVIDERS).map((p) => p.origin);
    expect(sources.sort()).toEqual(["'self'", ...providers].sort());
    for (const origin of providers) expect(origin).toMatch(/^https:\/\/[a-z0-9.-]+$/);
  });

  it('sends the other protective headers on every page', () => {
    expect(header('X-Content-Type-Options')).toBe('nosniff');
    expect(header('Referrer-Policy')).toBe('no-referrer');
    expect(header('X-Frame-Options')).toBe('DENY');
    expect(header('Permissions-Policy')).toContain('geolocation=()');
    expect(header('Strict-Transport-Security')).toMatch(/max-age=\d+/);
  });
});
