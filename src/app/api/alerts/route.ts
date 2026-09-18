import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase';
import { requireAuth } from '@/lib/auth-api';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const supabase = getServiceClient();
    const { data, error } = await supabase
      .from('alerts')
      .select('*')
      .eq('user_id', auth.userId)
      .order('created_at', { ascending: false });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ alerts: data });
  } catch {
    return NextResponse.json({ alerts: [], error: 'Supabase not configured' });
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const supabase = getServiceClient();
    const body = await req.json();

    // Validate input so a malformed alert can't later crash the daily cron
    // (which does alert.keywords.join(...)).
    const keywords = Array.isArray(body.keywords)
      ? body.keywords.map((k: unknown) => String(k).trim()).filter(Boolean)
      : [];
    const email = typeof body.email === 'string' ? body.email.trim() : '';
    if (keywords.length === 0 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: 'Invalid keywords or email' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('alerts')
      .insert({
        user_id: auth.userId,
        keywords,
        email,
        active: true,
      })
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ alert: data });
  } catch {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const supabase = getServiceClient();
    const { id } = await req.json();

    const { error } = await supabase
      .from('alerts')
      .delete()
      .eq('id', id)
      .eq('user_id', auth.userId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  }
}
