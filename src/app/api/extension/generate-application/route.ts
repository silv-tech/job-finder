import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { verifyExtensionAuth } from '@/lib/auth-api';
import { stripAiTells } from '@/lib/ai-config';
import { detectManualRequirements } from '@/lib/manual-requirements';
import { loadWriterProfile } from '@/lib/stored-profile';
import { writeApplication, WriterError, type Draft, type FormField } from '@/lib/application-writer';
import { ROLE_KEYS, ROLE_LABELS, detectRole, isRoleKey, type RoleKey } from '@/lib/roles';

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

function asDraft(value: unknown): Draft | undefined {
  const d = value as Partial<Draft> | undefined;
  return d && typeof d.cover_letter === 'string' && d.cover_letter.trim()
    ? { subject: String(d.subject || ''), cover_letter: d.cover_letter }
    : undefined;
}

// Body: { job, profile?, form_fields?, role?, improve?, avoid? }
//   role    - force a focus (management | automation | general_va | admin), else detected
//   improve - { subject, cover_letter }: make this draft better
//   avoid   - { subject, cover_letter }: write a fresh version unlike this one
export async function POST(req: NextRequest) {
  const auth = await verifyExtensionAuth(req);
  if (auth instanceof NextResponse) return auth;

  const client = getClient();

  try {
    const body = await req.json();
    const job = body.job || {};
    const formFields: FormField[] = Array.isArray(body.form_fields) ? body.form_fields : [];

    // Jobs that need a human (video, code test, live call) can't be automated.
    const manualCheck = detectManualRequirements(job.description || '');
    if (manualCheck.hasManual) {
      return NextResponse.json({
        manual_required: true,
        requirements: manualCheck.requirements,
        error: 'This job requires manual action: ' + manualCheck.requirements.join(', '),
      });
    }

    // 'general' = the user chose no special focus; otherwise their choice or detected
    const role: RoleKey | null =
      body.role === 'general' ? null : isRoleKey(body.role) ? body.role : detectRole(job);
    const roleInfo = {
      role,
      role_label: role ? ROLE_LABELS[role] : 'General',
      roles: ROLE_KEYS.map((key) => ({ key, label: ROLE_LABELS[key] })),
    };

    // Always write from the full stored profile, overlaid with anything fresh
    // the extension sent.
    const profile = await loadWriterProfile(auth.userId, body.profile || {});

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
      for (const field of formFields) {
        const key = field.name || field.id;
        if (!key) continue;
        const label = (field.label || field.name || '').toLowerCase();
        if (label.includes('name')) fields[key] = profile.name || '';
        else if (label.includes('email')) fields[key] = profile.email || '';
        else if (label.includes('phone')) fields[key] = profile.phone || '';
        else if (label.includes('portfolio') || label.includes('website')) fields[key] = profile.portfolio_url || '';
        else if (label.includes('linkedin')) fields[key] = profile.linkedin_url || '';
      }

      return NextResponse.json({
        subject: `Applying for ${job.title}`,
        cover_letter: coverLetter,
        fields,
        hidden_instructions_found: null,
        ...roleInfo,
      });
    }

    const application = await writeApplication(client, job, profile, {
      role,
      formFields,
      improve: asDraft(body.improve),
      avoid: asDraft(body.avoid),
    });
    return NextResponse.json({ ...application, ...roleInfo });
  } catch (err) {
    if (err instanceof WriterError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error('Generate application error:', err);
    return NextResponse.json({ error: 'Failed to generate application' }, { status: 500 });
  }
}
