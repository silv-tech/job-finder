import { clampPost } from '@/lib/prompt-safety';

// Some posts name a hard requirement and mean it. The GHL/Simpro post said
// "Simpro experience is essential. Please do not apply if you have not worked
// with Simpro before." We applied anyway, spent a point, and told an employer
// who asked us not to. Scoring on keyword overlap cannot see a sentence like
// that, so it is checked separately and it overrides the score.

// The bias is towards applying. Lacking experience in a field is not a reason
// to skip: he can learn it, and AI helps him deliver. Only an explicit
// prohibition counts, the kind a person wrote on purpose to keep people out:
// "do not apply if you have not...", "must have experience with...",
// "X experience is essential". A bare list of required skills is NOT a gate,
// which is why there is no pattern for "Required: ..." here: that is usually
// a section heading, and treating it as a gate would skip jobs worth trying.
// Each form below was found on a real post. The word order and the verb vary
// far more than they look like they should: "apply only if" and "only apply if"
// are both common, and a post is as likely to demand "knowledge of" as
// "experience with". A form that is missing here is a post we apply to after it
// asked us not to, which costs points and goodwill.
const GATE_PATTERNS: RegExp[] = [
  // "do not apply if you have not / cannot / are not / do not know ..."
  /do(?:n't| not) apply\s+(?:if you (?:have not|haven't|don't have|do not have|cannot|can't|are not|aren't|do not know|don't know|lack)|unless you (?:have|know|are))\b([^.!?\n]{0,120})/gi,
  // Both word orders of the "only apply" gate.
  /only apply if you (?:have|know|are experienced)\b([^.!?\n]{0,120})/gi,
  /\bapply only if you (?:have|know|are experienced)\b([^.!?\n]{0,120})/gi,
  /\b([A-Za-z0-9.+#/& -]{2,40}?) experience is (?:essential|required|a must|mandatory|non-negotiable)/gi,
  // "must have experience with X", and equally "must have knowledge of X".
  /\bmust (?:have|possess)\s+(?:prior |proven |hands[- ]on |direct |solid |working |strong )?(?:experience|knowledge|proficiency|expertise|familiarity)\s+(?:with|in|using|of|for|on)\b([^.!?\n]{0,80})/gi,
  /\b(?:experience|proficiency|knowledge) (?:with|in|using|of)\b([^.!?\n]{0,80})\bis (?:essential|required|mandatory|a must)/gi,
];

// Things a gate can name that are not a capability we could ever "lack", or
// that the applicant plainly has. Never disqualify on these.
const NOT_A_BLOCKER =
  /\b(experience|experiences|skill|skills|background|knowledge|english|communication|communicating|written|spoken|fluent|proactive|reliable|organized|organised|detail|details|oriented|attitude|work ethic|internet|connection|computer|laptop|headset|quiet|environment|time|hours|availability|available|remote|full[- ]?time|part[- ]?time|years?|month|degree|education|resume|cv|portfolio|references?|team|player|self|starter|motivated|learn|learning|willing|ability|able|strong|excellent|good|great|solid|basic|advanced|the|a|an|and|or|with|in|using|this|that|it|them|us|you|your|our|before|prior|least|minimum|at)\b/i;

// Nationalities, languages and accents get capitalised mid-sentence and so look
// exactly like product names to candidateTerms, but they are not a tool anyone
// "lacks". Whether a post that wants a British accent is a good fit is the lane
// score's job, not a hard gate's, and blocking with the reason "British" would be
// nonsense the user then has to override.
const NOT_A_PRODUCT =
  /^(?:british|american|australian|canadian|irish|scottish|filipino|philippine|us|usa|uk|eu|aussie|native|accents?|spanish|german|french|tagalog|bisaya|cebuano)$/i;

// A requirement worth blocking on looks like a product or platform name.
function candidateTerms(fragment: string): string[] {
  const cleaned = fragment
    .replace(/[(),;:"']/g, ' ')
    .replace(/\b(?:and|or|with|in|using|the|a|an|of|for|to|before|prior|at least|minimum)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return cleaned
    .split(/\s+/)
    // Product names are capitalised mid-sentence, or contain a digit or dot.
    .filter((w) => /^[A-Z][A-Za-z0-9.+#/-]{1,29}$/.test(w) || /^[A-Za-z]+[0-9][A-Za-z0-9]*$/.test(w))
    .filter((w) => !NOT_A_BLOCKER.test(w))
    .filter((w) => !NOT_A_PRODUCT.test(w))
    .map((w) => w.replace(/[.,]+$/, ''))
    .filter((w) => w.length >= 2);
}

export interface Disqualification {
  blocked: boolean;
  missing: string[];
  quote: string;
}

// Returns the named requirements the applicant's background does not mention.
export function checkDisqualifiers(description: string, background: string): Disqualification {
  const desc = clampPost(description || '');
  const mine = (background || '').toLowerCase();
  const missing: string[] = [];
  let quote = '';

  for (const pattern of GATE_PATTERNS) {
    pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(desc)) !== null) {
      const fragment = m[1] || '';
      for (const term of candidateTerms(fragment)) {
        if (!mine.includes(term.toLowerCase()) && !missing.includes(term)) {
          missing.push(term);
          if (!quote) quote = m[0].trim().replace(/\s+/g, ' ').slice(0, 160);
        }
      }
    }
  }

  return { blocked: missing.length > 0, missing, quote };
}
