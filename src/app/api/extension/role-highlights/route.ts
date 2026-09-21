import { NextRequest, NextResponse } from 'next/server';
import { verifyExtensionAuth } from '@/lib/auth-api';
import { getServiceClient } from '@/lib/supabase';
import { ensureRoleHighlights, generateRoleHighlights } from '@/lib/role-highlights';
import { ROLE_KEYS, type RoleHighlights } from '@/lib/roles';

export const dynamic = 'force-dynamic';

async function loadProfile(userId: string) {
  const { data } = await getServiceClient()
    .from('profiles')
    .select('resume_text, portfolio_url, bio, headline, role_highlights')
    .eq('user_id', userId)
    .maybeSingle();
  return data;
}

// GET: current role examples, generated first if missing or out of date.
export async function GET(req: NextRequest) {
  const auth = await verifyExtensionAuth(req);
  if (auth instanceof NextResponse) return auth;
  try {
    const profile = await loadProfile(auth.userId);
    if (!profile) return NextResponse.json({ highlights: {} });
    const highlights = await ensureRoleHighlights(auth.userId, profile);
    return NextResponse.json({ highlights });
  } catch (err) {
    console.error('Role highlights GET error:', err);
    return NextResponse.json({ error: 'Could not load role examples' }, { status: 500 });
  }
}

// POST: regenerate from resume + portfolio now (replaces hand edits).
export async function POST(req: NextRequest) {
  const auth = await verifyExtensionAuth(req);
  if (auth instanceof NextResponse) return auth;
  try {
    const profile = await loadProfile(auth.userId);
    if (!profile) return NextResponse.json({ error: 'Save your profile first' }, { status: 400 });
    const highlights = await generateRoleHighlights(profile);
    const { error } = await getServiceClient()
      .from('profiles')
      .update({ role_highlights: highlights })
      .eq('user_id', auth.userId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ highlights });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not generate role examples';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// PUT: save the user's own edits. Marked as edited so they aren't replaced
// automatically when the resume changes.
export async function PUT(req: NextRequest) {
  const auth = await verifyExtensionAuth(req);
  if (auth instanceof NextResponse) return auth;
  try {
    const body = await req.json();
    const current = (await loadProfile(auth.userId))?.role_highlights as RoleHighlights | null;
    const highlights: RoleHighlights = { _source: current?._source, _edited: true };
    for (const k of ROLE_KEYS) {
      const v = body?.highlights?.[k];
      if (typeof v === 'string') highlights[k] = v.slice(0, 4000);
    }
    const { error } = await getServiceClient()
      .from('profiles')
      .update({ role_highlights: highlights })
      .eq('user_id', auth.userId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ highlights });
  } catch {
    return NextResponse.json({ error: 'Could not save role examples' }, { status: 500 });
  }
}
