import { clampPost } from '@/lib/prompt-safety';

// What a post explicitly asks applicants to send. The GHL/Simpro post listed
// seven things, including "Your hourly rate", and the application answered
// four and dodged the rate. An employer reads that as not following
// instructions, which is the cheapest possible way to lose.

const VERBS =
  'send|include|provide|answer|share|tell|state|list|attach|submit|describe|outline|specify|detail|confirm|explain|start|begin|reply|respond|note|indicate|mention';
const TRIGGERS = new RegExp(
  `(to apply[^.\\n]{0,40}|please (?:also )?(?:${VERBS})|when applying|in your (?:application|reply|response|message|proposal|cover letter)|please also|kindly (?:${VERBS}))`,
  'i'
);

// A heading that OPENS a list of application instructions. These are never asks
// themselves: "How to Apply (Screening Checklist)" answers nothing, and handing
// it to the writer as an ask both wastes a repair pass and reads as noise.
// The leading [#*_>\s]* allows for markdown decoration: real posts write
// "## How to Apply - Read Carefully" and "**HOW TO APPLY**".
const SECTION =
  /^[#*_>\s]*(?:how to apply|to apply|application (?:process|instructions|requirements?|checklist)|screening(?: checklist| questions?| process)?|next steps?|before you apply|to be considered|when you apply|what (?:we|i) need from you)\b/i;

// A HEADING, not an item: short, no sentence-ending punctuation, and either all
// caps or title case. A list stops at one, and one is never an ask itself.
// Without this, "HOW WE HIRE", "Application Requirement" and "## How to Apply"
// were collected as things to answer, which wastes a repair pass on every
// application and asks the writer to respond to a section title.
const HEADING_STOPWORDS = new Set(['a', 'an', 'the', 'of', 'to', 'and', 'or', 'for', 'in', 'on', 'we', 'you', 'your', 'is', 'are']);
function looksLikeHeading(line: string): boolean {
  const t = line.trim().replace(/^[#*_>\s]+/, '').replace(/[#*_:\s]+$/, '');
  if (!t || t.length > 60) return false;
  if (/[.!?]$/.test(t)) return false;
  const words = t.split(/\s+/);
  if (words.length > 7) return false;
  const allCaps = t === t.toUpperCase() && /[A-Z]/.test(t);
  const titleCase = words.every(
    (w) => !/^[a-z]/.test(w) || HEADING_STOPWORDS.has(w.toLowerCase())
  );
  return allCaps || titleCase;
}

// A line that looks like an item in a list of asks. The marker is matched on its
// own, separately from the length of what follows: a 280-character bullet is
// still a bullet, and treating it as "not a bullet" used to END the list and lose
// every item after it. Seen on a live post, where two of three asks vanished.
const BULLET_MARKER = /^\s*(?:[-*•‣–—]|\d{1,2}[.)])\s+(\S.*)$/;

// A line ending in a colon is introducing something, not answering anything, so
// it closes whatever list was being collected and may open a new one.
const OPENS_LIST = /:\s*$/;

// A note in parentheses is commentary on the list, not another item.
const PARENTHETICAL = /^\s*\(.*\)\s*$/;

function clean(s: string): string {
  return s
    .replace(/\s+/g, ' ')
    // Strip a leading LIST MARKER only. The old pattern ate any leading digits,
    // which turned "2-3 live URLs or GitHub repos" into "live URLs" and lost the
    // quantity the employer actually asked for.
    .replace(/^\s*(?:[-*•‣]|\d{1,2}[.)])\s+/, '')
    // Markdown bold/italic/heading marks around an item, e.g. "**IMPORTANT: ...**"
    .replace(/^[#*_]+/, '')
    .replace(/[*_]+$/, '')
    .replace(/[.:;!]+$/, '')
    .trim();
}

// The first sentence of a long item. An ask is usually the opening clause and the
// rest is explanation, so this keeps what must be answered and drops the padding
// that would otherwise blow the length cap and lose the item entirely.
function firstSentence(s: string): string {
  const t = s.trim();
  if (t.length <= 200) return t;
  const cut = t.slice(0, 200);
  // Break at the last sentence end, or failing that the last comma or space, so
  // an ask is never truncated mid-word.
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  if (end > 40) return cut.slice(0, end + 1);
  const soft = Math.max(cut.lastIndexOf(', '), cut.lastIndexOf(' '));
  return (soft > 40 ? cut.slice(0, soft) : cut).trim();
}

// Words that make an "ask" meaningless on its own.
const TOO_VAGUE = /^(?:your|the|a|an|and|or|please|thanks?|thank you|apply|application|resume|cv)$/i;

export function extractAsks(description: string): string[] {
  const text = clampPost(description || '');
  const lines = text.split(/\r?\n/);
  const asks: string[] = [];
  const push = (s: string) => {
    const v = clean(s);
    // 200, not 140: "Details on at least 1 AI integration project you built
    // (explain what model/API you used, what the workflow did, and how you
    // handled the integration)" is 147 characters and is a real ask.
    if (v.length < 3 || v.length > 200 || TOO_VAGUE.test(v)) return;
    // Tested on the RAW text, not the cleaned one: clean() strips the trailing
    // period, and without it "Send your CV." is three title-case words and looks
    // exactly like a heading.
    if (looksLikeHeading(s)) return;
    const lv = v.toLowerCase();
    for (let i = 0; i < asks.length; i++) {
      const la = asks[i].toLowerCase();
      if (la === lv) return;
      // The same instruction often reaches here twice, once from the inline
      // path and once as an item in the list below its heading. Keep the
      // shorter: the longer copy carries the post's preamble, not more ask.
      if (la.includes(lv)) { asks[i] = v; return; }
      if (lv.includes(la)) return;
    }
    asks.push(v);
  };

  // A trigger line or a section heading opens a list: collect what follows.
  for (let i = 0; i < lines.length; i++) {
    const isSection = SECTION.test(lines[i]);
    if (!isSection && !TRIGGERS.test(lines[i])) continue;

    // A heading and a line ending in a colon introduce the asks; they are not
    // asks themselves. "Please also briefly explain one system you have built"
    // is, so keep that. A SECTION heading opens a list whether or not it carries
    // a colon: a bare "HOW TO APPLY" line is exactly that, and requiring the
    // colon meant the instructions under it were never read.
    const opensList = isSection || OPENS_LIST.test(lines[i]);
    if (!isSection && !opensList) {
      const inline = lines[i].replace(/^.*?(?:please (?:also )?|kindly )/i, '').trim();
      if (inline.length > 12 && !new RegExp(`^(?:${VERBS})\\s*:?$`, 'i').test(inline)) push(inline);
    }

    let sawBullet = false;
    for (let j = i + 1; j < Math.min(i + 25, lines.length); j++) {
      const line = lines[j];
      if (line.trim() === '') continue;

      const m = line.match(BULLET_MARKER);
      if (m) { sawBullet = true; push(firstSentence(m[1])); continue; }

      // A bulleted list ends at the first unmarked line. Without this, the
      // "Thanks!" after a list of bullets became an ask.
      if (sawBullet) break;

      // A new heading or another "please provide:" ends this list. A recognised
      // section opens its own, which this same loop reaches on a later pass; an
      // unrecognised one ("HOW WE HIRE") just stops the collecting, so their
      // hiring process does not become a list of things to answer.
      if (SECTION.test(line) || OPENS_LIST.test(line) || looksLikeHeading(line)) break;

      // "(Applications missing live samples will not be reviewed.)" is a note
      // about the list, not another item in it.
      if (PARENTHETICAL.test(line)) continue;

      // Real posts write these items as blank-line-separated paragraphs far more
      // often than as bullets. Accept an unmarked line when the opening line
      // ended in a colon, which is what makes it a list rather than prose. Two
      // words minimum, so a stray one-word label or sign-off is not an ask, but
      // "Your rate." still is. TOO_VAGUE catches the pleasantries.
      //
      // A long paragraph contributes its FIRST SENTENCE rather than being
      // skipped: under "HOW TO APPLY", "Send a CV if you have one. If your CV
      // doesn't show what you can actually do, ..." is a real ask wrapped in 360
      // characters of explanation, and dropping it lost the only instruction the
      // post gave.
      const words = line.trim().split(/\s+/).length;
      if (opensList && words >= 2) { push(firstSentence(line)); continue; }

      break; // the list has ended
    }
  }

  // Direct questions anywhere in the post.
  for (const sentence of text.split(/(?<=[?])\s+/)) {
    const s = sentence.trim();
    if (s.endsWith('?') && s.length <= 160 && s.length > 12) push(s);
  }

  return asks.slice(0, 12);
}

// Rough check that an ask was addressed: do its distinctive words appear in the
// reply? Deliberately generous, since the point is to catch a whole topic being
// skipped (the rate, the availability), not to grade the wording.
const STOP =
  /^(?:your|our|the|a|an|and|or|of|for|to|in|on|with|any|please|also|briefly|explain|send|include|provide|tell|us|me|about|what|which|how|why|do|does|did|you|have|has|is|are|be|been|will|would|can|could|that|this|it|one|some|experience|experiences)$/i;

function keyWords(ask: string): string[] {
  return ask
    .toLowerCase()
    .replace(/[^a-z0-9$/. -]/g, ' ')
    .split(/[\s/]+/)
    .map((w) => w.replace(/^[.\-]+|[.\-]+$/g, ''))
    .filter((w) => w.length >= 3 && !STOP.test(w));
}

// Topics that are answered by an equivalent rather than the literal word.
const SYNONYMS: [RegExp, RegExp][] = [
  // A rate is only answered by a NUMBER. "Rate is easy to sort out once we're
  // clear on scope" contains the word and answers nothing, which is precisely
  // the dodge that lost marks on the Simpro post.
  [/\b(rate|salary|pay|compensation|price|budget)\b/,
   /(?:\$|₱|php|usd)\s?\d|\d+\s?(?:\$|₱|php|usd|\/\s?(?:hr|hour|mo|month)|per hour|an hour|a month|k\b)/i],
  [/\b(availability|available|hours|schedule|start)\b/, /\b(available|availability|hours|full[- ]time|part[- ]time|time ?zone|overlap|start|schedule)\b/i],
  [/\b(portfolio|samples?|work|examples?)\b/, /\b(portfolio|dlvasolutions|sample|example|github|resume)\b/i],
  [/\b(location|based|country|timezone)\b/, /\b(based|philippines|davao|time ?zone|gmt|utc)\b/i],
];

export function unansweredAsks(asks: string[], reply: string): string[] {
  const body = (reply || '').toLowerCase();
  return asks.filter((ask) => {
    for (const [topic, answered] of SYNONYMS) {
      if (topic.test(ask.toLowerCase())) return !answered.test(body);
    }
    const words = keyWords(ask);
    if (words.length === 0) return false;
    const hit = words.filter((w) => body.includes(w)).length;
    // Half the distinctive words showing up counts as addressed.
    return hit / words.length < 0.5;
  });
}

// The checklist handed to the writer.
export function asksBlock(asks: string[]): string {
  if (asks.length === 0) return '';
  return `THE POST ASKS FOR THESE BY NAME. Answer every single one, in the message, in plain words. Missing one reads as not following instructions, which loses the job on its own. If something genuinely does not apply, say what the nearest real answer is rather than staying silent:
${asks.map((a, i) => `${i + 1}. ${a}`).join('\n')}`;
}
