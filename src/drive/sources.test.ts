/*
 * Google stays behind src/drive (decision §10.18): one module loads the GIS script and touches
 * `window.google` (./gis.ts, with its address in ./config.ts), one builds googleapis.com URLs
 * (./api.ts, with the host in ./config.ts), and only the app's engine (./index.ts) builds the
 * token source. This reads the source, like src/sync/lazyImport.test.ts.
 */
const sources = import.meta.glob<string>(['../**/*.{ts,tsx}', '!../**/*.test.{ts,tsx}', '!../**/*.d.ts'], {
  query: '?raw',
  import: 'default',
  eager: true,
});

/** 'src/drive/gis.ts' for '../drive/gis.ts' (or './gis.ts'). */
function pathOf(key: string): string {
  if (key.startsWith('../')) return `src/${key.slice(3)}`;
  if (key.startsWith('./')) return `src/drive/${key.slice(2)}`;
  return key;
}

const files = Object.entries(sources).map(([key, source]) => ({ path: pathOf(key), source }));

function containing(pattern: RegExp): string[] {
  return files.filter((f) => pattern.test(f.source)).map((f) => f.path).sort();
}

describe('Google stays behind src/drive', () => {
  it('reads the app sources, and no tests', () => {
    const paths = files.map((f) => f.path);
    expect(paths).toEqual(expect.arrayContaining(['src/drive/gis.ts', 'src/drive/api.ts', 'src/drive/config.ts', 'src/app/App.tsx', 'src/db/db.ts']));
    expect(paths.some((p) => /\.test\.tsx?$/.test(p))).toBe(false);
  });

  it('only the token module and its config name accounts.google.com', () => {
    expect(containing(/accounts\.google\.com/)).toEqual(['src/drive/config.ts']);
    expect(containing(/window\.google|globalThis\.google/).every((p) => p === 'src/drive/gis.ts')).toBe(true);
    expect(containing(/\.google\?*\.accounts/)).toEqual(['src/drive/gis.ts']);
  });

  it('only Drive REST and its config name googleapis.com', () => {
    expect(containing(/googleapis\.com/).filter((p) => p !== 'src/drive/api.ts' && p !== 'src/drive/config.ts')).toEqual([]);
    expect(containing(/googleapis\.com/)).toContain('src/drive/config.ts');
    expect(containing(/new URL\(path, DRIVE_API\)/)).toEqual(['src/drive/api.ts']);
  });

  it('only the app engine imports the token source', () => {
    expect(containing(/from\s+['"]@\/drive\/gis['"]/)).toEqual([]);
    expect(containing(/createGisTokenSource\(/)).toEqual(['src/drive/gis.ts', 'src/drive/index.ts']);
    // Outside src/drive, the GIS module is never imported, not even for its types.
    const outside = files.filter((f) => !f.path.startsWith('src/drive/') && /from\s+['"][^'"]*drive\/gis['"]/.test(f.source));
    expect(outside.map((f) => f.path)).toEqual([]);
  });
});
