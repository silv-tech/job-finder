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
//   role    - force a focus (developer | management | automation | general_va | admin), else detected
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

    // Jobs that need a human (video, code test, live call) can't be SENT
    // automatically, but the message is still worth writing: he records the
    // video himself and sends the application by hand, and a drafted message
    // is most of that work. So this no longer returns early. It marks the
    // response, and the extension declines to send while keeping the draft.
    const manualCheck = detectManualRequirements(job.description || '');
    const manualInfo = manualCheck.hasManual
      ? { manual_required: true, requirements: manualCheck.requirements }
      : {};

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
        ...manualInfo,
      });
    }

    // The write takes ~30s across several passes. Without this the extension
    // shows one frozen label the whole time and looks hung. Streaming is
    // opt-in: older extension builds and the popup keep the plain JSON reply,
    // and a client that asks for the stream but never receives the progress
    // lines (a proxy that buffers, say) still gets the same final result.
    if (body.stream) {
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          const line = (obj: unknown) => {
            try { controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n')); } catch { /* client went away */ }
          };
          try {
            const application = await writeApplication(client, job, profile, {
              role,
              formFields,
              improve: asDraft(body.improve),
              avoid: asDraft(body.avoid),
              onProgress: (phase) => line({ type: 'progress', phase }),
            });
            line({ type: 'result', result: { ...application, ...roleInfo, ...manualInfo } });
          } catch (err) {
            const message =
              err instanceof WriterError ? err.message : 'Failed to generate application';
            if (!(err instanceof WriterError)) console.error('Generate application error:', err);
            line({ type: 'result', result: { error: message } });
          }
          controller.close();
        },
      });
      return new Response(stream, {
        headers: {
          'Content-Type': 'application/x-ndjson; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          'X-Accel-Buffering': 'no',
        },
      });
    }

    const application = await writeApplication(client, job, profile, {
      role,
      formFields,
      improve: asDraft(body.improve),
      avoid: asDraft(body.avoid),
    });
    return NextResponse.json({ ...application, ...roleInfo, ...manualInfo });
  } catch (err) {
    if (err instanceof WriterError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error('Generate application error:', err);
    return NextResponse.json({ error: 'Failed to generate application' }, { status: 500 });
  }
}
