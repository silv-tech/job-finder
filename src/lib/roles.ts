// The kinds of jobs the applicant usually targets. Each application is written
// with one of these as its focus.
export const ROLE_KEYS = ['developer', 'management', 'automation', 'general_va', 'admin'] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

export const ROLE_LABELS: Record<RoleKey, string> = {
  developer: 'Developer',
  management: 'Management',
  automation: 'Automation',
  general_va: 'General VA',
  admin: 'Admin',
};

// Per-role proof points pulled from the resume + portfolio. `_source` is a
// fingerprint of what they were generated from, so they refresh when the
// resume or portfolio changes; `_edited` means the user changed them by hand
// and they must not be overwritten automatically.
export type RoleHighlights = Partial<Record<RoleKey, string>> & {
  _source?: string;
  _edited?: boolean;
};

// --- Detecting which kind of role a job is ---------------------------------

const ROLE_SIGNALS: Record<RoleKey, RegExp[]> = {
  developer: [
    /\bdevelopers?\b/, /\bweb development\b/, /\bsoftware development\b/, /\bprogrammer\b/, /\bcoder\b/,
    /\bsoftware engineer\b/, /\bweb ?dev\b/, /\bfull[- ]?stack\b/, /\bfront[- ]?end\b/, /\bback[- ]?end\b/,
    /\bhtml\b/, /\bcss\b/, /\bjavascript\b/, /\btypescript\b/, /\breact\b/, /\bnext\.?js\b/,
    /\bnode(\.js)?\b/, /\bphp\b/, /\bpython\b/, /\blaravel\b/, /\bwoocommerce\b/, /\bweb apps?\b/,
    /\bplugins?\b/, /\bsql\b/, /\bsupabase\b/, /\bfirebase\b/, /\bgit(hub)?\b/, /\bcpanel\b/,
    /\bdebug(?:ging)?\b/, /\bcoding\b/, /\bpayment (?:gateway|integration)\b/,
  ],
  management: [
    /\bmanag(?:er|ement|ing)\b/, /\bteam lead(?:er)?\b/, /\bhead of\b/, /\bsupervis(?:or|e|ing)\b/,
    /\bdirector\b/, /\boperations\b/, /\bops\b/, /\bchief of staff\b/, /\bproject manager\b/,
    /\blead (?:a|the|our) team\b/, /\bhir(?:e|ing) and train/, /\bkpis?\b/, /\bpeople management\b/,
    /\boversee\b/, /\bgeneral manager\b/, /\bintegrator\b/,
  ],
  automation: [
    /\bautomat(?:e|ion|ions|ed)\b/, /\bzapier\b/, /\bmake\.com\b/, /\bintegromat\b/, /\bn8n\b/,
    /\bworkflows?\b/, /\bintegrations?\b/, /\bapis?\b/, /\bgo ?high ?level\b/, /\bghl\b/, /\bairtable\b/,
    /\bapps script\b/, /\bai agents?\b/, /\bchatbots?\b/, /\bwebhooks?\b/, /\bno-?code\b/, /\blow-?code\b/,
  ],
  general_va: [
    /\bvirtual assistant\b/, /\bgeneral va\b/, /\bva\b/, /\bexecutive assistant\b/, /\bpersonal assistant\b/,
    /\bsocial media\b/, /\bresearch\b/, /\bcustomer (?:service|support)\b/, /\bemail management\b/,
    /\bvarious tasks\b/, /\bright hand\b/,
  ],
  admin: [
    /\badmin(?:istrative|istrator)?\b/, /\bdata entry\b/, /\bbookkeeping\b/, /\bcalendar\b/, /\binbox\b/,
    /\bscheduling\b/, /\bdocumentation\b/, /\bspreadsheets?\b/, /\bexcel\b/, /\bgoogle sheets\b/,
    /\bfiling\b/, /\brecords?\b/, /\bback office\b/, /\bcrm updates?\b/,
  ],
};

// Title words count 3x: "Operations Manager" is a management job even if the
// description mentions spreadsheets.
export function detectRole(job: { title?: string; description?: string }): RoleKey | null {
  const title = (job.title || '').toLowerCase();
  const desc = (job.description || '').toLowerCase().slice(0, 8000);
  let best: RoleKey | null = null;
  let bestScore = 0;
  for (const key of ROLE_KEYS) {
    let score = 0;
    for (const re of ROLE_SIGNALS[key]) {
      if (re.test(title)) score += 3;
      if (re.test(desc)) score += 1;
    }
    if (score > bestScore) {
      best = key;
      bestScore = score;
    }
  }
  return bestScore >= 2 ? best : null;
}

export function isRoleKey(value: unknown): value is RoleKey {
  return typeof value === 'string' && (ROLE_KEYS as readonly string[]).includes(value);
}

// --- What each kind of hiring manager is looking for ------------------------

export const ROLE_PLAYBOOKS: Record<RoleKey, string> = {
  developer: `This is a DEVELOPER / WEB DEVELOPMENT role. The person hiring wants proof the applicant can build the thing and get it live, not a list of languages.
- Lead with what they have actually built and delivered: the project, what it does, the stack it was built in, and its real scale or result from the sources (for example a product catalogue, a cart, or a working payment flow).
- Name the languages, frameworks and tools from the post that the applicant really uses. Do not pad with anything the sources do not show.
- Show that they own the whole thing: the front end, the back end, deploying it and keeping it running. For a small employer that is worth more than any single framework.
- If the post names a platform, CMS or framework the applicant has not used, do NOT raise it and do NOT apologise for it. Lead with the closest real work instead (hand-built sites, custom layouts and themes, their own deployments) and let the delivered projects answer it.
- Concrete and plain. No "passionate about clean code", no buzzword stacks, and never claim years of experience the sources do not state.`,
  management: `This is a MANAGEMENT role. The person hiring wants someone who takes things off their plate and makes a team run without being chased.
- Lead with the applicant's real leadership: how many people they managed, what they were responsible for, and a result they drove (use the real numbers from the examples, like team size or revenue growth).
- Show HOW they would manage this team, briefly and concretely (accountability, processes, KPIs, hiring or training, handling problems), picking what the post asks for. Only state methods as past habits if the sources describe them.
- If the post mentions a growing team, messy processes, or missed deadlines, give one real fact from the sources that fits, then say how the applicant would handle it here.
- Sound like a calm operator, not a cheerleader. No "natural leader", no "people person".`,
  automation: `This is an AUTOMATION role. The person hiring wants proof the applicant can actually build and keep automations running, not someone who "knows Zapier".
- Name the exact tools from the post that the applicant really has used, and one concrete thing they built: what it did, the tools, and what it saved or made possible.
- If the post describes a specific workflow or problem, say briefly how the applicant would approach it (one or two sentences, practical, not a lecture).
- If relevant, say how they WOULD keep this client's automations reliable (testing, error alerts, documentation). Only mention past safeguards the sources describe (e.g. ForgeAI's).
- Keep jargon light. The reader may not be technical.`,
  general_va: `This is a GENERAL VIRTUAL ASSISTANT role. The person hiring wants someone reliable they can hand varied tasks to and trust to follow through with little supervision.
- Lead with the real tasks from the sources that are closest to what the post needs, and one real example of being dependable (for example, being the main client contact while hitting deadlines).
- Show clear communication and responsiveness, and mention time zone availability if the post cares about hours.
- Name the tools from the post the applicant actually uses.
- Warm and easy to work with, but not gushing.`,
  admin: `This is an ADMIN role. The person hiring wants accuracy, organization, and someone who follows procedures without needing reminders.
- Lead with the real admin-type experience from the sources that is closest to the post (data accuracy, records, documentation, client coordination), and the tools from the post they have actually used.
- Show care for detail with a real example from the sources (e.g. keeping data accurate across concurrent projects), not the phrase "detail-oriented".
- Name the specific tools from the post the applicant has used.
- Short, tidy, and precise. The message itself should look organized.`,
};

// Which resume to link for each kind of job. The operations version leads with
// team leadership, client and admin work; the main one leads with building.
const MAIN_RESUME = 'https://dlvasolutions.com/resume.pdf';
const OPERATIONS_RESUME = 'https://dlvasolutions.com/resume-operations.pdf';

export function resumeUrlFor(role: RoleKey | null): string {
  return role === 'management' || role === 'general_va' || role === 'admin' ? OPERATIONS_RESUME : MAIN_RESUME;
}
