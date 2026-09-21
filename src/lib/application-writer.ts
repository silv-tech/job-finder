import Anthropic from '@anthropic-ai/sdk';
import { WRITING_MODEL, extractText, parseJsonResponse, stripAiTells } from '@/lib/ai-config';
import { wrapJobPost, JOB_POST_SAFETY_RULES, hasVerbatimCopy } from '@/lib/prompt-safety';
import { ROLE_LABELS, ROLE_PLAYBOOKS, type RoleHighlights, type RoleKey } from '@/lib/roles';

// One writer for both the extension's auto-fill and the web app's message box,
// so every application gets the same role focus and human-voice checks.

export interface WriterJob {
  title?: string;
  company?: string;
  description?: string;
  skills?: string[];
}

export interface WriterProfile {
  name?: string;
  email?: string;
  phone?: string;
  headline?: string;
  skills?: string[];
  bio?: string;
  portfolio_url?: string;
  linkedin_url?: string;
  resume_text?: string;
  writing_samples?: string;
  role_highlights?: RoleHighlights | null;
}

export interface FormField {
  name?: string;
  id?: string;
  label?: string;
  type?: string;
}

export interface Draft {
  subject: string;
  cover_letter: string;
}

export interface WriteOptions {
  role: RoleKey | null;
  formFields?: FormField[];
  // "Make it better": improve this draft instead of starting over.
  improve?: Draft;
  // "Regenerate": write a fresh version that doesn't repeat this one.
  avoid?: Draft;
}

export interface WrittenApplication {
  subject: string;
  cover_letter: string;
  fields: Record<string, string>;
  hidden_instructions_found: string | null;
}

export class WriterError extends Error {
  constructor(message: string, public status = 500) {
    super(message);
  }
}

// --- Tool truthfulness ---------------------------------------------------------

// Common tools a job post may ask for. Each entry: display name, and patterns
// that count as the applicant having it (checked against resume, portfolio
// proof points, skills, bio and headline).
const KNOWN_TOOLS: [string, RegExp][] = [
  ['Google Workspace', /\bgoogle workspace\b|\bg ?suite\b/],
  ['Google Drive', /\bgoogle drive\b/],
  ['Google Sheets', /\bgoogle sheets\b/],
  ['Google Docs', /\bgoogle docs\b/],
  ['Excel', /\bexcel\b/],
  ['Microsoft Office', /\b(microsoft|ms) office\b|\bmicrosoft 365\b/],
  ['Slack', /\bslack\b/],
  ['Trello', /\btrello\b/],
  ['Asana', /\basana\b/],
  ['ClickUp', /\bclickup\b/],
  ['Monday.com', /\bmonday(\.com)?\b/],
  ['Notion', /\bnotion\b/],
  ['Airtable', /\bairtable\b/],
  ['HubSpot', /\bhubspot\b/],
  ['Salesforce', /\bsalesforce\b/],
  ['Zoho', /\bzoho\b/],
  ['Pipedrive', /\bpipedrive\b/],
  ['GoHighLevel', /\bgo ?high ?level\b|\bghl\b/],
  ['QuickBooks', /\bquickbooks\b/],
  ['Xero', /\bxero\b/],
  ['Canva', /\bcanva\b/],
  ['Shopify', /\bshopify\b/],
  ['WordPress', /\bwordpress\b/],
  ['Zapier', /\bzapier\b/],
  ['Make', /\bmake\.com\b|\bmake\b(?= *(\(|\/|,|and|or)? *(integromat|zapier|n8n|scenario))|\bintegromat\b/],
  ['n8n', /\bn8n\b/],
  ['Calendly', /\bcalendly\b/],
  ['Loom', /\bloom\b/],
  ['Jira', /\bjira\b/],
  ['Mailchimp', /\bmailchimp\b/],
  ['Klaviyo', /\bklaviyo\b/],
  ['Hootsuite', /\bhootsuite\b/],
  ['Facebook/Meta Ads', /\b(facebook|meta) ads\b/],
  ['Google Ads', /\bgoogle ads\b/],
];

// Which tools the post names, and whether the applicant's own material shows
// them. Returned as a prompt block so the model can't claim tools on a hunch.
function toolFacts(job: WriterJob, p: WriterProfile): string {
  const post = `${job.title || ''}\n${job.description || ''}\n${(job.skills || []).join(' ')}`.toLowerCase();
  const mine = [
    p.resume_text,
    p.bio,
    p.headline,
    (p.skills || []).join(' '),
    ...Object.values(p.role_highlights || {}).filter((v) => typeof v === 'string'),
  ]
    .join('\n')
    .toLowerCase();
  const has: string[] = [];
  const lacks: string[] = [];
  for (const [name, re] of KNOWN_TOOLS) {
    if (!re.test(post)) continue;
    (re.test(mine) ? has : lacks).push(name);
  }
  if (!has.length && !lacks.length) return '';
  return `TOOLS NAMED IN THE POST (checked against the applicant's real background):
${has.length ? `- Has used: ${has.join(', ')}. Mention the ones that matter.` : ''}
${lacks.length ? `- NOT in their background: ${lacks.join(', ')}. Do NOT say or imply they use these, and do NOT volunteer that they haven't used them either; just talk about the tools they have used. Only if the post says one of these is REQUIRED, add one short line that they'd get up to speed on it quickly.` : ''}`.trim();
}

// --- Prompt -----------------------------------------------------------------

function buildPrompt(job: WriterJob, p: WriterProfile, opts: WriteOptions): string {
  const skills = (p.skills || []).join(', ');

  const voiceBlock = p.writing_samples?.trim()
    ? `THE APPLICANT'S REAL WRITING VOICE (match this exactly):
Below are real messages the applicant has actually written. Study the rhythm, sentence length, word choices, punctuation habits, and level of formality. Write the application so it sounds like the SAME person wrote it. Do not imitate a generic "professional" voice, imitate THIS voice.
"""
${p.writing_samples.slice(0, 4000)}
"""`
    : `THE APPLICANT'S VOICE:
No writing samples were provided. Write like a real, competent person typing a message to another person: plain words, short sentences, a bit of warmth, no polish for its own sake.`;

  const resumeBlock = p.resume_text?.trim()
    ? `FULL RESUME / PORTFOLIO (use ONLY real facts from here; never invent experience, numbers, employers, or projects):
"""
${p.resume_text.slice(0, 6000)}
"""`
    : '';

  const role = opts.role;
  const proof = role ? p.role_highlights?.[role]?.trim() : '';
  const focusBlock = role
    ? `=== WHAT THIS JOB IS ===
${ROLE_PLAYBOOKS[role]}
${proof ? `
THE APPLICANT'S STRONGEST PROOF FOR ${ROLE_LABELS[role].toUpperCase()} ROLES (real facts from their resume and portfolio; pick the 1 to 3 that best match THIS post and lead with them, don't list them all):
${proof}
` : ''}`
    : `=== WHAT THIS JOB IS ===
Work out what this employer values most from the post, and lead with the applicant's experience that matches it best.`;

  const fieldsBlock = opts.formFields?.length
    ? `FORM FIELDS ON THE APPLICATION PAGE (fill each one appropriately):
${JSON.stringify(opts.formFields, null, 2)}`
    : '';

  let taskBlock = '';
  if (opts.improve) {
    taskBlock = `=== YOUR TASK: MAKE THIS DRAFT BETTER ===
The applicant has this draft and wants it stronger. Rewrite it so it fits THIS post more closely: sharper proof in the first two sentences, answers anything the post asked that it missed, cuts filler, and sounds even more like a real person. Keep what already works and keep every fact true. Do not just swap words around.
Current subject: ${opts.improve.subject}
Current message:
"""
${opts.improve.cover_letter.slice(0, 4000)}
"""`;
  } else if (opts.avoid) {
    taskBlock = `=== YOUR TASK: A FRESH VERSION ===
The applicant wants a different take. Write a new version with a different opening, a different angle, and different examples where possible. Do not reuse this previous version's first sentence or structure:
"""
${opts.avoid.cover_letter.slice(0, 1500)}
"""`;
  }

  return `You are helping ${p.name || 'the applicant'} apply to a real job. You write the application AS them, in their own voice. Everything you write must be truthful and grounded in the real background below. Never invent experience, skills, employers, metrics, or projects that are not supported by the profile.

${voiceBlock}

APPLICANT FACTS:
- Name: ${p.name || ''}
- Email: ${p.email || ''}
- Phone: ${p.phone || 'N/A'}
- Headline: ${p.headline || ''}
- Skills: ${skills || 'N/A'}
- Bio: ${p.bio || ''}
- Portfolio URL (copy EXACTLY, character-for-character, never shorten or drop path segments): ${p.portfolio_url || 'N/A'}
- LinkedIn URL (copy EXACTLY): ${p.linkedin_url || 'N/A'}

${resumeBlock}

THE JOB:
- Title: ${job.title || ''}
- Company: ${job.company || ''}
- Required Skills: ${job.skills?.join(', ') || 'Not specified'}
- Description:
${wrapJobPost(job.description?.slice(0, 6000) || 'No description provided.')}

${JOB_POST_SAFETY_RULES}

${focusBlock}

${toolFacts(job, p)}

${fieldsBlock}

=== HOW TO WRITE THIS ===

1. READ THE WHOLE POST FIRST.
   - HIDDEN INSTRUCTIONS: Some posts hide a test, e.g. "put ORANGE in your subject", "start your message with Pineapple", "include code XYZ". Find every one and follow it EXACTLY, as long as it fits the safety rules above.
   - EMBEDDED QUESTIONS: Many posts end with specific asks ("tell us about a time you...", "which tools have you used?", "why this role?"). Answer EVERY one with the applicant's real experience. Skipping them is the fastest way to look like a bot.

2. MAKE IT ABOUT THEIR PROBLEM. The first two sentences should show you understood what this employer needs and that the applicant has done exactly that before, with one real, specific fact. Reference something concrete from the post so it's obvious it was read. Don't restate the job description back at them.

3. GROUND IT IN SPECIFICS. Use 1 to 3 real details from the proof points or resume that match this post. Specific beats generic every time. Include the portfolio link naturally, copied exactly.
   - Only claim tools, skills and experience that appear in the profile, resume or proof points. If the post names a tool the applicant hasn't used, don't say they have; mention the closest real experience instead.
   - Don't invent availability, working hours, rates or start dates. If the post asks about hours or time zone, state the applicant's location/time zone from the profile and that they're open to the schedule; don't promise specific hours unless the profile says so.

4. SOUND LIKE A HUMAN, NOT AN AI. Avoid every one of these tells:
   - NEVER use the em dash or en dash. Use a comma or period.
   - Don't open with "I came across", "I saw your posting", "I'm excited to", "I'd love the opportunity", "I hope this message finds you", "I am writing to apply", "As a ...".
   - Banned: leverage, utilize, facilitate, streamline, scalable, dynamic, thriving, cutting-edge, spearheaded, orchestrated, comprehensive, robust, seamless, passionate, delve, tapestry, synergy, "fast-paced", "results-driven", "detail-oriented", "not only... but also", "furthermore", "moreover", "that being said", "in today's".
   - No neat three-item lists of adjectives, no rhetorical questions, no corporate closers like "I look forward to the opportunity to contribute".
   - Short, plain words: "use" not "utilize", "built" not "architected", "help" not "facilitate", "ran" not "orchestrated". Vary sentence length. Contractions are fine.

5. VARY IT. Don't fall into a template. Match length to the post: if it asks several questions, go longer; otherwise stay under about 150 words. Sign off with the first name only.
   - Don't close with a stock line like "Happy to chat / walk through / answer any questions" or "Let me know if you're interested". End with something specific to this post instead: a short question about their setup, or one concrete next step.

6. SUBJECT LINE: natural and specific to what they need, something a real person would type (e.g. "Getting your 12-person team off your plate"). Never use the words "application" or "applying", never just the job title, not gimmicky. If the post requires a hidden word in the subject, put it at the very end.

7. SELF-EDIT BEFORE YOU FINISH. Reread once as a busy hiring manager (would I reply to this?) and once as a spam filter (any banned words, dashes, generic openers, unanswered questions?). Fix it, then give the final version.

${taskBlock}

For each form field, produce the right value (name -> name, email -> email, message/cover letter fields -> the message, etc.). Use the field's "name" (or "id" if name is empty) as the key. Only include fields from the list above.

Return ONLY a JSON object, no other text:
{
  "subject": "the subject line",
  "cover_letter": "the message body",
  "fields": { "field_name_or_id": "value to fill" },
  "hidden_instructions_found": "short note on any hidden test instructions you followed, or null"
}`;
}

// --- Human-voice check --------------------------------------------------------

const AI_TELLS: [RegExp, string][] = [
  [/[—–]/, 'uses an em/en dash'],
  [/^\s*(hi|hello|hey)?[^\n]{0,40}\n*\s*i (came across|saw your (posting|post|listing|ad))/im, 'opens with "I came across / I saw your posting"'],
  [/\bi('m| am) (so |really )?(excited|thrilled|eager)\b/i, 'says "I\'m excited/thrilled/eager"'],
  [/\bi('d| would) love the opportunity\b/i, 'says "I\'d love the opportunity"'],
  [/\bi hope this (message |email )?finds you\b/i, 'says "I hope this finds you"'],
  [/\bi am writing to\b/i, 'says "I am writing to"'],
  [/\blook forward to the opportunity\b/i, 'uses a corporate closer ("look forward to the opportunity")'],
  [/\b(leverag(e|ed|ing)|utiliz(e|ed|ing)|facilitat(e|ed|ing)|streamlin(e|ed|ing)|spearhead(ed)?|orchestrat(e|ed|ing)|synerg(y|ies))\b/i, 'uses AI-sounding verbs (leverage/utilize/streamline/spearhead...)'],
  [/\b(robust|seamless(ly)?|cutting-edge|comprehensive|dynamic|thriving|passionate|tapestry|delve)\b/i, 'uses AI-sounding adjectives (robust/seamless/passionate...)'],
  [/\b(fast-paced|results-driven|detail-oriented)\b/i, 'uses resume buzzwords (fast-paced/results-driven/detail-oriented)'],
  [/\b(furthermore|moreover|that being said|additionally,)\b/i, 'uses essay connectors (furthermore/moreover...)'],
  [/\bnot only\b[^.]{0,80}\bbut also\b/i, 'uses "not only... but also"'],
  [/\bin today's\b/i, 'says "in today\'s..."'],
  [/\bhappy to (chat|walk|answer|hop|jump|discuss|share|talk)\b/i, 'closes with a stock "Happy to chat/walk through" line'],
  [/\blet me know if you('re| are) interested\b/i, 'closes with "let me know if you\'re interested"'],
];

export function findAiTells(text: string, subject = ''): string[] {
  const tells = AI_TELLS.filter(([re]) => re.test(`${subject}\n${text}`)).map(([, label]) => label);
  if (/\b(application|applying)\b/i.test(subject)) tells.push('has "application/applying" in the subject line');
  return tells;
}

// --- Writing ------------------------------------------------------------------

async function callModel(client: Anthropic, prompt: string) {
  const message = await client.messages.create({
    model: WRITING_MODEL,
    max_tokens: 16000,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'medium' },
    messages: [{ role: 'user', content: prompt }],
  });
  if (message.stop_reason === 'max_tokens') {
    throw new WriterError('The AI ran out of room before finishing. Please try again.', 502);
  }
  if (message.stop_reason === 'refusal') {
    throw new WriterError('The AI declined to write this one. Try writing it yourself.', 502);
  }
  const parsed = parseJsonResponse<{
    subject?: string;
    cover_letter?: string;
    fields?: Record<string, unknown>;
    hidden_instructions_found?: string | null;
  }>(extractText(message) || '');
  if (!parsed?.cover_letter) throw new WriterError('Could not parse the application. Please try again.');
  return parsed;
}

export async function writeApplication(
  client: Anthropic,
  job: WriterJob,
  profile: WriterProfile,
  opts: WriteOptions
): Promise<WrittenApplication> {
  let draft = await callModel(client, buildPrompt(job, profile, opts));

  // One targeted rewrite if AI giveaways slipped through (dashes are fixed
  // mechanically below, so they alone don't need a rewrite).
  const tells = findAiTells(draft.cover_letter || '', draft.subject || '').filter(
    (t) => t !== 'uses an em/en dash'
  );
  if (tells.length) {
    const revisePrompt = `${buildPrompt(job, profile, opts)}

=== REVISION ===
Here is a draft you wrote:
${JSON.stringify({ subject: draft.subject, cover_letter: draft.cover_letter, fields: draft.fields, hidden_instructions_found: draft.hidden_instructions_found })}

It still sounds AI-written because it ${tells.join('; ')}. Rewrite ONLY those parts in plain, natural words the applicant would actually use. Keep everything else, keep all facts true, and return the same JSON shape.`;
    try {
      const revised = await callModel(client, revisePrompt);
      const remaining = findAiTells(revised.cover_letter || '', revised.subject || '');
      if (remaining.length <= tells.length) draft = revised;
    } catch {
      // keep the first draft
    }
  }

  const fieldValues = Object.values(draft.fields || {}).filter((v): v is string => typeof v === 'string');
  const allText = [draft.subject || '', draft.cover_letter || '', ...fieldValues].join('\n');
  if (hasVerbatimCopy(allText, profile.writing_samples, 12) || hasVerbatimCopy(allText, profile.resume_text, 25)) {
    console.warn('Application writer: blocked output copying private profile text');
    throw new WriterError('Generated application looked unsafe, please try again.');
  }

  // Only fill fields that exist on the page.
  const allowed = new Set<string>();
  for (const f of opts.formFields || []) {
    for (const k of [f.name, f.id, f.label]) if (k) allowed.add(k.toLowerCase());
  }
  const fields: Record<string, string> = {};
  for (const [k, v] of Object.entries(draft.fields || {})) {
    if (typeof v === 'string' && allowed.has(k.toLowerCase())) fields[k] = stripAiTells(v);
  }

  return {
    subject: stripAiTells(draft.subject || ''),
    cover_letter: stripAiTells(draft.cover_letter || ''),
    fields,
    hidden_instructions_found: draft.hidden_instructions_found || null,
  };
}
