// Centralized AI model configuration
import type Anthropic from '@anthropic-ai/sdk';

// Cheap, fast model for mechanical tasks (resume parsing, extraction).
export const AI_MODEL = 'claude-haiku-4-5-20251001';

// High-quality model for the actual application writing. Sonnet 5 writes far
// more natural, human prose than Haiku — the single biggest lever on making
// applications read like a real person wrote them.
export const WRITING_MODEL = 'claude-sonnet-5';

// Strictest model for the fact-check pass: it goes sentence by sentence and
// must cite a real fact for every claim about the applicant's past.
export const FACT_CHECK_MODEL = 'claude-opus-5';

// Sonnet 5 runs adaptive thinking by default, so response.content[0] can be a
// `thinking` block rather than the text. Always pull the text out by type
// instead of assuming index 0 — assuming [0] silently breaks on Sonnet 5.
export function extractText(message: Anthropic.Message): string | null {
  const block = message.content.find((b) => b.type === 'text');
  return block && block.type === 'text' ? block.text : null;
}

// Parse a JSON object out of a model response, tolerating ```json fences and
// any leading prose. Returns null if nothing parseable is found.
export function parseJsonResponse<T = Record<string, unknown>>(text: string): T | null {
  let t = text.trim();
  if (t.startsWith('```')) {
    t = t.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
  }
  try {
    return JSON.parse(t) as T;
  } catch {
    // Fall back to the first {...} span in case the model added prose around it.
    const start = t.indexOf('{');
    const end = t.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(t.slice(start, end + 1)) as T;
      } catch {
        return null;
      }
    }
    return null;
  }
}

// The residual "this was written by AI" tells that survive a good prompt.
// Applied as a final safety net after generation (em dash is the big one).
export function stripAiTells(text: string): string {
  if (!text) return text;
  return text
    .replace(/\s*—\s*/g, ', ') // em dash -> comma (the #1 tell)
    .replace(/–/g, '-') // en dash -> hyphen
    .replace(/[“”]/g, '"') // curly double quotes -> straight
    .replace(/[‘’]/g, "'") // curly single quotes -> straight
    .replace(/…/g, '...'); // ellipsis char -> three dots
}
