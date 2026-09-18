import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { verifyExtensionAuth } from '@/lib/auth-api';
import { getServiceClient } from '@/lib/supabase';
import { WRITING_MODEL, extractText, parseJsonResponse, stripAiTells } from '@/lib/ai-config';
import { detectManualRequirements } from '@/lib/manual-requirements';

export const dynamic = 'force-dynamic';

let anthropic: Anthropic | null = null;

function getClient() {
  if (!anthropic) {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key || key === 'your_anthropic_api_key_here') return null;
    anthropic = new Anthropic({ apiKey: key });
  }
  return anthropic;
}

// Load the authoritative profile for this user from Supabase, then overlay any
// non-empty fields the caller passed in. The extension's local profile is
// often sparse (no resume_text, no writing_samples), so pulling the stored
// profile server-side guarantees the model always writes from the full, real
// profile — including the voice samples that make it sound human.
async function loadProfile(
  userId: string,
  bodyProfile: Record<string, unknown> = {}
): Promise<Record<string, unknown>> {
  let stored: Record<string, unknown> = {};
  try {
    const supabase = getServiceClient();
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('user_id', userId)
      .single();
    if (data) stored = data as Record<string, unknown>;
  } catch {
    // Supabase not configured / no row yet — fall back to the body profile.
  }
  const merged: Record<string, unknown> = { ...stored };
  for (const [k, v] of Object.entries(bodyProfile)) {
    const empty = v == null || v === '' || (Array.isArray(v) && v.length === 0);
    if (!empty) merged[k] = v;
  }
  return merged;
}

interface Profile {
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
}

function buildPrompt(job: {
  title?: string;
  company?: string;
  description?: string;
}, profile: Profile, formFields: unknown[]): string {
  const skills = (profile.skills || []).join(', ');

  const voiceBlock = profile.writing_samples?.trim()
    ? `THE APPLICANT'S REAL WRITING VOICE (match this exactly):
Below are real messages the applicant has actually written. Study the rhythm, sentence length, word choices, punctuation habits, and level of formality. Write the application so it sounds like the SAME person wrote it. Do not imitate a generic "professional" voice, imitate THIS voice.
"""
${profile.writing_samples.slice(0, 4000)}
"""`
    : `THE APPLICANT'S VOICE:
No writing samples were provided. Infer a natural, plain-spoken voice from the resume and bio below. Write like a real, competent person typing a message to another person, not like a polished cover-letter template.`;

  const resumeBlock = profile.resume_text?.trim()
    ? `FULL RESUME / PORTFOLIO (use ONLY real facts from here; never invent experience, numbers, employers, or projects):
"""
${profile.resume_text.slice(0, 6000)}
"""`
    : '';

  return `You are helping ${profile.name || 'the applicant'} apply to a real job. You write the application AS them, in their own voice. Everything you write must be truthful and grounded in the real background below. Never invent experience, skills, employers, metrics, or projects that are not supported by the profile.

${voiceBlock}

APPLICANT FACTS:
- Name: ${profile.name || ''}
- Email: ${profile.email || ''}
- Phone: ${profile.phone || 'N/A'}
- Headline: ${profile.headline || ''}
- Skills: ${skills || 'N/A'}
- Bio: ${profile.bio || ''}
- Portfolio URL (copy EXACTLY, character-for-character, never shorten or drop path segments): ${profile.portfolio_url || 'N/A'}
- LinkedIn URL (copy EXACTLY): ${profile.linkedin_url || 'N/A'}

${resumeBlock}

THE JOB:
- Title: ${job.title || ''}
- Company: ${job.company || ''}
- Description:
"""
${job.description?.slice(0, 6000) || 'No description provided.'}
"""

FORM FIELDS ON THE APPLICATION PAGE (fill each one appropriately):
${JSON.stringify(formFields || [], null, 2)}

=== HOW TO WRITE THIS ===

1. READ THE WHOLE POST FIRST.
   - HIDDEN INSTRUCTIONS: Some posts hide a test, e.g. "put ORANGE in your subject", "start your message with Pineapple", "include code XYZ". Find every one and follow it EXACTLY. A careful human applicant does this; it is what separates a real applicant from spam.
   - EMBEDDED QUESTIONS: Many posts end with specific asks, e.g. "tell us about a time you...", "which of these tools have you used?", "why do you want this role?". Find and answer EVERY one, using the applicant's real experience. If the post asks 4 things, answer all 4. Skipping them is the fastest way to look like a bot.

2. GROUND IT IN SPECIFICS.
   - Pull 1 to 2 concrete, true details from the resume that directly match what THIS job needs, and name them. Specific beats generic every time.
   - Reference something real from the job post so it is obvious you read it. Do not just restate the job description back at them.
   - Always include the portfolio link naturally, as proof of work, copied exactly.

3. SOUND LIKE A HUMAN, NOT AN AI. This is the whole point. Avoid every one of these tells:
   - NEVER use the em dash (—) or en dash (–). Use a comma or period. This is the #1 giveaway.
   - Do not open with "I came across", "I saw your posting", "I'm excited to", "I'd love the opportunity", "I hope this message finds you", "I am writing to apply".
   - Banned words/phrases: leverage, utilize, facilitate, streamline, scalable, dynamic, thriving, cutting-edge, spearheaded, orchestrated, comprehensive, robust, passionate about, delve, tapestry, "in today's fast-paced world", "not only... but also", "furthermore", "moreover", "that being said".
   - No perfectly balanced three-item lists ("dedicated, driven, and detail-oriented"). No rhetorical questions. No corporate closers like "I look forward to the opportunity to contribute".
   - Use short, plain words: "use" not "utilize", "built" not "architected", "help" not "facilitate", "set up" not "orchestrated". Short sentences. Real, warm, direct.

4. VARY IT. This applicant sends many applications. Do not fall into a template. Change how you open and how you structure each one so two applications never read the same. Match the length to the post: if it asks several questions, go longer; otherwise keep the message under about 150 words.

5. SUBJECT LINE: natural and human, specific to the role. Not "Application for [Title]" and NOT gimmicky spam like "HIRE ME NOW!!!". Something a real person would type. If the post requires a hidden word in the subject, put it at the very end.

6. SELF-EDIT BEFORE YOU FINISH. Reread your draft twice: once as a busy hiring manager (does this sound like a real person who read my post, or like AI filler?), and once as a spam filter (any banned words, em dashes, generic openers, unanswered questions?). Rewrite until it passes both. Only then produce the final version.

For each form field, produce the right value (name -> name, email -> email, message/cover letter fields -> the message, etc.).

Return ONLY a JSON object, no other text:
{
  "subject": "the subject line",
  "cover_letter": "the message body",
  "fields": { "field_name_or_id": "value to fill", "...": "..." },
  "hidden_instructions_found": "short note on any hidden test instructions you followed, or null"
}`;
}

export async function POST(req: NextRequest) {
  const auth = await verifyExtensionAuth(req);
  if (auth instanceof NextResponse) return auth;

  const client = getClient();

  try {
    const { job, profile: bodyProfile, form_fields } = await req.json();

    // Jobs that need a human (video, code test, live call) can't be automated.
    const manualCheck = detectManualRequirements(job.description || '');
    if (manualCheck.hasManual) {
      return NextResponse.json({
        manual_required: true,
        requirements: manualCheck.requirements,
        error: 'This job requires manual action: ' + manualCheck.requirements.join(', '),
      });
    }

    // Always write from the full stored profile, overlaid with anything fresh
    // the extension sent.
    const profile: Profile = await loadProfile(auth.userId, bodyProfile || {});

    // Fallback when no AI is configured: a plain template.
    if (!client) {
      const skills = profile.skills?.slice(0, 4).join(', ') || 'various technologies';
      const coverLetter = stripAiTells(`Hi,

I saw your listing for ${job.title} and wanted to reach out. ${profile.bio || "I've been building products for years."}

I'm comfortable with ${skills}, and I pick things up fast. I'd be glad to talk about how I can help.

Portfolio: ${profile.portfolio_url || ''}
LinkedIn: ${profile.linkedin_url || ''}

${profile.name || ''}
${profile.email || ''}
${profile.phone || ''}`.trim());

      const fields: Record<string, string> = {};
      for (const field of (form_fields || [])) {
        const label = (field.label || field.name || '').toLowerCase();
        if (label.includes('name')) fields[field.name || field.id] = profile.name || '';
        else if (label.includes('email')) fields[field.name || field.id] = profile.email || '';
        else if (label.includes('phone')) fields[field.name || field.id] = profile.phone || '';
        else if (label.includes('portfolio') || label.includes('website')) fields[field.name || field.id] = profile.portfolio_url || '';
        else if (label.includes('linkedin')) fields[field.name || field.id] = profile.linkedin_url || '';
      }

      return NextResponse.json({
        subject: `Applying for ${job.title}`,
        cover_letter: coverLetter,
        fields,
        hidden_instructions_found: null,
      });
    }

    const message = await client.messages.create({
      model: WRITING_MODEL,
      max_tokens: 4096,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium' },
      messages: [{ role: 'user', content: buildPrompt(job, profile, form_fields) }],
    });

    const text = extractText(message);
    if (!text) {
      return NextResponse.json({ error: 'Unexpected response' }, { status: 500 });
    }

    const parsed = parseJsonResponse<{
      subject?: string;
      cover_letter?: string;
      fields?: Record<string, unknown>;
      hidden_instructions_found?: string | null;
    }>(text);
    if (!parsed) {
      return NextResponse.json({ error: 'Could not parse application' }, { status: 500 });
    }

    // Final safety net: strip any residual AI tells (em dashes, curly quotes).
    if (parsed.subject) parsed.subject = stripAiTells(parsed.subject);
    if (parsed.cover_letter) parsed.cover_letter = stripAiTells(parsed.cover_letter);
    if (parsed.fields) {
      for (const key of Object.keys(parsed.fields)) {
        if (typeof parsed.fields[key] === 'string') {
          parsed.fields[key] = stripAiTells(parsed.fields[key] as string);
        }
      }
    }
    // engine tells the extension this backend reads writing_samples natively
    return NextResponse.json({ ...parsed, engine: 'v2' });
  } catch (err) {
    console.error('Generate application error:', err);
    return NextResponse.json({ error: 'Failed to generate application' }, { status: 500 });
  }
}
