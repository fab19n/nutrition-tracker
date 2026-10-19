// Generates supabase/functions/estimate/catalogue.json from src/data/catalogue.ts.
// The Edge Function bundles this JSON so its cached system prompt matches the app's catalogue.
// Run: npm run build:estimate-catalogue
import { writeFile } from 'node:fs/promises';
import { createServer } from 'vite';

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
try {
  const { CATALOGUE } = await server.ssrLoadModule('/src/data/catalogue.ts');
  const compact = CATALOGUE.map((c) => ({
    id: c.id,
    name: c.name,
    aliases: c.aliases,
    category: c.category,
    unit: c.unit,
    variants: c.variants,
    defaultVariant: c.defaultVariant,
    uncertainty: c.uncertainty,
    ...(c.question ? { question: c.question } : {}),
  }));
  const out = new URL('../supabase/functions/estimate/catalogue.json', import.meta.url);
  await writeFile(out, JSON.stringify(compact, null, 1) + '\n');
  console.log(`Wrote ${compact.length} catalogue entries to supabase/functions/estimate/catalogue.json`);
} finally {
  await server.close();
}
