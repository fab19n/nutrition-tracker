/*
 * supabase-js loads on first use, through src/auth/supabase.ts only (ARCHITECTURE.md §6.2). Sync
 * and the capture layer may import its types, never a value: a value import (an inline `type`
 * specifier included, which still loads the module) would pull it into the app's first load.
 * db.test.ts and index.test.ts check the same at runtime; this reads the source.
 */
const sources = import.meta.glob<string>(['./**/*.ts', '!./**/*.test.ts', '../db/capture.ts', '../db/syncTypes.ts'], {
  query: '?raw',
  import: 'default',
  eager: true,
});

/** Any import or re-export from @supabase/* that isn't `import type` / `export type`, or a dynamic import of it. */
const VALUE_IMPORT = /(^|\n)\s*(import|export)\s+(?!type\b)[^;]*?\bfrom\s*['"]@supabase\/|\bimport\s*\(\s*['"]@supabase\//;

describe('lazy supabase-js', () => {
  it('reads the sync sources', () => {
    const names = Object.keys(sources);
    expect(names).toEqual(expect.arrayContaining(['./engine.ts', './remote.ts', './testing/fakeServer.ts', '../db/capture.ts', '../db/syncTypes.ts']));
    expect(names.some((name) => name.endsWith('.test.ts'))).toBe(false);
  });

  it('finds a value import when there is one', () => {
    expect(VALUE_IMPORT.test("import { createClient } from '@supabase/supabase-js';")).toBe(true);
    expect(VALUE_IMPORT.test("import {\n  type SupabaseClient,\n} from '@supabase/supabase-js';")).toBe(true);
    expect(VALUE_IMPORT.test("const m = await import('@supabase/supabase-js');")).toBe(true);
    expect(VALUE_IMPORT.test("import type { SupabaseClient } from '@supabase/supabase-js';")).toBe(false);
  });

  it.each(Object.entries(sources))('%s imports only types from @supabase', (_name, source) => {
    expect(VALUE_IMPORT.test(source)).toBe(false);
  });
});
