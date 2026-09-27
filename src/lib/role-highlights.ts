import { createHash } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import { getServiceClient } from '@/lib/supabase';
import { safeFetchText } from '@/lib/safe-fetch';
import { WRITING_MODEL, extractText, parseJsonResponse, stripAiTells } from '@/lib/ai-config';
import { ROLE_KEYS, type RoleHighlights } from '@/lib/roles';
import { meterCall, type CostMeter } from '@/lib/cost-meter';

// Builds the per-role "proof points" from the applicant's resume and portfolio
// page, so each application can lead with the experience that fits the job.

interface ProfileSource {
  resume_text?: string;
  portfolio_url?: string;
  bio?: string;
  headline?: string;
  role_highlights?: RoleHighlights | null;
}

function fingerprint(p: ProfileSource): string {
  // ROLE_KEYS is part of the fingerprint on purpose: adding a new kind of role
  // must invalidate stored highlights, or that role would never get proof
  // points. The separator is an escaped NUL so this file stays text to git.
  return createHash('sha256')
    .update([p.resume_text || '', p.portfolio_url || '', p.bio || '', p.headline || '', ROLE_KEYS.join(',')].join('\0'))
    .digest('hex')
    .slice(0, 16);
}

export function highlightsAreStale(p: ProfileSource): boolean {
  const h = p.role_highlights;
  if (h?._edited) return false; // hand-edited: never overwrite automatically
  if (!h || !ROLE_KEYS.some((k) => h[k]?.trim())) return true;
  return h._source !== fingerprint(p);
}

async function portfolioText(url?: string): Promise<string> {
  if (!url) return '';
  try {
    const html = await safeFetchText(url.startsWith('http') ? url : `https://${url}`);
    return html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&[a-z]+;/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 12000);
  } catch {
    return '';
  }
}

export async function generateRoleHighlights(p: ProfileSource, meter?: CostMeter): Promise<RoleHighlights> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('AI is not configured');
  const portfolio = await portfolioText(p.portfolio_url);
  if (!p.resume_text?.trim() && !portfolio) throw new Error('No resume or portfolio to read');

  const prompt = `Below is one person's resume and portfolio. They apply to five kinds of remote jobs. For EACH kind, pick out the real experience that a hiring manager for that kind of job would care about most.

Rules:
- Use ONLY facts stated in the sources. Never invent numbers, employers, tools, team sizes or results. If a number isn't in the sources, don't give one.
- 4 to 7 short bullet points per role, most convincing first. Each bullet is one concrete fact: what they did, with what, and the result or scale if the sources give it.
- Plain words, first person is not needed. No hype, no "passionate", no em dashes.
- Describe what they did or use, never the documents themselves (no "Listed...", "Resume shows...", "Has working knowledge of...").
- Don't turn availability into experience: "available for remote work worldwide" is not "has worked for clients worldwide".
- If the sources have little for a role, give fewer bullets built from the closest real experience (for example, reliability and communication for admin work). Never pad.

The five kinds of jobs:
- developer: building and shipping websites and web apps: the languages and frameworks they code in, projects they built end to end, e-commerce and payment flows, databases, APIs, deploying and hosting, keeping things live.
- management: leading or managing people, teams, operations, hiring, training, processes, accountability, KPIs, growing a business.
- automation: building automations and integrations (Zapier, Make, n8n, APIs, AI tools, scripts), workflows that save time, systems work.
- general_va: general virtual assistant work: juggling varied tasks, communication with clients, research, tools, reliability, working across time zones.
- admin: administrative work: organizing, inbox and calendar, documents and data, accuracy, CRMs and spreadsheets, following procedures.

Return ONLY this JSON, each value a string of "- " bullet lines separated by \\n:
{"developer": "...", "management": "...", "automation": "...", "general_va": "...", "admin": "..."}

<resume>
${(p.resume_text || '').slice(0, 9000)}
</resume>

<portfolio_page>
${portfolio}
</portfolio_page>

<headline_and_bio>
${p.headline || ''}
${p.bio || ''}
</headline_and_bio>`;

  const client = new Anthropic({ apiKey: key });
  const message = await client.messages.create({
    model: WRITING_MODEL,
    max_tokens: 16000,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'medium' },
    messages: [{ role: 'user', content: prompt }],
  });
  // This runs INSIDE a generate request, so its cost belongs on that request's
  // bill. Unmetered it was ~20-30% of an application's real cost showing up as
  // free, which is exactly what the ledger exists to stop. Recorded before the
  // throws below, because a refusal is billed too.
  meterCall(meter, WRITING_MODEL, message.usage);
  if (message.stop_reason === 'max_tokens' || message.stop_reason === 'refusal') {
    throw new Error('Could not generate role examples, please try again');
  }
  const parsed = parseJsonResponse<Record<string, unknown>>(extractText(message) || '');
  if (!parsed) throw new Error('Could not generate role examples, please try again');

  const result: RoleHighlights = { _source: fingerprint(p) };
  for (const k of ROLE_KEYS) {
    const v = parsed[k];
    if (typeof v === 'string' && v.trim()) result[k] = stripAiTells(v.trim());
  }
  return result;
}

// Returns up-to-date highlights for the user, regenerating and saving them
// when the resume/portfolio changed (unless hand-edited). Never throws: on any
// failure it falls back to whatever is stored.
// Fingerprints we have already paid to generate in this process. A refresh is
// only remembered by SAVING it, so a failing Supabase write (or a profile whose
// bio differs between the web app and the extension) made this regenerate on
// EVERY generate request, unmetered and forever. This caps that failure at one
// call an hour per process instead of one per application.
const attempted = new Map<string, number>();
const ATTEMPT_TTL_MS = 60 * 60 * 1000;

export async function ensureRoleHighlights(
  userId: string,
  p: ProfileSource,
  meter?: CostMeter
): Promise<RoleHighlights> {
  const current = p.role_highlights || {};
  if (!highlightsAreStale(p)) return current;

  const key = `${userId}:${fingerprint(p)}`;
  const last = attempted.get(key);
  if (last && Date.now() - last < ATTEMPT_TTL_MS) return current;
  attempted.set(key, Date.now());
  if (attempted.size > 200) attempted.delete(attempted.keys().next().value as string);

  try {
    const fresh = await generateRoleHighlights(p, meter);
    const { error } = await getServiceClient()
      .from('profiles')
      .update({ role_highlights: fresh })
      .eq('user_id', userId);
    // Worth shouting about: while this keeps failing the refresh is paid for
    // again every hour and nothing on screen explains the higher bill.
    if (error) console.error('Role highlights save FAILED, will regenerate later:', error.message);
    return fresh;
  } catch (err) {
    console.error('Role highlights refresh failed:', err);
    return current;
  }
}
