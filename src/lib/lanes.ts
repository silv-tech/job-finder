import { detectRole, type RoleKey } from '@/lib/roles';

// The four kinds of job the applicant actively wants, each searched on its own
// and written with its own role playbook. Scoring lives here rather than in the
// profile's skills array, so a score means the same thing every run and can be
// tested without a database.

export const LANE_KEYS = ['developer', 'automations', 'management', 'exec_assistant', 'general_va'] as const;
export type LaneKey = (typeof LANE_KEYS)[number];

export interface Lane {
  key: LaneKey;
  label: string;
  role: RoleKey;
  // What to type into the onlinejobs.ph search box for this lane.
  searches: string[];
  // A hit is one distinct capability the post asks for that the applicant has.
  signals: RegExp[];
  // Words that, in the TITLE, say the post really is this kind of job.
  titleSignals: RegExp[];
  // Below this, don't spend a point.
  minScore: number;
}

export const LANES: Record<LaneKey, Lane> = {
  developer: {
    key: 'developer',
    label: 'Developer / Coding',
    role: 'developer',
    searches: ['web developer', 'full stack developer', 'javascript developer', 'ai automation developer'],
    signals: [
      // Claude and AI work counts as his developer skillset, not a separate thing.
      /\bclaude\b/, /\banthropic\b/, /\bopenai\b/, /\bchatgpt\b/, /\bgpt-?4?\b/, /\bllm\b/,
      /\bai agents?\b/, /\bchatbots?\b/, /\bai automation\b/, /\bprompt engineering\b/,
      /\bjavascript\b/, /\btypescript\b/, /\bnode(\.js)?\b/, /\breact\b/, /\bnext\.?js\b/,
      /\bexpress\b/, /\bhtml\b/, /\bcss\b/, /\btailwind\b/, /\bsupabase\b/, /\bfirebase\b/,
      /\bpostgres(ql)?\b/, /\bsql\b/, /\bredis\b/, /\bdocker\b/, /\bgit(hub)?\b/,
      /\bapis?\b/, /\brest api\b/, /\bwebhooks?\b/, /\bintegrations?\b/,
      /\bfull[- ]?stack\b/, /\bfront[- ]?end\b/, /\bback[- ]?end\b/, /\bweb apps?\b/,
      /\be-?commerce\b/, /\bshopify\b/, /\bwordpress\b/, /\bwoocommerce\b/, /\bphp\b/, /\bpython\b/,
      /\bdeploy(?:ment|ing)?\b/, /\bhosting\b/, /\bcpanel\b/, /\bvercel\b/, /\bnetlify\b/, /\brailway\b/,
      /\bscraping\b/, /\bautomation\b/,
    ],
    titleSignals: [
      /\bdevelopers?\b/, /\bprogrammer\b/, /\bcoder\b/, /\bsoftware engineer\b/, /\bweb ?dev\b/,
      /\bfull[- ]?stack\b/, /\bfront[- ]?end\b/, /\bback[- ]?end\b/, /\bautomation\b/, /\bai\b/,
    ],
    minScore: 60,
  },

  automations: {
    key: 'automations',
    label: 'Automations',
    role: 'automation',
    searches: ['automation', 'zapier automation', 'n8n automation', 'ai automation specialist'],
    signals: [
      /\bzapier\b/, /\bmake\.com\b/, /\bintegromat\b/, /\bn8n\b/, /\bgo ?high ?level\b/, /\bghl\b/,
      /\bairtable\b/, /\bapps script\b/, /\bno-?code\b/, /\blow-?code\b/, /\bworkflows?\b/,
      /\bautomat(?:e|ed|ion|ions)\b/, /\bintegrations?\b/, /\bwebhooks?\b/, /\bapis?\b/, /\bzaps?\b/,
      /\bai agents?\b/, /\bchatbots?\b/, /\bclaude\b/, /\bopenai\b/, /\bgpt-?4?\b/, /\bllm\b/,
      /\bprompt engineering\b/, /\bcrm\b/, /\bhubspot\b/, /\bpipedrive\b/, /\bscraping\b/,
      /\bscripts?\b/, /\bnode(\.js)?\b/, /\bpython\b/, /\bgoogle sheets\b/, /\bdata pipeline\b/,
    ],
    titleSignals: [
      /\bautomation\b/, /\bautomate\b/, /\bintegration\b/, /\bzapier\b/, /\bn8n\b/, /\bmake\b/,
      /\bworkflow\b/, /\bai\b/, /\bops\b/, /\bno-?code\b/,
    ],
    minScore: 60,
  },

  management: {
    key: 'management',
    label: 'Management',
    role: 'management',
    searches: ['operations manager', 'team manager', 'project manager'],
    // Deliberately narrow. Words like "team", "process", "training" and
    // "deadlines" appear in almost every job post, so counting them passed 20
    // of 23 fresh listings and turned this lane into a sprayer. A hit here has
    // to mean the job actually runs people or operations, not that it mentions
    // a team in passing.
    signals: [
      /\bmanage (?:a|the|our|their) team\b/, /\bteam of \d+/, /\bdirect reports?\b/,
      /\bteam lead(?:er)?\b/, /\bsupervis(?:e|or|ing|ion)\b/, /\boversee\b/, /\boversight\b/,
      /\bhir(?:e|ing)\b/, /\bonboard(?:ing)?\b/, /\bkpis?\b/, /\bsops?\b/,
      /\bdelegat(?:e|ion|ing)\b/, /\baccountab(?:le|ility)\b/, /\bperformance (?:review|management)\b/,
      /\bone[- ]on[- ]ones?\b/, /\bheadcount\b/, /\bp&l\b/, /\bbudget\b/, /\bdepartment\b/,
      /\bstaff\b/, /\bchief of staff\b/, /\bintegrator\b/, /\bproject manag/,
      /\bscal(?:e|ing) (?:the|our|a) team\b/, /\bpeople management\b/, /\boperations manager\b/,
      /\bstandard operating procedure/, /\bprocess improvement\b/, /\bteam performance\b/,
    ],
    titleSignals: [
      /\bmanager\b/, /\bmanagement\b/, /\bteam lead(?:er)?\b/, /\bsupervisor\b/, /\bdirector\b/,
      /\bhead of\b/, /\boperations\b/, /\bchief of staff\b/,
    ],
    minScore: 60,
  },

  exec_assistant: {
    key: 'exec_assistant',
    label: 'Executive Assistant / Right Hand',
    role: 'general_va',
    searches: ['executive assistant', 'chief of staff', 'right hand assistant'],
    signals: [
      /\bexecutive assistant\b/, /\bchief of staff\b/, /\bright hand\b/, /\bpersonal assistant\b/,
      /\bceo\b/, /\bfounder\b/, /\bcalendar\b/, /\binbox\b/, /\bemail management\b/, /\bschedul(?:e|ing)\b/,
      /\bmeetings?\b/, /\btravel\b/, /\bfollow[- ]?ups?\b/, /\bcoordinat(?:e|ion|ing)\b/,
      /\bproactive\b/, /\btake things off\b/, /\bpriorit(?:y|ies|ize)\b/, /\bconfidential\b/,
      /\bgatekeep/, /\bminutes\b/, /\bresearch\b/,
    ],
    titleSignals: [
      /\bexecutive assistant\b/, /\bea\b/, /\bchief of staff\b/, /\bright hand\b/,
      /\bpersonal assistant\b/, /\bexecutive\b/,
    ],
    minScore: 60,
  },

  general_va: {
    key: 'general_va',
    label: 'General VA / Data Entry',
    role: 'admin',
    searches: ['virtual assistant', 'data entry', 'admin assistant'],
    signals: [
      /\bvirtual assistant\b/, /\bgeneral va\b/, /\bdata entry\b/, /\badmin(?:istrative)?\b/,
      /\bspreadsheets?\b/, /\bexcel\b/, /\bgoogle sheets\b/, /\bcrm\b/, /\brecords?\b/,
      /\bcustomer (?:service|support)\b/, /\bemail\b/, /\bresearch\b/, /\bdocumentation\b/,
      /\bfiling\b/, /\bdata clean/, /\baccuracy\b/, /\bback office\b/, /\bencoding\b/,
    ],
    titleSignals: [
      /\bvirtual assistant\b/, /\bva\b/, /\bdata entry\b/, /\badmin(?:istrative)?\b/,
      /\bassistant\b/, /\bencoder\b/,
    ],
    minScore: 60,
  },
};

export function isLaneKey(value: unknown): value is LaneKey {
  return typeof value === 'string' && (LANE_KEYS as readonly string[]).includes(value);
}

export interface LaneScore {
  score: number;
  lane: LaneKey;
  roleDetected: RoleKey | null;
  hits: string[];
  titleHit: boolean;
  reason: string;
}

// Score a job against one lane, out of 100.
//   role match    up to 40   the post really is this kind of job
//   capability    up to 48   distinct things it asks for that he can do (8 each)
//   title match      12      the title says so outright
// 60 is the pass mark: roughly a role match plus two or three real capabilities.
export function scoreForLane(
  job: { title?: string; description?: string },
  laneKey: LaneKey,
): LaneScore {
  const lane = LANES[laneKey];
  const title = (job.title || '').toLowerCase();
  const desc = (job.description || '').toLowerCase().slice(0, 8000);
  const text = `${title}\n${desc}`;

  const roleDetected = detectRole(job);
  let score = 0;
  if (roleDetected === lane.role) score += 40;
  else if (roleDetected !== null) score += 15; // a job he'd take, but not this lane

  const hits: string[] = [];
  for (const re of lane.signals) {
    const m = text.match(re);
    if (m) hits.push(m[0]);
  }
  const uniqueHits = [...new Set(hits)];
  score += Math.min(48, uniqueHits.length * 8);

  const titleHit = lane.titleSignals.some((re) => re.test(title));
  if (titleHit) score += 12;

  score = Math.min(100, score);

  const reason = uniqueHits.length
    ? `${lane.label}: ${roleDetected === lane.role ? 'role matches' : roleDetected ? `reads as ${roleDetected}` : 'role unclear'}, asks for ${uniqueHits.slice(0, 6).join(', ')}`
    : `${lane.label}: nothing in the post matches what he does`;

  return { score, lane: laneKey, roleDetected, hits: uniqueHits, titleHit, reason };
}

// Score against every lane and keep the best. Used when a job arrives without a
// lane (a manual scan), so it still gets judged as the kind of job it actually is.
export function bestLane(job: { title?: string; description?: string }): LaneScore {
  return LANE_KEYS
    .map((k) => scoreForLane(job, k))
    .sort((a, b) => b.score - a.score)[0];
}

// --- Apply Points ----------------------------------------------------------

// onlinejobs.ph gives 10 Apply Points a day (verified jobseekers), carryover
// caps at 50, so the balance never exceeds 60. Points are what make an
// application stand out, so the strongest matches get more of them.
export const AP_INCOME_PER_DAY = 10;
export const AP_MAX_BALANCE = 60;

// Never more than 2 on a single application, by his instruction. A marginal
// match still drops to 1, so a weak fit does not cost the same as a strong one.
// At 10 points earned a day, a 2-point ceiling means 5 applications a day is
// the sustainable rate.
export const AP_MAX_PER_APPLICATION = 2;

export function apForScore(score: number): number {
  return score >= 70 ? AP_MAX_PER_APPLICATION : 1;
}
