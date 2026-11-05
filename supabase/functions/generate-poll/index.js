// AI prediction polls (HANDOFF §13.1). Claude picks the question; options and
// timing are built here so resolution stays deterministic.
import { corsHeaders, json } from '../_shared/cors.js';
import { adminClient, getCaller, rateLimit } from '../_shared/supabase.js';
import { loadPartyContext, isMember, buildMatchContext } from '../_shared/matches.js';
import { callModel, parseJson } from '../_shared/llm.js';
import { periods } from '../_shared/matchTime.js';

const KINDS = ['goal_in_window', 'card_in_window', 'next_goal_team', 'next_card_team', 'player_scores_in_window', 'shootout_kick_scored'];

const INSTRUCTION = `Create ONE fun prediction poll for friends watching this match right now. Choose exactly one kind:
- goal_in_window: "Will there be a goal in the next N minutes?" (options yes/no)
- card_in_window: "Will anyone be booked in the next N minutes?" (yes/no)
- next_goal_team: "Who scores next (within N minutes)?" (home team / away team / none)
- next_card_team: "Which team gets the next card (within N minutes)?" (home / away / none)
- player_scores_in_window: "Will <player currently on the pitch> score in the next N minutes?" (yes/no)
- shootout_kick_scored: only during a penalty shootout: "Will the next penalty go in?" (yes/no)
N must be between 5 and 15 and must not run past the end of the current period.
Make the question specific and lively, referencing the current situation (score, momentum, recent events). No betting language.
Return ONLY JSON: {"kind": "...", "question": "...", "window_minutes": 10, "player": "<name or null>"}`;

const SCHEMA = {
  type: 'object',
  properties: {
    kind: { type: 'string', enum: KINDS },
    question: { type: 'string' },
    window_minutes: { type: 'integer' },
    player: { anyOf: [{ type: 'string' }, { type: 'null' }] },
  },
  required: ['kind', 'question', 'window_minutes', 'player'],
  additionalProperties: false,
};

// The period the poll window belongs to: the one in play, or the next one during a break.
function currentPeriod(config, position) {
  for (const p of periods(config)) {
    if (position <= config.period_ends[String(p)]) return p;
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const caller = await getCaller(req);
    if (!caller) return json({ error: 'unauthorized' }, 401);
    const { party_id: partyId } = await req.json();
    if (!partyId) return json({ error: 'party_id required' }, 400);

    const member = await isMember(partyId, caller.user.id);
    if (!member) return json({ error: 'not a member' }, 403);

    const ctx = await loadPartyContext(partyId);
    const { party, match, position } = ctx;
    const isHost = party.host_id === caller.user.id;
    if (!isHost && !party.settings?.guests_can_poll) return json({ error: 'host only' }, 403);
    if (party.status !== 'live') return json({ error: 'party not live' }, 400);

    const { count: openCount } = await adminClient.from('polls').select('id', { count: 'exact', head: true })
      .eq('party_id', partyId).eq('status', 'open');
    if ((openCount ?? 0) > 0) return json({ error: 'poll_open' }, 409);

    const ok = await rateLimit({ userId: caller.user.id, partyId, kind: 'poll', perParty: 1 });
    if (!ok) return json({ error: 'rate_limited' }, 429);

    const config = match.config;
    const period = currentPeriod(config, position);
    if (period == null) return json({ error: 'match_over' }, 400);
    const periodEnd = config.period_ends[String(period)];

    const built = buildMatchContext({ ...ctx, forPoll: true });
    const raw = await callModel({ system: 'You write prediction polls for a football watch-party app.', user: `${built.text}\n\n${INSTRUCTION}`, schema: SCHEMA, maxTokens: 1500 });
    let out;
    try { out = parseJson(raw); } catch { return json({ error: 'bad_model_output' }, 502); }

    let kind = KINDS.includes(out.kind) ? out.kind : 'goal_in_window';
    let question = String(out.question ?? '').trim().slice(0, 200);
    if (kind === 'shootout_kick_scored' && period !== 5) kind = 'goal_in_window';
    if (kind === 'player_scores_in_window' && !out.player) kind = 'goal_in_window';
    if (period === 5 && kind !== 'shootout_kick_scored') {
      kind = 'shootout_kick_scored';
      question = 'Will the next penalty go in?';
    }
    const minutes = Math.min(15, Math.max(5, Math.round(Number(out.window_minutes) || 10)));
    if (!question) question = 'Will there be a goal in the next ' + minutes + ' minutes?';

    const { home, away } = config;
    const options = kind === 'next_goal_team' || kind === 'next_card_team'
      ? [{ id: home, label: home }, { id: away, label: away }, { id: 'none', label: kind === 'next_goal_team' ? 'No goal' : 'No card' }]
      : [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }];

    const opens = Math.max(position, config.period_starts[String(period)]);
    const closes = kind === 'shootout_kick_scored' ? opens + 75 : Math.min(opens + minutes * 60, periodEnd);

    const { data: poll, error } = await adminClient.from('polls').insert({
      party_id: partyId, created_by: isHost ? 'gaffer' : caller.user.id, question, options,
      resolve_rule: { kind, player: kind === 'player_scores_in_window' ? out.player : null },
      opens_at_video_time: opens, votes_close_at_video_time: Math.min(opens + 90, closes), closes_at_video_time: closes,
    }).select().single();
    if (error) throw error;

    await adminClient.from('messages').insert({
      party_id: partyId, author_type: 'gaffer', body: `New poll: ${question} Vote in the Polls tab.`,
      meta: { poll_id: poll.id, kind: 'poll' },
    });
    return json({ ok: true, poll_id: poll.id });
  } catch (err) {
    console.error('generate-poll error', err?.message ?? err);
    return json({ error: 'failed' }, 500);
  }
});
