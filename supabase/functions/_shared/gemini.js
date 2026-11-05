// Gemini via the Generative Language REST API. Same interface as claude.js.
const API = 'https://generativelanguage.googleapis.com/v1beta/models';
const PRIMARY = Deno.env.get('GEMINI_MODEL') ?? 'gemini-3.5-flash';
const FALLBACKS = (Deno.env.get('GEMINI_FALLBACK_MODELS') ?? 'gemini-3.1-flash-lite')
  .split(',').map((m) => m.trim()).filter(Boolean);
const ATTEMPT_TIMEOUT_MS = 8000;

// Chat moderation has to read abusive text to classify it, so Gemini's own
// safety filters are relaxed; the prompts and JSON schemas constrain the output.
const SAFETY = ['HARM_CATEGORY_HARASSMENT', 'HARM_CATEGORY_HATE_SPEECH', 'HARM_CATEGORY_SEXUALLY_EXPLICIT', 'HARM_CATEGORY_DANGEROUS_CONTENT']
  .map((category) => ({ category, threshold: 'BLOCK_NONE' }));

class RetryableError extends Error {}

async function attempt(model, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ATTEMPT_TIMEOUT_MS);
  try {
    const res = await fetch(`${API}/${model}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': Deno.env.get('GEMINI_API_KEY') },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (res.status === 429 || res.status >= 500) throw new RetryableError(`Gemini ${model} ${res.status}`);
    const data = await res.json();
    if (!res.ok) throw new Error(`Gemini ${model} ${res.status}: ${data?.error?.message ?? ''}`);
    if (data.promptFeedback?.blockReason) {
      const err = new Error(`Gemini blocked the prompt: ${data.promptFeedback.blockReason}`);
      err.blocked = true;
      throw err;
    }
    const cand = data.candidates?.[0];
    if (cand?.finishReason === 'SAFETY' || cand?.finishReason === 'PROHIBITED_CONTENT') {
      const err = new Error(`Gemini blocked the response: ${cand.finishReason}`);
      err.blocked = true;
      throw err;
    }
    const text = (cand?.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? '').join('');
    if (!text) throw new RetryableError(`Gemini ${model} returned no text (${cand?.finishReason})`);
    return text;
  } catch (err) {
    if (err.name === 'AbortError') throw new RetryableError(`Gemini ${model} timed out`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// One short JSON-returning call. Tries the primary model, then each fallback on
// overload (429/5xx) or timeout.
export async function callGemini({ system, user, schema, maxTokens = 2000 }) {
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: user }] }],
    safetySettings: SAFETY,
    generationConfig: {
      maxOutputTokens: maxTokens,
      thinkingConfig: { thinkingLevel: 'low' },
      ...(schema ? { responseMimeType: 'application/json', responseJsonSchema: schema } : {}),
    },
  };
  let lastError;
  for (const model of [PRIMARY, ...FALLBACKS]) {
    try {
      return await attempt(model, body);
    } catch (err) {
      lastError = err;
      if (!(err instanceof RetryableError)) throw err;
      console.error(`${err.message}; trying next model`);
    }
  }
  throw lastError;
}
