import { clampPost } from '@/lib/prompt-safety';

// What a post explicitly asks applicants to send. The GHL/Simpro post listed
// seven things, including "Your hourly rate", and the application answered
// four and dodged the rate. An employer reads that as not following
// instructions, which is the cheapest possible way to lose.
//
// A 40-post audit across nine keyword lanes found 17 of the 30 posts that ask
// for something lost at least one instruction. Every rule below that carries a
// post id was written against a real post that lost a real ask.

// Verbs that make "please <verb>" an instruction to the applicant. `apply` and
// `follow` are here because "Please apply with:" (1738927) and "please follow
// these instructions carefully:" (1738932) are two of the commonest openers in
// the wild, and without them a whole numbered checklist was never read.
const VERBS =
  'send|include|provide|answer|share|tell|state|list|attach|submit|describe|outline|specify|detail|confirm|explain|start|begin|reply|respond|note|indicate|mention|apply|follow|complete|fill|email|upload|record|write|show|address|walk|give';

// The place an instruction points at. "in your video" and "in the email" are
// here because 1724400 ("IN YOUR VIDEO, PLEASE ADDRESS:") and 1738932 ("In the
// email, include:") both introduced a list that was otherwise invisible.
const PLACE =
  '(?:application|reply|response|message|proposal|cover letter|email|e-mail|video|recording|loom|submission|note|letter|answer)';

// Words are allowed between "please" and the verb: a real post writes "please
// make sure to attach your updated CV" (1721989), and requiring the verb to sit
// immediately after "please" lost the only two asks that post made.
const TRIGGERS = new RegExp(
  `(to apply\\b|when applying\\b|to be considered\\b|in (?:your|the) ${PLACE}\\b|(?:please|kindly)\\s+(?:\\w+[\\s,]+){0,3}?(?:${VERBS})\\b)`,
  'i'
);

// A heading that OPENS a list of application instructions. These are never asks
// themselves: "How to Apply (Screening Checklist)" answers nothing, and handing
// it to the writer as an ask both wastes a repair pass and reads as noise.
// The leading [#*_>\s]* allows for markdown decoration: real posts write
// "## How to Apply - Read Carefully" and "**HOW TO APPLY**".
const SECTION =
  /^[#*_>\s]*(?:how to apply|to apply|how to respond|application (?:process|instructions|requirements?|checklist|questions?)|screening(?: checklist| questions?| process)?|next steps?|before you apply|to be considered|when you apply|what (?:we|i) need from you|what to send|requirements? to send)\b/i;

// A SECOND block of instructions, under a heading the SECTION list will never
// enumerate: 1738997 put five more asks under "GET CONSIDERED FASTER", 1739053
// under "Voice Recording Required" and "One Final Test", 1724400 under
// "WRITTEN APPLICATION QUESTIONS". Generalised rather than listed: a heading
// that names the application, a submission, a screening artefact or a test
// opens a list. Deliberately NOT triggered by "Requirements", "Required
// Skills", "Technical Requirements" or "Equipment requirements", which are job
// description headings - those need a sending word alongside them - and not by
// "Initial Project Scope & Deliverables", which on 1738996 heads the three
// BUILD phases. That one turned the work itself into things to answer.
const STRONG_HEADING =
  /\b(?:appl(?:y|ication|ications|icants?)|submit|submission|send|sending|consider(?:ed|ation)?|screening|questionnaire|questions?|checklist|instructions?|next steps?|final test|test|video|loom|recording)\b/i;

// A line that looks like an item in a list of asks. The marker is matched on its
// own, separately from the length of what follows: a 280-character bullet is
// still a bullet, and treating it as "not a bullet" used to END the list and lose
// every item after it. Seen on a live post, where two of three asks vanished.
// "1-" and "a.)" are real numbering styles: 1587417 writes "1- Portfolio:" and
// 1738932 writes "a.) A brief introduction about yourself".
const BULLET_MARKER =
  /^\s*(?:[-*•‣–—▪·>]{1,3}(?=\s|[A-Za-z0-9])\s*|\d{1,2}\s*[.)\]]\s+|\d{1,2}\s*[-–—]\s+|[a-z]\s*\.?\)\s*|[a-z]\s*\.\s+|[ivx]{1,3}\s*[.)]\s+)(\S.*)$/i;

// A line ending in a colon is introducing something, not answering anything, so
// it closes whatever list was being collected and may open a new one.
const OPENS_LIST = /:\s*$/;

// A note in parentheses is commentary on the list, not another item.
const PARENTHETICAL = /^\s*\(.*\)\s*$/;

// Things an applicant sends. These must survive both TOO_VAGUE and the heading
// test: "Resume" and "Portfolio" were the only two asks 1738180 made, and both
// were discarded - one as too vague, one as a title-case heading.
const DELIVERABLE =
  /^(?:resume|résumé|cv|portfolio|references?|samples?|links?|availability|rate|cover letter|introduction|intro|video|loom|recording|screenshots?|answers?)$/i;

// The object of an application instruction. Used to keep a bare imperative from
// swallowing the responsibilities list: "Provide customer support via email"
// names none of these and is not an ask, "Send your CV and rate" does.
const APPLY_OBJECT =
  /\b(?:cv|resume|résumé|portfolio|cover letter|application|proposal|samples?|links?|loom|video|recording|screenshots?|rate|rates|salary|availability|references?|introduction|intro|questions?|answers?|experience|hours|start date|expectations?)\b/i;

// A bare imperative opener. "Then answer the following:" (1739053) and "Send
// your CV and rate." (1733471) are instructions with no "please", no colon-
// bearing heading above them and no bullet, and both were invisible.
const ASK_VERBS =
  'send|include|provide|attach|submit|answer|tell|share|list|describe|explain|confirm|state|write|email|upload|record|reply|respond|complete|fill|start|begin|put|add|apply|note|mention|show|give|let|walk|keep|make|ensure';
const IMPERATIVE = new RegExp(
  `^\\s*[#*_>\\s]*(?:(?:then|also|next|finally|first|second|third|lastly|now|please|kindly)[,\\s]+)?(?:${ASK_VERBS})\\b`,
  'i'
);

// "Please do not apply if you have not worked with Simpro before" is not a
// thing to answer. Neither is "Please only apply if you have experience".
const NEGATIVE_ASK = /^(?:do not|don'?t|dont|never|no\b|only|avoid|refrain)/i;

// Lines that are not asks however they are punctuated. Every entry here was
// collected as an ask from a real post.
const NOISE: RegExp[] = [
  // Pleasantries and sign-offs: "We can't wait to meet you" (1738975).
  /^(?:thanks?\b|thank you|good luck|cheers|best of luck|have a (?:nice|great|good)|all the best|we can'?t wait|we(?:'re| are) excited|excited to|looking forward|hope to hear|we hope)/i,
  // The employer talking about itself or its own hiring process: "We read every
  // application that follows these steps" (1738975), "We review every
  // application within 5 days". Kept only when it actually asks the applicant
  // to do something ("We would like you to send ...").
  /^(?:we|our|i)\b(?![^.]*\byou\b[^.]*\b(?:send|include|provide|attach|submit|answer|tell|share|list|describe|explain|confirm|state|write|email|upload|record|start|begin|apply|follow|complete|fill|create|make|film)\b)/i,
  // Warnings. True and worth heeding, but there is nothing to answer:
  // "Generic applications will not be considered" (1739053).
  /\b(?:will not be|won'?t be|are not|is not|may not be|never)\s+(?:considered|reviewed|read|accepted)\b/i,
  /^no\s+[\w -]{2,20}\s*=/i,
  // "Please read carefully." (1739053) - an exhortation, not an ask. The
  // answerable version, "Confirmation that you read this entire post" (1738997),
  // does not match because it does not start with the verb.
  /^(?:please\s+)?read (?:this|it|carefully|everything|the (?:whole|entire|full))/i,
  /^(?:please\s+)?(?:read|apply) carefully/i,
  // Metadata tails: "Job type: Independent contractor", "Work location: Remote"
  // (1738975) were both handed to the writer as things to answer.
  /^(?:job type|job title|position|role|employment type|work location|location|work setup|setup|schedule|working hours|shift|salary|pay|compensation|rate of pay|start date|type|department|reports to|industry|experience level|benefits?|perks?|duration|contract)\s*:/i,
  // Benefits lists.
  /^(?:paid (?:time off|holidays?|leave|training)|health insurance|hmo|13th month|performance bonus(?:es)?|work from home|competitive (?:pay|salary|package)|annual leave|sick leave)\b/i,
  // "PLEASE READ CAREFULLY AND FOLLOW THE INSTRUCTIONS BELOW" (1738388) is the
  // preamble to the instructions, not one of them.
  /^follow (?:the |these |all )?instructions?\b/i,
  // "Please note, you earning less or more at previous roles DOES NOT ..."
  // (1723086) is reassurance about the ask above it.
  /^(?:please\s+)?note\s*(?:,|that\b)/i,
  // "There isn't one exact answer." (1739053) and "That is why we are willing to
  // wait for the right one" (1717381) - commentary that followed the asks.
  /^there\b/i,
  /^that (?:is|was|'s)\b/i,
  // What the employer will do next: "Candidates who appear to be a strong fit
  // will be invited to complete our formal application" (1717381), "Training and
  // script will be provided upon onboarding" (1688416).
  /\bwill be (?:provided|given|invited|shared|sent|scheduled|contacted)\b/i,
  // "IMPORTANT:* Australian bookkeeping experience and Xero experience are
  // *non-negotiable requirements for this role" (1738388) states a requirement.
  // "IMPORTANT: please include your hourly rate" keeps its verb and survives.
  new RegExp(`^\\*?important\\*?\\s*:?\\s*(?![^.]*\\b(?:${ASK_VERBS})\\b)`, 'i'),
  // "If you have any questions, feel free to reach out." (1738932)
  /^if you have any questions/i,
  // The marketing close, "If you are smart, organized, persistent ... we want to
  // hear from you" (1739053). "If you are interested, please send your resume"
  // (1739039) is a real ask and keeps its verb, so it survives this.
  new RegExp(`^if you (?:are|think|feel|believe)\\b(?![^.]*\\b(?:${ASK_VERBS})\\b)`, 'i'),
];

// A question that sells the role rather than asking for the applicant's own
// facts. "Do you thrive in a fast-paced environment?" (1729617) and "Are you a
// fast-moving, detail-oriented and tech-savvy executor?" (1739011) are the
// post's opening hook; answering them in a cover letter is wasted space.
const RHETORICAL =
  /\b(?:thriv\w+|passionate|dream|sounds? like you|feel like|capable of more|tired of|ready to (?:join|take|grow|level)|enjoy being|love (?:being|working|the idea)|want to (?:build|grow|join|be part)|is this you|does this sound|if (?:this|that) sounds|what['’]?s in it for you)\b/i;

// A real question opens with an interrogative, an auxiliary or a request verb.
// "You're good with people ... doesn't fit neatly into a CV?" (1733471) is a
// statement wearing a question mark.
const QUESTION_START =
  /^(?:who|what|whats|what's|when|where|why|how|which|whose|do|does|did|are|is|was|were|have|has|had|can|could|would|will|shall|should|may|might|tell|describe|explain|share|walk|give|list|confirm|send|any)\b/i;

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
  // A thing to send is never a heading. "Your CV" used to read as a title, and
  // because a heading ENDS the list it took "Your hourly rate" and "Your
  // availability" down with it - the whole checklist for 55 characters of post.
  if (/^your\b/i.test(t) || DELIVERABLE.test(t)) return false;
  if (new RegExp(`^(?:${ASK_VERBS})\\b`, 'i').test(t)) return false;
  const words = t.split(/\s+/);
  if (words.length > 7) return false;
  const allCaps = t === t.toUpperCase() && /[A-Z]/.test(t);
  const titleCase = words.every(
    (w) => !/^[a-z]/.test(w) || HEADING_STOPWORDS.has(w.toLowerCase())
  );
  return allCaps || titleCase;
}

// A heading that opens a second block of asks: it looks like a heading AND names
// the application or a submission. Checked before the plain heading test, so
// "REQUIREMENTS TO SEND" opens a list where "Required Skills" still closes one.
function opensSecondBlock(line: string): boolean {
  if (!looksLikeHeading(line)) return false;
  const t = line.trim().replace(/^[#*_>\s]+/, '').replace(/[#*_:\s]+$/, '');
  if (!STRONG_HEADING.test(t)) return false;
  // "DO NOT APPLY IF:" (1723086) heads a list of disqualifiers. Opening it made
  // "If you have a conflicting job that interferes with this schedule" a thing
  // to answer.
  if (/\b(?:do not|don'?t|never|no longer)\b/i.test(t)) return false;
  // "Required Skills" / "Technical Requirements" are job description headings:
  // a bare requirement word is not enough, it needs a sending word with it.
  if (/^[\w\s&-]*requirements?$/i.test(t) && !/\b(?:send|submit|appl|include)/i.test(t)) return false;
  return true;
}

function clean(s: string): string {
  return s
    .replace(/\s+/g, ' ')
    // Strip a leading LIST MARKER only. The old pattern ate any leading digits,
    // which turned "2-3 live URLs or GitHub repos" into "live URLs" and lost the
    // quantity the employer actually asked for.
    // Every alternative here ends in real punctuation or real whitespace. An
    // optional-everything roman numeral ("[ivx]{1,3}\s*\.?\)?") matched the bare
    // "I" of "Include the words BLUE CACTUS ..." and ate it.
    .replace(/^\s*(?:[-*•‣▪·>–—]{1,3}\s+|[-–—>]{1,3}(?=[A-Za-z0-9])|\d{1,2}\s*[.)\]]\s+|\d{1,2}\s*[-–—]\s+|[a-z]\s*\.?\)\s*|[ivx]{1,3}\s*[.)]\s+)/i, '')
    // Markdown bold/italic/heading marks around an item, e.g. "**IMPORTANT: ...**"
    .replace(/^[#*_]+/, '')
    .replace(/[*_]+$/, '')
    .replace(/[.:;!]+$/, '')
    // "attach your updated CV and include your expected salary in the email)":
    // the opening bracket was in the part of the sentence this ask starts after.
    .replace(/\)+$/, (m, _i, whole) => ((whole.match(/\(/g) || []).length ? m : ''))
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

// Sentence split that survives the abbreviations real posts are full of, so
// "How many years have you worked in U.S. real estate?" stays one question.
const ABBREV = /\b(?:U\.S|U\.K|E\.U|i\.e|e\.g|etc|vs|Mr|Mrs|Ms|Dr|Prof|St|Inc|Ltd|Co|approx|No|Fig|a\.m|p\.m|Ph\.D)\./gi;
const DOT = '\u0001';
function splitSentences(line: string): string[] {
  const guarded = line.replace(ABBREV, (m) => m.replace(/\./g, DOT));
  return guarded
    .split(/(?<=[.!?])[\s]+/)
    .map((s) => s.split(DOT).join('.').trim())
    .filter(Boolean);
}

// Real posts wrap a single item across two lines: 1723086 breaks "If you have
// GHL experience (subaccounts, pipelines, workflows, automations, follow-up
// sequences," from ", calendars and tags), please write "GHL exp" at top of
// email", and the half that carried the instruction was never seen. Join a line
// that is plainly unfinished to the next one.
function unwrap(lines: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    for (let guard = 0; guard < 3; guard++) {
      const opens = (line.match(/\(/g) || []).length > (line.match(/\)/g) || []).length;
      if (!/,\s*$/.test(line) && !opens) break;
      let j = i + 1;
      while (j < lines.length && !lines[j].trim()) j++;
      const next = j < lines.length ? lines[j] : '';
      // Only join a continuation: a lowercase word, or a closing bracket.
      if (!next || !/^[a-z)]/.test(next.trim())) break;
      if (BULLET_MARKER.test(next) || looksLikeHeading(next)) break;
      line = line.trimEnd() + ' ' + next.trim();
      i = j;
    }
    out.push(line);
  }
  return out;
}

// Words that make an "ask" meaningless on its own.
const TOO_VAGUE = /^(?:your|the|a|an|and|or|please|thanks?|thank you|apply|application)$/i;

// The prompt is a checklist, not a transcript, but the checklist has to hold
// every instruction. 1724400 asks for 23 separate things across three blocks,
// and at a cap of 12 the items that fell off were "What monthly compensation are
// you seeking?" and "provide two professional references". The cap now trims the
// END of the post rather than whichever rule happened to run last, so it has to
// be generous enough for a genuinely long post.
const MAX_ASKS = 24;

// Where a candidate came from. A list item is the employer's own wording; an
// inline fragment is a clause pulled out of a sentence, so when the two overlap
// the list item wins. Without that, "note what was built with Elementor vs.
// custom code)" overwrote "Links to 3 websites you personally built ..." on
// 1587417 and the portfolio ask disappeared.
const FROM_ITEM = 0;
const FROM_QUESTION = 1;
const FROM_INLINE = 2;

type Cand = { text: string; order: number; from: number };

export function extractAsks(description: string): string[] {
  const text = clampPost(description || '');
  const lines = unwrap(text.split(/\r?\n/));
  const cands: Cand[] = [];

  // Returns false when the line was rejected, which the list loop uses to notice
  // that the list has ended.
  const push = (s: string, order: number, from: number): boolean => {
    const v = clean(s);
    // 200, not 140: "Details on at least 1 AI integration project you built
    // (explain what model/API you used, what the workflow did, and how you
    // handled the integration)" is 147 characters and is a real ask.
    if (v.length < 2 || v.length > 200) return false;
    if (TOO_VAGUE.test(v)) return false;
    if (NEGATIVE_ASK.test(v)) return false;
    if (NOISE.some((re) => re.test(v))) return false;
    // Tested on the RAW text, not the cleaned one: clean() strips the trailing
    // period, and without it "Send your CV." is three title-case words and looks
    // exactly like a heading.
    if (looksLikeHeading(s)) return false;
    const lv = v.toLowerCase();
    for (let i = 0; i < cands.length; i++) {
      const c = cands[i];
      const la = c.text.toLowerCase();
      if (la === lv) {
        if (from < c.from) cands[i] = { text: v, order: Math.min(order, c.order), from };
        return true;
      }
      // The same instruction often reaches here twice, once from the inline
      // path and once as an item in the list below its heading. Prefer the more
      // faithful source, and only then the shorter text: a trailing
      // parenthetical is a substring of its item but it is not the ask.
      if (la.includes(lv)) {
        if (from < c.from) cands[i] = { text: v, order: c.order, from };
        return true;
      }
      if (lv.includes(la)) {
        if (from <= c.from) cands[i] = { text: v, order: c.order, from };
        return true;
      }
    }
    cands.push({ text: v, order, from });
    return true;
  };

  // A trigger line or a section heading opens a list: collect what follows.
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const sectionMatch = line.match(SECTION);
    const isSection = !!sectionMatch || opensSecondBlock(line);
    const hasTrigger = TRIGGERS.test(line);
    const imperative = isImperativeAsk(line);
    if (!isSection && !hasTrigger && !imperative) continue;

    // A heading and a line ending in a colon introduce the asks; they are not
    // asks themselves. "Please also briefly explain one system you have built"
    // is, so keep that. A SECTION heading opens a list whether or not it carries
    // a colon: a bare "HOW TO APPLY" line is exactly that, and requiring the
    // colon meant the instructions under it were never read.
    const opensList = isSection || OPENS_LIST.test(line);
    const inline = inlineAsk(line, sectionMatch, imperative);
    // A heading line can still carry the instruction itself: "To apply, send
    // your CV." is 23 characters, is the whole of what some posts say, and used
    // to be discarded as a heading with nothing after it.
    if (inline) push(inline, i, FROM_INLINE);

    // "At the bottom of the email, write the USD hourly rate ... of your last two
    // roles listed on resume. For example:" (1723086) is followed by "-Most
    // recent role: $5/hour (USD)". That is the employer's illustration, not two
    // more things to send. The instruction itself came through inline above.
    if (/\b(?:for example|for instance|e\.g\.|example|sample answer)\s*:\s*$/i.test(line)) continue;

    let sawBullet = false;
    let rejected = 0;
    for (let j = i + 1; j < Math.min(i + 40, lines.length); j++) {
      const item = lines[j];
      if (item.trim() === '') continue;

      // "For example:" inside a list introduces the employer's own illustration:
      // 1723086 follows it with "-Most recent role: $5/hour (USD)", which is not
      // a thing to send. The line itself usually carries the instruction the
      // example illustrates ("At the bottom of the email, write the USD hourly
      // rate of your last two roles. For example:"), so keep that and stop.
      const example = /\s*\b(?:for example|for instance|e\.g\.|sample answer)\s*:\s*$/i;
      if (example.test(item)) {
        const bullet = item.match(BULLET_MARKER);
        push(firstSentence((bullet ? bullet[1] : item).replace(example, '')), j, FROM_ITEM);
        break;
      }

      const m = item.match(BULLET_MARKER);
      if (m) {
        sawBullet = true;
        // A bullet can be a sub-heading rather than an item: 1738932 writes
        // "3. In the email, include:" and then lists a.) to f.) under it. Pushing
        // that as an ask hands the writer an opener and loses the six items.
        if (!(OPENS_LIST.test(m[1]) && m[1].trim().split(/\s+/).length <= 8)) {
          push(firstSentence(m[1]), j, FROM_ITEM);
        }
        continue;
      }

      // A bulleted list ends at the first unmarked line. Without this, the
      // "Thanks!" after a list of bullets became an ask.
      //
      // Only for a list that was opened by a bare trigger, though. Where a colon
      // or a heading opened it, the items alternate marker and text: 1739053
      // numbers each topic as a heading ("3. Deal Experience") and puts the
      // instruction on the line below it ("Describe one actual real estate deal
      // you personally helped find, analyze, negotiate or acquire."), so
      // stopping at the first unmarked line lost three of its seven questions.
      // The NOISE filters, not this break, are what keep the closing paragraph
      // out.
      if (sawBullet && !opensList) break;

      // A new heading or another "please provide:" ends this list. A recognised
      // section opens its own, which this same loop reaches on a later pass; an
      // unrecognised one ("HOW WE HIRE") just stops the collecting, so their
      // hiring process does not become a list of things to answer. Nothing
      // already collected is discarded - the list simply stops here.
      // A short colon line INSIDE an open list is a nested opener, not the end
      // of the list: "b.) Answer the following question:" and "f.) Screenshot
      // of:" (1738932) each introduce what comes next, and breaking there lost
      // the mandatory question and both screenshots.
      if (!SECTION.test(item) && !looksLikeHeading(item) && OPENS_LIST.test(item) &&
          item.trim().split(/\s+/).length <= 8) continue;

      if (SECTION.test(item) || OPENS_LIST.test(item) || looksLikeHeading(item)) break;

      // "(Applications missing live samples will not be reviewed.)" is a note
      // about the list, not another item in it.
      if (PARENTHETICAL.test(item)) continue;

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
      const words = item.trim().split(/\s+/).length;
      if (opensList && words >= 2) {
        // Two rejected lines in a row mean the list is over and the post has gone
        // back to talking. Without this the collector ran to the end of 1739052
        // and offered "Intial part time role to begin" as something to answer.
        rejected = push(firstSentence(item), j, FROM_ITEM) ? 0 : rejected + 1;
        if (rejected >= 2) break;
        continue;
      }

      break; // the list has ended
    }
  }

  // Direct questions anywhere in the post. Split PER LINE: splitting the whole
  // post on "?" made the first chunk run from the top of the post to the first
  // question mark, so the first question in a post was always either dropped for
  // length or glued to the paragraph above it. Three mandatory questions were
  // lost that way (1739052, 1738932, 1724400).
  for (let i = 0; i < lines.length; i++) {
    for (const sentence of splitSentences(lines[i])) {
      const s = clean(sentence).trim();
      if (!sentence.trim().endsWith('?')) continue;
      if (s.length <= 12 || s.length > 160) continue;
      // Leading punctuation first: 1738932 writes the one question it requires an
      // answer to as "--What's one admin or creative tool you love using and
      // why?", and the dashes made it fail the interrogative test.
      if (!QUESTION_START.test(s.replace(/^[^A-Za-z]+/, ''))) continue;
      if (RHETORICAL.test(s)) continue;
      push(sentence, i, FROM_QUESTION);
    }
  }

  return cands
    .sort((a, b) => a.order - b.order || a.from - b.from)
    .slice(0, MAX_ASKS)
    .map((c) => c.text);
}

// A bare imperative line, tightly gated. With a colon it is a list opener
// ("Then answer the following:", "Tell us:"); without one it has to name both
// the applicant and something an applicant sends, or the responsibilities list
// ("Provide customer support via email, chat, and SMS") becomes a checklist.
function isImperativeAsk(line: string): boolean {
  if (!IMPERATIVE.test(line)) return false;
  const t = line.trim();
  const words = t.split(/\s+/).length;
  if (OPENS_LIST.test(t)) return words <= 12;
  if (words > 40) return false;
  return /\b(?:your|you|us|me)\b/i.test(t) && APPLY_OBJECT.test(t);
}

// The ask carried by the trigger line itself, or null when the line only
// introduces a list.
function inlineAsk(
  line: string,
  sectionMatch: RegExpMatchArray | null,
  imperative: boolean
): string | null {
  const t = line.trim();

  // "please make sure to attach your updated CV and include your expected
  // salary": the ask starts at the verb, whatever sits between it and "please".
  // The words in between are checked for a negation, because "Please do not
  // apply if you have not worked with Simpro before" otherwise arrives here as
  // "apply if you have not worked with Simpro before" - an instruction to do
  // the opposite of what it says.
  const please = t.match(new RegExp(`(?:please|kindly)\\s+((?:\\w+[\\s,]+){0,3}?)((?:${VERBS})\\b.*)$`, 'i'));
  if (please) {
    if (/\b(?:not|never|n't|nt|only|avoid|dont)\b/i.test(please[1])) return null;
    return keepIfSubstantial(please[2]);
  }

  // "To apply, send your CV and your hourly rate." The heading words are a
  // prefix, not the whole line.
  if (sectionMatch) {
    const rest = t.slice(sectionMatch[0].length);
    // "How to Apply (Screening Checklist):" - a parenthetical qualifier on the
    // heading, not an instruction.
    if (/^\s*\(/.test(rest)) return null;
    const body = rest.replace(/^[\s:,.\-–—]+/, '').trim();
    if (!body) return null;
    // Only when the remainder actually instructs: an ask verb, something of the
    // applicant's, or a shouted token to reproduce ("TO APPLY CODE: XYZ123").
    const instructs =
      new RegExp(`\\b(?:${ASK_VERBS})\\b`, 'i').test(body) ||
      /\byour\b/i.test(body) ||
      /\b[A-Z][A-Z0-9][A-Z0-9-]{2,}\b/.test(body);
    return instructs ? keepIfSubstantial(body) : null;
  }

  // "IMPORTANT: Applying on this job platform DOES NOT complete your
  // application. To apply, complete our application form here:" (1739011) - the
  // instruction is a clause in the middle of the line, and the line ends in a
  // colon introducing nothing this loop can read. Applying on the platform does
  // not count for that employer, so losing this ask loses the job outright.
  const mid = t.match(/\b(?:to apply|when applying|to be considered)\b[\s,:-]*(.+)$/i);
  if (mid) {
    const clause = mid[1].replace(/:\s*$/, '').trim();
    const instructs =
      new RegExp(`^(?:${ASK_VERBS})\\b`, 'i').test(clause) || APPLY_OBJECT.test(clause);
    if (instructs) return keepIfSubstantial(clause);
  }

  if (OPENS_LIST.test(t)) {
    // A colon-terminated instruction that names the applicant is an ask as well
    // as an opener: "Tell us specifically which of these you have used:"
    // (1739053) introduces six tool names and is the only line that says what to
    // do with them.
    if (imperative && /\b(?:your|us|me)\b/i.test(t) && t.split(/\s+/).length >= 5) {
      return keepIfSubstantial(t.replace(/:\s*$/, ''));
    }
    return null;
  }

  // "In your application, tell us your rate" / "When applying, send your CV".
  const placed = t.match(new RegExp(`^[#*_>\\s]*(?:in (?:your|the) ${PLACE}|when applying|to be considered)\\b[\\s,:-]*(.*)$`, 'i'));
  if (placed && placed[1]) return keepIfSubstantial(placed[1]);

  if (imperative) return keepIfSubstantial(t);
  return null;
}

function keepIfSubstantial(s: string): string | null {
  const t = s.trim();
  if (t.length <= 12) return null;
  if (new RegExp(`^(?:${VERBS})\\s*:?$`, 'i').test(t)) return null;
  // A bare opener names no ask: "Please answer these questions:" (1738987) and
  // "please include the following in your proposal:" introduce the list, they
  // are not the first item in it.
  if (new RegExp(
    `^(?:${VERBS})\\s+(?:the |these |this |those |all |your |us |me )*(?:following|questions?|below|items?|details?|information|list)\\b(?:\\s+(?:below|in (?:your|the) [\\w -]{3,20}))?[\\s:.]*$`,
    'i'
  ).test(t)) return null;
  if (NEGATIVE_ASK.test(t)) return null;
  return firstSentence(t);
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
  // Key handling is answered by naming WHERE the key lives, which shares almost
  // no words with the question. "Your typical workflow for keeping third-party
  // API keys secure" against "the key stays server side behind a backend route"
  // scored 2 words of 13 and was reported unanswered, which buys a repair call
  // and tells the model to answer something it already answered well.
  [/\b(api keys?|credentials?|secrets?|tokens?)\b/,
   /\b(server[- ]?side|environment variable|env var|\.env|wp-config|wp_remote|backend route|backend|never (?:expose|exposed|in the browser)|not exposed|vault|secret manager|rest (?:route|endpoint)|proxy|sanitiz)\b/i],
];

// "Your estimated timeline for a 3-phase build" is only answered by a DURATION.
// Checked before the synonyms, and separately from QUANTITY_ASK, because a bare
// number is not enough: the real reply said "moving through the three phases
// back to back", which puts the number "three" in the same sentence as "phases"
// and passed every looser test while telling the employer nothing about when
// anything lands. A timeline needs a unit of time attached.
// An ask that demands actual ADDRESSES: "2-3 Live URLs or GitHub repos", "send
// links to work you shipped". Naming the projects is not answering it, and this
// is a stated gate on real posts ("Applications missing live project samples will
// not be reviewed"). A real application named three of his own projects and gave
// no address for any of them; it was caught only because the generic word
// overlap happened to fall below half, which is luck, not a check.
const URL_ASK =
  /\b(?:urls?|links?|repos?|repositor(?:y|ies)|github|gitlab|live (?:sites?|examples?|samples?|projects?|work)|portfolio links?|website links?)\b/i;
// A URL anywhere in the body. The sign-off block carries the portfolio and
// resume on every letter, so those two cannot count as project samples: an ask
// for live work has to be answered by something other than the boilerplate.
const ANY_URL = /\b(?:https?:\/\/|www\.)\S+|\b[a-z0-9][a-z0-9-]*\.(?:com|ph|net|org|io|dev|app|store|co|ai)\b/gi;
const BOILERPLATE_URL = /dlvasolutions\.com/i;
// Library names are dotted too, and "Socket.io real-time sessions" read as a
// live project link, which let a letter with no addresses at all pass. A bare
// dotted name counts only when it is not one of these; anything with a scheme,
// "www." or a path is unambiguous and is never tested against it.
const NOT_A_SITE =
  /\.js$|^(?:socket|node|next|nuxt|vue|express|three|d3|chart|moment|jquery|react|angular|ember|backbone|nest|remix|deno|bun|rx)\.(?:io|js|net|dev)$/i;

const TIMELINE_ASK =
  /\b(timeline|time ?frame|turnaround|how (?:long|soon)|when (?:can|could|would) you|deadline|eta|delivery date|lead time)\b/i;
const DURATION =
  /\b\d+\s*(?:-|to|–)?\s*\d*\s*(?:hour|day|week|month|year)s?\b|\b(?:a|one|two|three|four|five|six|eight|ten|twelve)\s+(?:hour|day|week|month|year)s?\b|\b(?:same|next)[- ]day\b|\bwithin\s+(?:a|\d+)\s+(?:hour|day|week|month)s?\b/i;

// An ask that names a quantity is only answered by a quantity. "How many hours
// per week are you looking for?" used to pass on a reply that said "I am
// available whenever you need me", because the availability synonym matched a
// word and never looked for the number.
const QUANTITY_ASK = /\bhow (?:many|much|long)\b|\bnumber of\b|\b(?:license|licence|id|phone|contact) number\b|\d+\s*,\s*\d+|\bhours?\b/i;
const NUMBER =
  /\d|\b(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|sixty|hundred|dozen)\b/i;

// True when the reply states a number in the same sentence as the topic, which
// is how a real answer reads ("I am available 20 hours a week", "5 years in
// U.S. real estate"). A digit somewhere else in the letter proves nothing.
function numberNear(reply: string, words: string[]): boolean {
  if (words.length === 0) return NUMBER.test(reply);
  for (const sentence of reply.split(/(?<=[.!?\n])\s+/)) {
    if (!NUMBER.test(sentence)) continue;
    const s = sentence.toLowerCase();
    if (words.some((w) => s.includes(w))) return true;
  }
  return false;
}

export function unansweredAsks(asks: string[], reply: string): string[] {
  const body = (reply || '').toLowerCase();
  return asks.filter((ask) => {
    // A quantity is demanded before anything else, because the topic words are
    // the easy half: "I am available whenever you need me" satisfies every word
    // in "How many hours per week are you looking for?" and answers none of it.
    // A timeline is judged first and on its own terms, because the synonym rule
    // below returns on the first topic it recognises: "weekly availability AND
    // estimated timeline" was marked answered by the availability half alone and
    // the timeline half was never looked at, which is how a real application went
    // out telling the employer nothing about when the build would land.
    // An address ask needs an address, and not the one at the bottom of every
    // letter. Checked before the synonyms, which would otherwise be satisfied by
    // the word "portfolio" in the sign-off block.
    if (URL_ASK.test(ask)) {
      const urls = (reply || '').match(ANY_URL) || [];
      const real = urls.filter((u) => {
        if (BOILERPLATE_URL.test(u)) return false;
        // A scheme, "www." or a path makes it unmistakably an address.
        if (/^https?:\/\/|^www\.|\//.test(u)) return true;
        return !NOT_A_SITE.test(u);
      });
      if (real.length === 0) return true;
      // Addresses are there, which is the part that can be checked; whether they
      // demonstrate the right thing is the writer's job, not a regex's. Return
      // here rather than falling through to the generic word overlap, which
      // flagged a letter carrying three real project links because it shared
      // fewer than half its words with a long ask.
      for (const [topic, answered] of SYNONYMS) {
        if (topic.test(ask.toLowerCase())) return !answered.test(body);
      }
      return false;
    }
    if (TIMELINE_ASK.test(ask)) {
      // Only a DURATION answers it. A bare number is not enough: the real reply
      // said "moving through the three phases back to back", putting "three"
      // beside "phases" and satisfying every looser test while saying nothing.
      if (!DURATION.test(body)) return true;
      // The duration is there. A compound ask names a second topic too ("weekly
      // availability AND estimated timeline"), so check that half as well rather
      // than letting either half stand for both.
      for (const [topic, answered] of SYNONYMS) {
        if (topic.test(ask.toLowerCase())) return !answered.test(body);
      }
      return false;
    }
    if (QUANTITY_ASK.test(ask) && !numberNear(body, keyWords(ask))) return true;
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
