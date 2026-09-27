// Some posts screen applicants with a literal string: "start your cover letter
// with the exact phrase FULLSTACK AI BUILDER", "put BLUE SKY in the subject".
// The post usually says outright that applications without it are not read, so
// this is pass/fail and it is the cheapest possible way to lose a job.
//
// A requirement like that must never depend on the model remembering it. We
// detect it here, tell the writer about it, and then CHECK and FIX it in code
// after the draft comes back. Deterministic, free, and it cannot regress.

export type PhraseRequirement = {
  // The literal text the employer asked for, exactly as they wrote it.
  phrase: string;
  // 'letter-start' and 'subject' are positional and enforced automatically.
  // 'anywhere' is only verified, because we cannot know where it belongs.
  where: 'letter-start' | 'subject' | 'anywhere';
  // The sentence it came from, so the prompt can quote the employer's own words.
  source: string;
};

// Opening and closing quote characters used in real posts, including the curly
// pairs a word processor produces and the guillemets some employers use. The
// straight apostrophe is deliberately NOT a quote here: it would match every
// possessive in the post ("the client's brief") and invent requirements.
const OPEN = '"“‘«‹`';
const CLOSE = '"”’»›`';
const QUOTED = new RegExp(`[${OPEN}]\\s*([^${CLOSE}\\n]{2,80}?)\\s*[${CLOSE}]`);

// An unquoted literal, which only counts when the post shouts it in capitals
// right after naming it. Lowercase here would swallow half the sentence.
const SHOUTED = /(?:phrase|words?|code|text|line)\s*(?:is|of|:|-)?\s*([A-Z][A-Z0-9][A-Z0-9 ._!-]{1,58}[A-Z0-9])/;

// Cues strong enough to act on. A weak cue ("we use Slack") must never reach
// here: prepending a wrong phrase to a cover letter is worse than missing one.
// Words are allowed between the verb and the preposition: a real post writes
// "start your application or cover letter with", which a tight pattern misses.
// Safe to be loose here, because a requirement still needs an actual literal AND
// a naming cue before it counts.
const START_CUE =
  /\b(?:start|begin|open|lead off|head)\w*\s+(?:[\w'-]+[\s,]+){0,8}?(?:with|using)\b/i;
const SUBJECT_CUE = /\bsubject\s*(?:line|field|header)?\b/i;
const EXACT_CUE = /\b(?:exact(?:ly)?|verbatim|word[- ]for[- ]word|copy(?:\s+and\s+paste|\/paste)?|precise(?:ly)?)\b/i;
const INCLUDE_CUE =
  /\b(?:includ\w+|add|insert|use|type|writ\w+|mention|put|place|append|reply\s+with|respond\s+with|answer\s+with|state)\b/i;
// Naming the thing as a literal is itself a strong signal.
const LITERAL_CUE =
  /\b(?:phrase|keyword|pass(?:word|phrase|code)|code\s*word|magic\s+word|(?:the|this|following|exact)\s+(?:\w+\s+)?words?)\b/i;

// Phrases that are obviously not a screening token, so a stray quotation in the
// post body cannot become a forced opening line.
const NOT_A_PHRASE =
  /^(?:https?:|www\.|n\/a|etc|e\.g|i\.e|and|or|the|a|an|yes|no|tbd|\d+)$/i;

// Posts very often put the literal on its OWN LINE under the instruction:
//
//   start your application or cover letter with the secret word:
//
//   NEURAL
//
// Joining a colon-terminated line to the next non-empty line puts the cue and the
// literal into one sentence, so the rest of the detection works unchanged. Found
// on a live post, where the secret word was otherwise missed completely.
function joinColonLines(text: string): string {
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (/:\s*$/.test(lines[i])) {
      let j = i + 1;
      while (j < lines.length && !lines[j].trim()) j++;
      if (j < lines.length) {
        out.push(lines[i].trimEnd() + ' ' + lines[j].trim());
        i = j;
        continue;
      }
    }
    out.push(lines[i]);
  }
  return out.join('\n');
}

function sentences(text: string): string[] {
  // Split on sentence ends and on line breaks: posts are full of one-line items
  // that never get a full stop. NOT on a colon: "start your cover letter with
  // the exact phrase: "X"" is the commonest way this is written, and splitting
  // there severs the cue from the phrase it introduces.
  return text
    .split(/(?<=[.!?])\s+|\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function literalIn(sentence: string): string | null {
  const q = sentence.match(QUOTED);
  if (q) return q[1].trim();
  const s = sentence.match(SHOUTED);
  if (s) return s[1].trim().replace(/[\s.]+$/, '');
  return null;
}

export function requiredPhrases(description: string): PhraseRequirement[] {
  const text = description || '';
  const out: PhraseRequirement[] = [];
  const seen = new Set<string>();

  for (const sentence of sentences(joinColonLines(text))) {
    // Cheap gate first: no cue word at all means no requirement in this line.
    const hasStart = START_CUE.test(sentence);
    const hasSubject = SUBJECT_CUE.test(sentence);
    const named = LITERAL_CUE.test(sentence) || EXACT_CUE.test(sentence);
    if (!hasStart && !hasSubject && !named && !INCLUDE_CUE.test(sentence)) continue;

    const phrase = literalIn(sentence);
    if (!phrase || phrase.length < 2 || NOT_A_PHRASE.test(phrase)) continue;

    // A quoted fragment only counts as a requirement when the sentence either
    // names it as a literal, or says where to put it. "We use 'agile' here" has
    // neither and is correctly ignored.
    const positional = hasStart || hasSubject;
    if (!named && !positional) continue;

    // A long quotation is the employer quoting themselves, not a token to echo.
    if (phrase.length > 80) continue;

    const where: PhraseRequirement['where'] = hasStart
      ? 'letter-start'
      : hasSubject
        ? 'subject'
        : 'anywhere';

    const key = `${where}::${phrase.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ phrase, where, source: sentence.replace(/\s+/g, ' ').slice(0, 220) });
  }

  // A post that screens this way names one or two tokens. More than that means
  // the detector latched onto ordinary quotation, so trust none of it.
  return out.length <= 3 ? out : [];
}

function norm(s: string): string {
  // Compare on letters and digits only: employers write the phrase in caps in
  // the instruction and mean the words, not the punctuation around them.
  return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// Which requirements the draft has not satisfied. Position counts: a phrase that
// had to open the letter and sits in paragraph three has not been satisfied.
export function missingPhrases(
  reqs: PhraseRequirement[],
  subject: string,
  letter: string
): PhraseRequirement[] {
  const nSubject = norm(subject);
  const nLetter = norm(letter);
  return reqs.filter((r) => {
    const n = norm(r.phrase);
    if (!n) return false;
    if (r.where === 'subject') return !nSubject.includes(n);
    if (r.where === 'anywhere') return !nLetter.includes(n) && !nSubject.includes(n);
    return !nLetter.startsWith(n);
  });
}

// Put every positional requirement where it belongs. Mechanical on purpose: the
// employer asked for an exact string in an exact place, so there is nothing to
// reason about and no reason to spend a model call on it.
export function applyPhrases(
  reqs: PhraseRequirement[],
  subject: string,
  letter: string
): { subject: string; cover_letter: string; changed: string[] } {
  let s = subject || '';
  let l = letter || '';
  const changed: string[] = [];

  for (const r of reqs) {
    const n = norm(r.phrase);
    if (!n) continue;

    if (r.where === 'subject') {
      if (!norm(s).includes(n)) {
        s = s ? `${r.phrase} - ${s}` : r.phrase;
        changed.push(`put "${r.phrase}" in the subject`);
      }
      continue;
    }

    if (r.where === 'letter-start') {
      if (norm(l).startsWith(n)) continue;
      // If it is already in the body, move it rather than saying it twice.
      const stray = new RegExp(`^\\s*${escapeRe(r.phrase)}[\\s.,:;!-]*`, 'i');
      l = l.replace(stray, '');
      l = `${r.phrase}\n\n${l.replace(/^\s+/, '')}`;
      changed.push(`opened the letter with "${r.phrase}"`);
      continue;
    }

    // 'anywhere': only verified, never inserted. We cannot know where it would
    // read naturally, and a phrase dropped into the wrong sentence looks worse
    // than the writer handling it on the next pass.
  }

  return { subject: s, cover_letter: l, changed };
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// The instruction handed to the writer, so the first draft gets it right and the
// code fix is only ever a safety net.
export function phrasesBlock(reqs: PhraseRequirement[]): string {
  if (reqs.length === 0) return '';
  const lines = reqs.map((r) => {
    const where =
      r.where === 'letter-start'
        ? 'must be the very first thing in the cover letter, on its own line, before the greeting'
        : r.where === 'subject'
          ? 'must appear in the subject line'
          : 'must appear somewhere in the message';
    return `- "${r.phrase}" ${where}. The employer wrote: "${r.source}"`;
  });
  return `THE POST DEMANDS AN EXACT PHRASE. This is a screening test: posts that ask for one usually say outright that applications without it are never read. Reproduce it character for character, in the position given, and do not explain, translate or comment on it:
${lines.join('\n')}`;
}
