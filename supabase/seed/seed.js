// Loads match data only (no users). Idempotent. Run from the repo root:
//   node supabase/seed/seed.js
// Needs SUPABASE_URL and a server key in supabase/seed/.env: either
// SUPABASE_SECRET_KEY (sb_secret_…) or the legacy SUPABASE_SERVICE_ROLE_KEY.
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import dotenv from 'dotenv';
import { eventVideoTime } from '../../src/lib/matchTime.js';

dotenv.config({ path: 'supabase/seed/.env' });
const { SUPABASE_URL } = process.env;
const serverKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !serverKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY) in supabase/seed/.env');
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, serverKey, { auth: { persistSession: false } });
const matches = JSON.parse(fs.readFileSync('data/matches.json', 'utf8'));

function check(error, what) {
  if (error) {
    console.error(`${what} failed:`, error.message);
    process.exit(1);
  }
}

for (const [i, m] of matches.entries()) {
  const eventsPath = `data/${m.events_file}`;
  if (!fs.existsSync(eventsPath)) {
    console.error(`Missing ${eventsPath} — add the event file for ${m.id} and re-run.`);
    process.exit(1);
  }

  const { error: upErr } = await admin.from('matches').upsert({
    id: m.id, mode: m.mode, title: m.title, competition: m.competition,
    youtube_id: m.youtube_id, config: m, sort_order: i,
  });
  check(upErr, `upsert match ${m.id}`);

  const events = JSON.parse(fs.readFileSync(eventsPath, 'utf8'));
  const { error: delErr } = await admin.from('match_events').delete().eq('match_id', m.id);
  check(delErr, `clear events for ${m.id}`);

  // Store the runtime-computed video time so resolve_poll() agrees with the client.
  const rows = events.map((e) => ({
    id: e.id, match_id: m.id, period: e.period, elapsed_in_period_s: e.elapsed_in_period_s ?? null,
    video_time: eventVideoTime(m, e), clock: e.clock, type: e.type, importance: e.importance, team: e.team ?? null,
    player: e.player ?? null, description: e.description, score_after: e.score_after ?? null, data: e.data ?? {},
    approximate: !!e.approximate,
  }));
  for (let j = 0; j < rows.length; j += 200) {
    const { error } = await admin.from('match_events').insert(rows.slice(j, j + 200));
    check(error, `insert events for ${m.id}`);
  }
  console.log(`${m.id}: ${rows.length} events`);
}
