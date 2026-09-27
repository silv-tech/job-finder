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
const SECTION =
  /^\s*(?:how to apply|to apply|application (?:process|instructions|requirements|checklist)|screening(?: checklist| questions?| process)?|next steps?|before you apply|to be considered|when you apply|what (?:we|i) need from you)\b/i;

// A line that looks like an item in a list of asks.
const BULLET = /^\s*(?:[-*•–—]|\d+[.)])\s*(.{2,200})$/;

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
    .replace(/[.:;!]+$/, '')
    .trim();
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
    // is, so keep that.
    const opensList = OPENS_LIST.test(lines[i]);
    if (!isSection && !opensList) {
      const inline = lines[i].replace(/^.*?(?:please (?:also )?|kindly )/i, '').trim();
      if (inline.length > 12 && !new RegExp(`^(?:${VERBS})\\s*:?$`, 'i').test(inline)) push(inline);
    }

    let sawBullet = false;
    for (let j = i + 1; j < Math.min(i + 25, lines.length); j++) {
      const line = lines[j];
      if (line.trim() === '') continue;

      const m = line.match(BULLET);
      if (m) { sawBullet = true; push(m[1]); continue; }

      // A bulleted list ends at the first unmarked line. Without this, the
      // "Thanks!" after a list of bullets became an ask.
      if (sawBullet) break;

      // A new heading or another "please provide:" ends this list and opens its
      // own, which this same loop reaches on a later pass.
      if (SECTION.test(line) || OPENS_LIST.test(line)) break;

      // "(Applications missing live samples will not be reviewed.)" is a note
      // about the list, not another item in it.
      if (PARENTHETICAL.test(line)) continue;

      // Real posts write these items as blank-line-separated paragraphs far more
      // often than as bullets. Accept an unmarked line when the opening line
      // ended in a colon, which is what makes it a list rather than prose. Two
      // words minimum, so a stray one-word label or sign-off is not an ask, but
      // "Your rate." still is. TOO_VAGUE catches the pleasantries.
      const words = line.trim().split(/\s+/).length;
      if (opensList && words >= 2 && line.trim().length <= 240) { push(line); continue; }

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
