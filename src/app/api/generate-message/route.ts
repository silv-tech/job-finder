import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { requireAuth } from '@/lib/auth-api';
import { loadWriterProfile } from '@/lib/stored-profile';
import { writeApplication, WriterError, type Draft } from '@/lib/application-writer';
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
  const d = value as { subject?: string; body?: string; cover_letter?: string } | undefined;
  const text = d?.cover_letter ?? d?.body;
  return typeof text === 'string' && text.trim() ? { subject: String(d?.subject || ''), cover_letter: text } : undefined;
}

// Body: { job, profile?, role?, improve?, avoid? } (same options as the
// extension's generate-application). Returns { subject, body, role, ... }.
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const client = getClient();
  if (!client) {
    return NextResponse.json(
      { error: 'Anthropic API key not configured. Add ANTHROPIC_API_KEY to .env.local' },
      { status: 500 }
    );
  }

  try {
    const body = await req.json();
    const job = body.job || {};
    // 'general' = the user chose no special focus; otherwise their choice or detected
    const role: RoleKey | null =
      body.role === 'general' ? null : isRoleKey(body.role) ? body.role : detectRole(job);
    const profile = await loadWriterProfile(auth.userId, body.profile || {});

    const application = await writeApplication(client, job, profile, {
      role,
      improve: asDraft(body.improve),
      avoid: asDraft(body.avoid),
    });

    return NextResponse.json({
      subject: application.subject,
      body: application.cover_letter,
      role,
      role_label: role ? ROLE_LABELS[role] : 'General',
      roles: ROLE_KEYS.map((key) => ({ key, label: ROLE_LABELS[key] })),
    });
  } catch (err) {
    if (err instanceof WriterError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error('AI generation error:', err);
    return NextResponse.json({ error: 'Failed to generate message.' }, { status: 500 });
  }
}
