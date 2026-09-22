// Some posts name a hard requirement and mean it. The GHL/Simpro post said
// "Simpro experience is essential. Please do not apply if you have not worked
// with Simpro before." We applied anyway, spent a point, and told an employer
// who asked us not to. Scoring on keyword overlap cannot see a sentence like
// that, so it is checked separately and it overrides the score.

// Phrases that introduce a genuine gate, with the requirement following.
const GATE_PATTERNS: RegExp[] = [
  /do not apply (?:if you (?:have not|haven't|don't have|do not have)|unless you (?:have|know))\b([^.!?\n]{0,120})/gi,
  /don't apply (?:if you (?:have not|haven't|don't have)|unless you (?:have|know))\b([^.!?\n]{0,120})/gi,
  /only apply if you (?:have|know|are experienced)\b([^.!?\n]{0,120})/gi,
  /\b([A-Za-z0-9.+#/& -]{2,40}?) experience is (?:essential|required|a must|mandatory|non-negotiable)/gi,
  /\bmust have (?:prior |proven |hands[- ]on |direct |solid )?experience (?:with|in|using)\b([^.!?\n]{0,80})/gi,
  /\b(?:experience|proficiency) (?:with|in|using)\b([^.!?\n]{0,80})\bis (?:essential|required|mandatory|a must)/gi,
  /\brequired:\s*([^.!?\n]{0,80})/gi,
];

// Things a gate can name that are not a capability we could ever "lack", or
// that the applicant plainly has. Never disqualify on these.
const NOT_A_BLOCKER =
  /\b(experience|experiences|skill|skills|background|knowledge|english|communication|communicating|written|spoken|fluent|proactive|reliable|organized|organised|detail|details|oriented|attitude|work ethic|internet|connection|computer|laptop|headset|quiet|environment|time|hours|availability|available|remote|full[- ]?time|part[- ]?time|years?|month|degree|education|resume|cv|portfolio|references?|team|player|self|starter|motivated|learn|learning|willing|ability|able|strong|excellent|good|great|solid|basic|advanced|the|a|an|and|or|with|in|using|this|that|it|them|us|you|your|our|before|prior|least|minimum|at)\b/i;

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
  const desc = (description || '').slice(0, 12000);
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
