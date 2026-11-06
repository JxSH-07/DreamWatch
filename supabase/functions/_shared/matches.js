import { adminClient } from './supabase.js';
import { normalizeEvents, setLiveEpoch, videoToMatchClock, scoreAt } from './matchTime.js';
import { partyPosition } from './playback.js';

setLiveEpoch(Deno.env.get('LIVE_EPOCH'));

// Loads the party, its match and all events, and computes the authoritative
// position server-side (never trust a position sent by the client).
export async function loadPartyContext(partyId) {
  const { data: party, error } = await adminClient.from('parties').select('*').eq('id', partyId).single();
  if (error || !party) throw new Error('party not found');
  const { data: match } = await adminClient.from('matches').select('*').eq('id', party.match_id).single();
  const { data: rawEvents } = await adminClient.from('match_events').select('*').eq('match_id', match.id);
  const events = normalizeEvents(match.config, rawEvents ?? []);
  const now = Date.now() / 1000;
  const position = party.status === 'live' ? partyPosition(party, match, now) : Number(party.anchor_position ?? match.config.period_starts['1']);
  return { party, match, events, position };
}

export async function isMember(partyId, userId) {
  const { data } = await adminClient.from('party_members').select('status, role').eq('party_id', partyId).eq('user_id', userId).maybeSingle();
  return data && data.status !== 'removed' ? data : null;
}

function evLine(e) {
  return `${e.clock ?? ''} — ${e.description}`;
}

function detailLine(e) {
  const d = e.data ?? {};
  const extras = ['zone', 'victim', 'xg', 'shot_type', 'outcome', 'card', 'reason', 'body_part', 'outcome_detail']
    .filter((k) => d[k] != null)
    .map((k) => `${k}: ${typeof d[k] === 'object' ? JSON.stringify(d[k]) : d[k]}`);
  return `${evLine(e)}${extras.length ? ` (${extras.join(', ')})` : ''}`;
}

function lineupBlock(config, events, position) {
  const lines = [];
  for (const team of [config.home, config.away]) {
    const lu = config.lineups?.[team];
    if (!lu) continue;
    const shift = [...events].reverse().find((e) => e.type === 'tactical_shift' && e.team === team && e.video_time <= position);
    const current = shift?.data?.formation ? ` (current shape: ${shift.data.formation})` : '';
    lines.push(`${team} ${lu.formation}${current}${lu.manager ? `, manager ${lu.manager}` : ''}: ${lu.starting_xi.join(', ')}${lu.notes ? `. Note: ${lu.notes}` : ''}`);
  }
  return lines.join('\n');
}

// Compact text context for Claude (HANDOFF §12.2). In live mode nothing after
// `position` is included. `forPoll` restricts replay mode the same way.
export function buildMatchContext({ match, events, position, forPoll = false }) {
  const config = match.config;
  const live = match.mode === 'live' || forPoll;
  const mc = videoToMatchClock(config, position);
  const score = scoreAt(config, events, position);
  const seen = events.filter((e) => e.video_time <= position);
  const key = live ? seen.filter((e) => e.importance === 'key') : events.filter((e) => e.importance === 'key');
  const window = 240;
  const detail = events.filter((e) => e.importance === 'detail'
    && e.video_time <= position + (live ? 0 : window) && e.video_time > position - window);

  const subs = seen.filter((e) => e.type === 'substitution').map(evLine);
  const cards = seen.filter((e) => e.type === 'card').map(evLine);
  const shootout = score.shootout ? ` (shootout ${score.shootout.home}–${score.shootout.away})` : '';

  const parts = [
    `MATCH: ${config.home} vs ${config.away} — ${config.competition} (${match.mode === 'live' ? 'LIVE' : 'REPLAY of a finished match'})`,
    `CURRENT MATCH TIME: ${mc.clock} (${mc.periodLabel})        SCORE: ${config.home} ${score.home}–${score.away} ${config.away}${shootout}`,
    `LINEUPS & SHAPE:\n${lineupBlock(config, events, position)}`,
    `SUBSTITUTIONS SO FAR: ${subs.length ? subs.join('; ') : 'none'}`,
    `CARDS SO FAR: ${cards.length ? cards.join('; ') : 'none'}`,
    `KEY EVENTS${live ? ' SO FAR' : ''}:\n${key.length ? key.map((e) => `${live ? '' : e.video_time <= position ? '[already seen] ' : '[later in the match] '}${e.id}: ${evLine(e)}`).join('\n') : 'none yet'}`,
    `RECENT DETAIL (${live ? 'last 4 minutes' : 'within 4 minutes of now'}):\n${detail.length ? detail.map((e) => `${e.id}: ${detailLine(e)}`).join('\n') : 'none'}`,
  ];
  if (!live && config.full_time_stats) {
    parts.push(`FULL-TIME STATS (${config.home} – ${config.away}): ${Object.entries(config.full_time_stats).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  }
  return { text: parts.join('\n\n'), clock: mc.clock, score, mc };
}

export function aboutLabel(e) {
  if (!e) return null;
  const who = e.player ? e.player.split(' ').slice(-1)[0] : e.team ?? '';
  const type = {
    goal: 'Goal', shot: 'Shot', card: /red/i.test(JSON.stringify(e.data ?? {}) + e.description) ? 'Red card' : 'Yellow card',
    foul: 'Foul', handball: 'Handball', penalty_awarded: 'Penalty', penalty_missed: 'Penalty miss', offside: 'Offside', substitution: 'Substitution',
    tactical_shift: 'Tactical change', injury: 'Injury', shootout_kick: 'Shootout kick', var_decision: 'VAR decision',
  }[e.type] ?? e.type;
  return `${e.clock ?? ''} ${who} ${type.toLowerCase()}`.replace(/\s+/g, ' ').trim();
}
