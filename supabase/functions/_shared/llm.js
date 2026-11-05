// Provider switch for the AI features. Gemini is used while GEMINI_API_KEY is set
// (or AI_PROVIDER=gemini); otherwise Claude. Both take the same arguments and
// return the model's text, which callers parse with parseJson().
import { callClaude } from './claude.js';
import { callGemini } from './gemini.js';

const provider = Deno.env.get('AI_PROVIDER')
  ?? (Deno.env.get('GEMINI_API_KEY') ? 'gemini' : 'anthropic');

export function callModel(args) {
  return provider === 'gemini' ? callGemini(args) : callClaude(args);
}

export function parseJson(text) {
  const cleaned = String(text).trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  return JSON.parse(cleaned);
}
