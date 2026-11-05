// @Gaffer — the AI match companion (HANDOFF §12).
import { corsHeaders, json } from '../_shared/cors.js';
import { adminClient, getCaller, rateLimit } from '../_shared/supabase.js';
import { loadPartyContext, isMember, buildMatchContext, aboutLabel } from '../_shared/matches.js';
import { callClaude, parseJson } from '../_shared/claude.js';

const SYSTEM = `You are Gaffer, the AI match companion inside Dream Watch, a watch-party app where friends watch football together and chat. Fans tag you in the group chat to ask what's happening on the pitch.

YOUR JOB
Explain match situations the way a knowledgeable friend in the group would: refereeing decisions (offside, handball, fouls, cards, penalties, VAR), tactics (substitutions, formation changes, game state), players and stats.

HOW TO ANSWER
- 2–4 short sentences, about 80 words maximum, unless asked for more. Plain language; explain jargon in a few words.
- Start by naming the moment you're answering about when the question refers to "that", "this" or "just now" (e.g. "Thuram's yellow at 87' was for…"). Use the ATTACHED EVENT if present; otherwise pick the most relevant event in RECENT DETAIL. If you can't tell which moment they mean, say which one you're assuming.
- Ground every factual claim in the MATCH DATA provided. Never invent events, minutes, players, statistics, quotes or referee statements.
- For refereeing questions, name the relevant IFAB Law of the Game (e.g. Law 11 – Offside; Law 12 – Fouls and Misconduct, which covers handball and cards; Law 14 – The Penalty Kick; Law 3 – The Players, for substitutions) and explain the specific criterion that applies.
- The data records WHAT happened, not always WHY. If the reason isn't in the data, say so plainly and give the most likely explanations under the Laws, clearly framed as likely rather than confirmed.
- For tactical questions, use formations, substitutions, the score and the time remaining to explain the likely intent.
- Stay neutral between teams. Light, friendly banter is fine; never insult players, fans or the asker.
- If the question isn't about this match or football, give a one-line friendly redirect.
- Never give betting or gambling advice or odds.

{MODE_RULES}

OUTPUT
Return ONLY a JSON object, no other text:
{"answer": "<your reply>", "about_event_id": "<id of the event you explained, or null>", "rule": "<e.g. 'Law 11 – Offside', or null>", "confidence": "data" | "likely" | "general"}
- "data": the answer is directly supported by the match data.
- "likely": the event is in the data but the reason is your best explanation.
- "general": a general rules/football explanation not tied to a specific recorded event.`;

const LIVE_RULES = `LIVE MATCH RULES (critical)
This match is being watched live. The current match time is {clock}. Behave as if nothing after this moment has happened yet. Do not reveal or hint at later goals, cards, substitutions, extra time, penalties, the final score or the winner, even if you remember this match from your training. If asked who will win or what happens next, give an honest, uncertain take based only on the data so far, or say you'll all find out together.`;

const REPLAY_RULES = `REPLAY RULES
This match has finished and the group is rewatching it together. You may discuss the whole match, including the result. The group is currently at {clock}; when a question is ambiguous, prefer the moments around that time.`;

const nullable = (schema) => ({ anyOf: [schema, { type: 'null' }] });
const SCHEMA = {
  type: 'object',
  properties: {
    answer: { type: 'string' },
    about_event_id: nullable({ type: 'string' }),
    rule: nullable({ type: 'string' }),
    confidence: { type: 'string', enum: ['data', 'likely', 'general'] },
  },
  required: ['answer', 'about_event_id', 'rule', 'confidence'],
  additionalProperties: false,
};

const NO_SPOILERS = "No spoilers from me — we'll find out together! Ask me about anything up to now.";
const FAILED = "I couldn't analyse that just now — ask me again in a moment.";

function surname(name) {
  return String(name).trim().split(/\s+/).slice(-1)[0].toLowerCase();
}

// Live mode only: does the answer reveal anything after `position`? (§12.4)
function spoils(answer, { events, position, config }) {
  const text = answer.toLowerCase();
  const future = events.filter((e) => e.video_time > position);
  const pastGoals = events.filter((e) => e.type === 'goal' && e.video_time <= position);

  for (const g of future.filter((e) => e.type === 'goal')) {
    const s = g.score_after;
    if (s) {
      const h = s[config.home];
      const a = s[config.away];
      for (const [x, y] of [[h, a], [a, h]]) {
        if (new RegExp(`\\b${x}\\s*[-–—]\\s*${y}\\b`).test(text)) return true;
      }
    }
    if (g.player) {
      const n = surname(g.player);
      const scoredAlready = pastGoals.some((p) => p.player === g.player);
      if (text.includes(n) && (/hat-?trick/.test(text) || (!scoredAlready && /\b(scores?|scored|goal)\b/.test(text)))) return true;
    }
  }
  const currentPeriod = Math.max(0, ...events.filter((e) => e.video_time <= position).map((e) => e.period));
  if (currentPeriod < 3 && /extra[- ]time (goal|winner|equali[sz]er)/.test(text)) return true;
  if (currentPeriod < 5 && /(penalty shoot-?out|shoot-?out|on penalties)/.test(text)) return true;
  if (/(won the world cup|wins the world cup|world champions|lifted the trophy|golden boot)/.test(text)) return true;
  return false;
}

async function insertReply(partyId, messageId, body, meta = {}) {
  const { error } = await adminClient.from('messages').insert({
    party_id: partyId, author_type: 'gaffer', body: body.slice(0, 1000), reply_to: messageId,
    meta: { reply_to: messageId, ...meta },
  });
  if (error) console.error('gaffer insert failed', error.message);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  let partyId;
  let messageId;
  try {
    const caller = await getCaller(req);
    if (!caller) return json({ error: 'unauthorized' }, 401);
    ({ party_id: partyId, message_id: messageId } = await req.json());
    if (!partyId || !messageId) return json({ error: 'party_id and message_id required' }, 400);

    const member = await isMember(partyId, caller.user.id);
    if (!member) return json({ error: 'not a member' }, 403);

    const ok = await rateLimit({ userId: caller.user.id, partyId, kind: 'gaffer', perUser: 6, perParty: 20 });
    if (!ok) return json({ error: 'rate_limited' }, 429);

    const { data: message } = await adminClient.from('messages').select('*').eq('id', messageId).eq('party_id', partyId).single();
    if (!message || message.user_id !== caller.user.id) return json({ error: 'message not found' }, 404);

    const ctx = await loadPartyContext(partyId);
    const { match, events, position } = ctx;
    const live = match.mode === 'live';
    const built = buildMatchContext(ctx);

    // Attached event — refuse to describe a future event in live mode.
    let attached = message.event_id ? events.find((e) => e.id === message.event_id) : null;
    if (attached && live && attached.video_time > position) attached = null;

    const { data: recent } = await adminClient.from('messages')
      .select('author_type, user_id, body, flagged, created_at')
      .eq('party_id', partyId).neq('author_type', 'system').eq('flagged', false)
      .order('created_at', { ascending: false }).limit(9);
    const ids = [...new Set((recent ?? []).map((m) => m.user_id).filter(Boolean))];
    const { data: profiles } = ids.length
      ? await adminClient.from('profiles').select('id, display_name').in('id', ids)
      : { data: [] };
    const nameOf = (id) => profiles?.find((p) => p.id === id)?.display_name ?? 'Someone';
    const chat = (recent ?? []).reverse().slice(-8)
      .map((m) => `${m.author_type === 'gaffer' ? 'Gaffer' : nameOf(m.user_id)}: ${m.body}`).join('\n');

    const asker = nameOf(caller.user.id) === 'Someone'
      ? (await adminClient.from('profiles').select('display_name').eq('id', caller.user.id).single()).data?.display_name
      : nameOf(caller.user.id);
    const question = message.body.replace(/@gaffer\b/gi, '').trim() || 'Explain this.';

    const user = [
      built.text,
      attached ? `ATTACHED EVENT (the user is asking about this):\n${JSON.stringify(attached)}` : null,
      `RECENT CHAT (oldest→newest):\n${chat || 'none'}`,
      `ASKER: ${asker}${member.team_supported ? ` (supports ${member.team_supported})` : ''}`,
      `QUESTION: ${question}`,
    ].filter(Boolean).join('\n\n');

    const baseSystem = SYSTEM.replace('{MODE_RULES}', (live ? LIVE_RULES : REPLAY_RULES).replaceAll('{clock}', built.clock));

    async function ask(extra) {
      const raw = await callClaude({ system: extra ? `${baseSystem}\n\n${extra}` : baseSystem, user, schema: SCHEMA });
      try {
        const out = parseJson(raw);
        return { answer: String(out.answer ?? '').trim(), about_event_id: out.about_event_id ?? null, rule: out.rule ?? null, confidence: out.confidence ?? 'general' };
      } catch {
        return { answer: raw.trim(), about_event_id: null, rule: null, confidence: 'general' };
      }
    }

    let out = await ask();
    if (live && spoils(out.answer, { events, position, config: match.config })) {
      console.error(`spoiler blocked (party ${partyId}, clock ${built.clock})`);
      out = await ask(`Your previous answer revealed events after ${built.clock}. Answer again using only events up to ${built.clock}.`);
      if (spoils(out.answer, { events, position, config: match.config })) {
        console.error(`spoiler blocked twice (party ${partyId})`);
        out = { answer: NO_SPOILERS, about_event_id: null, rule: null, confidence: 'general' };
      }
    }

    const aboutEvent = events.find((e) => e.id === (out.about_event_id ?? attached?.id))
      ?? attached;
    const safeAbout = aboutEvent && (!live || aboutEvent.video_time <= position) ? aboutEvent : null;

    await insertReply(partyId, messageId, out.answer || FAILED, {
      about_event_id: safeAbout?.id ?? null,
      about_label: aboutLabel(safeAbout),
      rule: out.rule,
      confidence: out.confidence,
    });
    return json({ ok: true });
  } catch (err) {
    console.error('gaffer error', err?.message ?? err);
    if (partyId && messageId) await insertReply(partyId, messageId, FAILED, { error: true });
    return json({ error: 'failed' }, 500);
  }
});
