// AI chat moderation (HANDOFF §15.2). Runs just after posting; flags only clear abuse.
import { corsHeaders, json } from '../_shared/cors.js';
import { adminClient, getCaller, rateLimit } from '../_shared/supabase.js';
import { callClaude, parseJson } from '../_shared/claude.js';

const REASONS = ['harassment', 'hate', 'threat', 'sexual', 'personal_info', 'spam'];
const SCHEMA = {
  type: 'object',
  properties: {
    flag: { type: 'boolean' },
    reason: { anyOf: [{ type: 'string', enum: REASONS }, { type: 'null' }] },
  },
  required: ['flag', 'reason'],
  additionalProperties: false,
};

const prompt = (body) => `You moderate a friendly football watch-party chat. Banter, rivalry, frustration at players or referees, and mild swearing about the game are ALLOWED. Flag only: harassment or insults aimed at people in the chat, hate speech or slurs, threats, sexual content, sharing personal information (phone numbers, addresses), or spam.
Message: """${body}"""
Return ONLY JSON: {"flag": true|false, "reason": "harassment"|"hate"|"threat"|"sexual"|"personal_info"|"spam"|null}`;

const LABELS = {
  harassment: 'Harassment', hate: 'Hate speech', threat: 'Threat', sexual: 'Sexual content',
  personal_info: 'Personal information', spam: 'Spam',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const caller = await getCaller(req);
    if (!caller) return json({ error: 'unauthorized' }, 401);
    const { message_id: messageId } = await req.json();
    const { data: msg } = await adminClient.from('messages').select('id, user_id, party_id, body, author_type').eq('id', messageId).single();
    if (!msg || msg.user_id !== caller.user.id || msg.author_type !== 'user') return json({ error: 'not allowed' }, 403);
    if (msg.body.trim().length < 3) return json({ ok: true, skipped: true });

    const { data: party } = await adminClient.from('parties').select('settings').eq('id', msg.party_id).single();
    if (party?.settings?.ai_moderation === false) return json({ ok: true, skipped: true });

    const ok = await rateLimit({ userId: caller.user.id, partyId: msg.party_id, kind: 'moderation', perUser: 30 });
    if (!ok) return json({ error: 'rate_limited' }, 429);

    const raw = await callClaude({ system: 'You are a careful chat moderator.', user: prompt(msg.body), schema: SCHEMA, maxTokens: 1000 });
    const out = parseJson(raw);
    if (out.flag) {
      await adminClient.from('messages')
        .update({ flagged: true, flag_reason: LABELS[out.reason] ?? 'Flagged by AI moderation' })
        .eq('id', msg.id);
    }
    return json({ ok: true, flagged: !!out.flag });
  } catch (err) {
    console.error('moderate-message error', err?.message ?? err);
    return json({ error: 'failed' }, 500);
  }
});
