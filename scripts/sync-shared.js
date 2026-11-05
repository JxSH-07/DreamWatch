// Copies the shared time/playback helpers into the Edge Functions bundle so the
// server computes party positions with exactly the same code as the browser.
import fs from 'node:fs';

const files = ['matchTime.js', 'playback.js'];
for (const f of files) {
  const src = fs.readFileSync(`src/lib/${f}`, 'utf8');
  fs.writeFileSync(`supabase/functions/_shared/${f}`, `// GENERATED from src/lib/${f} by \`npm run sync-shared\`. Do not edit.\n${src}`);
  console.log(`synced ${f}`);
}
