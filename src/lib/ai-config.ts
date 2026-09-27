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
  // Only an OBJECT counts. The signature says Record<string, unknown> and every
  // caller reads named fields off it, so a bare array or number is a failed
  // reply, not a parsed one; returning it only pushed the failure one step
  // downstream into a confusing "could not parse the application".
  const asObject = (raw: string): T | null => {
    try {
      const v: unknown = JSON.parse(raw);
      return v && typeof v === 'object' && !Array.isArray(v) ? (v as T) : null;
    } catch {
      return null;
    }
  };

  // In order: the text as sent, then the first {...} span in case the model
  // wrapped it in prose, then that span with its control characters repaired.
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  const span = start !== -1 && end > start ? t.slice(start, end + 1) : null;

  return (
    asObject(t) ||
    (span ? asObject(span) || asObject(repairJson(span)) : null)
  );
}

// Repair the JSON defects a model actually produces, rather than paying for a
// whole second generation to roll the dice again. Measured in production: about
// one draft in three came back as JSON that looked complete - correct keys, right
// shape, `stop_reason: end_turn` - and still would not parse, at roughly five
// cents of wasted call each time.
//
// Only two classes are repaired, both unambiguous:
//   1. A raw newline or tab INSIDE a string value. JSON forbids literal control
//      characters in strings and a cover letter is full of line breaks, so this
//      is far and away the commonest failure.
//   2. A trailing comma before a closing brace or bracket.
// Anything else is left to fail: guessing at genuinely broken structure risks
// silently returning the wrong letter, which is worse than retrying.
export function repairJson(text: string): string {
  let out = '';
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (escaped) {
      out += ch;
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      out += ch;
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      out += ch;
      continue;
    }

    if (inString) {
      // Escape the control characters that make an otherwise good reply unparseable.
      if (ch === '\n') { out += '\\n'; continue; }
      if (ch === '\r') { out += '\\r'; continue; }
      if (ch === '\t') { out += '\\t'; continue; }
      out += ch;
      continue;
    }

    out += ch;
  }

  // A trailing comma before } or ], outside of any string.
  return out.replace(/,(\s*[}\]])/g, '$1');
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

// How hard the fact-check pass thinks. Thinking bills as OUTPUT, and output is
// about two thirds of what an application now costs.
//
// Measured after the move to Sonnet: this call produced ~4,500 output tokens at
// effort high, against ~2,280 when it ran on Opus. It got cheaper per token and
// louder per call, and the extra volume ate most of the saving. Medium brings it
// back in line with what the pass actually has to do: it is handed every fact it
// needs and asked which sentences those facts do not support.
//
// Held back one round on purpose so the model change could be judged alone. The
// logs now print [fact-check] found=N on every application, so what this costs
// in catches is measurable rather than a matter of opinion.
export const FACT_CHECK_EFFORT: 'medium' | 'high' = 'medium';
