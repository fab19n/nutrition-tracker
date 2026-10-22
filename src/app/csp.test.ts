// @vitest-environment node
/*
 * The deployed Content-Security-Policy (vercel.json): strict, plus exactly what Google's token
 * window and Drive's API need for meal photos (decision §10.18). The tests run from the repo root.
 */
import { readFileSync } from 'node:fs';

interface Header {
  key: string;
  value: string;
}

const config = JSON.parse(readFileSync('vercel.json', 'utf8')) as { headers: { source: string; headers: Header[] }[] };
const allHeaders = config.headers.flatMap((h) => h.headers);
const csp = allHeaders.find((h) => h.key === 'Content-Security-Policy')?.value ?? '';

/** The policy as directive → sources. */
function directives(policy: string): Record<string, string[]> {
  return Object.fromEntries(
    policy
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const [name = '', ...sources] = part.split(/\s+/);
        return [name, sources];
      }),
  );
}

describe('Content-Security-Policy', () => {
  const policy = directives(csp);

  it('is exactly the strict policy plus Google sign-in and Drive', () => {
    expect(policy).toEqual({
      'default-src': ["'self'"],
      'script-src': ["'self'", 'https://accounts.google.com/gsi/client'],
      'style-src': ["'self'"],
      'img-src': ["'self'", 'blob:', 'data:'],
      'font-src': ["'self'", 'data:'],
      'connect-src': ["'self'", 'https://*.supabase.co', 'wss://*.supabase.co', 'https://accounts.google.com/gsi/', 'https://www.googleapis.com'],
      'frame-src': ['https://accounts.google.com/gsi/'],
      'worker-src': ["'self'"],
      'manifest-src': ["'self'"],
      'media-src': ["'self'", 'blob:'],
      'object-src': ["'none'"],
      'base-uri': ["'self'"],
      'form-action': ["'self'"],
      'frame-ancestors': ["'none'"],
    });
  });

  it('allows Google only where the token window and Drive need it', () => {
    expect(policy['script-src']?.filter((s) => s.includes('google'))).toEqual(['https://accounts.google.com/gsi/client']);
    expect(policy['frame-src']).toEqual(['https://accounts.google.com/gsi/']);
    expect(policy['style-src']).toEqual(["'self'"]);
    expect(csp).not.toContain("'unsafe-inline'");
    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp).not.toContain('*.google.com');
    expect(csp).not.toContain('*.googleapis.com');
  });

  it('never cuts the popup off from the app', () => {
    expect(allHeaders.some((h) => h.key.toLowerCase() === 'cross-origin-opener-policy')).toBe(false);
  });
});
