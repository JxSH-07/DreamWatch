import Anthropic from 'npm:@anthropic-ai/sdk@0.136.0';

const MODEL = Deno.env.get('GAFFER_MODEL') ?? 'claude-haiku-5-5';
let client = null; // created on first use so a Gemini-only deployment never needs an Anthropic key

// One short JSON-returning call. `schema` constrains the output via structured
// outputs; low effort keeps chat replies fast. Thinking tokens count toward
// max_tokens, so leave headroom above the visible answer length.
export async function callClaude({ system, user, schema, maxTokens = 2000 }) {
  client ??= new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') });
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: user }],
    output_config: {
      effort: 'low',
      ...(schema ? { format: { type: 'json_schema', schema } } : {}),
    },
  });
  if (response.stop_reason === 'refusal') {
    const err = new Error('refusal');
    err.refusal = true;
    throw err;
  }
  return response.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
}

export function parseJson(text) {
  const cleaned = String(text).trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  return JSON.parse(cleaned);
}
