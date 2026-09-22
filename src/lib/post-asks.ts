// What a post explicitly asks applicants to send. The GHL/Simpro post listed
// seven things, including "Your hourly rate", and the application answered
// four and dodged the rate. An employer reads that as not following
// instructions, which is the cheapest possible way to lose.

const TRIGGERS =
  /(to apply[^.\n]{0,40}|please (?:send|include|provide|answer|share|tell|state|list)|when applying|in your (?:application|reply|response|message)|please also|kindly (?:send|include|provide|answer))/i;

// A line that looks like an item in a list of asks.
const BULLET = /^\s*(?:[-*•–—]|\d+[.)])\s*(.{2,120})$/;

function clean(s: string): string {
  return s
    .replace(/\s+/g, ' ')
    .replace(/^[-*•–—\d.)\s]+/, '')
    .replace(/[.:;]+$/, '')
    .trim();
}

// Words that make an "ask" meaningless on its own.
const TOO_VAGUE = /^(?:your|the|a|an|and|or|please|thanks?|thank you|apply|application|resume|cv)$/i;

export function extractAsks(description: string): string[] {
  const text = (description || '').slice(0, 12000);
  const lines = text.split(/\r?\n/);
  const asks: string[] = [];
  const push = (s: string) => {
    const v = clean(s);
    if (v.length >= 3 && v.length <= 140 && !TOO_VAGUE.test(v) && !asks.some((a) => a.toLowerCase() === v.toLowerCase())) {
      asks.push(v);
    }
  };

  // A trigger line opens a list: collect the bullets that follow it.
  for (let i = 0; i < lines.length; i++) {
    if (!TRIGGERS.test(lines[i])) continue;

    // "Please also briefly explain one system you have built" is itself an ask.
    const inline = lines[i].replace(/^.*?(?:please (?:also )?|kindly )/i, '').trim();
    if (inline.length > 12 && !/^(?:send|include|provide|answer|share)\s*:?$/i.test(inline)) push(inline);

    for (let j = i + 1; j < Math.min(i + 15, lines.length); j++) {
      const m = lines[j].match(BULLET);
      if (m) { push(m[1]); continue; }
      if (lines[j].trim() === '') continue;
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
