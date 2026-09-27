// Centralized AI model configuration
import type Anthropic from '@anthropic-ai/sdk';

// Cheap, fast model for mechanical tasks (resume parsing, extraction).
export const AI_MODEL = 'claude-haiku-4-5-20251001';

// High-quality model for the actual application writing. Sonnet 5 writes far
// more natural, human prose than Haiku — the single biggest lever on making
// applications read like a real person wrote them.
export const WRITING_MODEL = 'claude-sonnet-5';

// The fact-check pass: it goes sentence by sentence and must cite a real fact
// for every claim about the applicant's past.
//
// This was claude-opus-5, and measured on real applications it was 56% of the
// entire bill: $0.0975 of a $0.18 application, against $0.039 for the same call
// on Sonnet 5. Opus input is 2.5x Sonnet's and its output 2.5x, and this call
// produces the most output of the three because it rewrites the letter.
//
// Two things make Sonnet 5 a fair trade rather than a gamble. The task is
// bounded entailment with every fact it needs sitting in the prompt, not
// open-ended reasoning. And it is no longer the only guard: the screening
// phrase, the ask coverage, the tool claims, the named employers and the AI
// tells are all enforced deterministically in code now, so this pass answers
// for fabricated FACTS specifically rather than for everything at once.
//
// Reverting is this one line, if the fabrication rate ever looks worse.
export const FACT_CHECK_MODEL = 'claude-sonnet-5';

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

// How hard the fact-check pass thinks. It is the most expensive call in the
// pipeline by a wide margin, so this is the single biggest cost knob in the app;
// it lives here so changing it is one edit and shows up in one diff.
export const FACT_CHECK_EFFORT: 'medium' | 'high' = 'high';
