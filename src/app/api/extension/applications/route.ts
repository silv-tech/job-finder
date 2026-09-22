import { NextRequest, NextResponse } from 'next/server';
import { verifyExtensionAuth } from '@/lib/auth-api';
import { getServiceClient } from '@/lib/supabase';
import { phtDate } from '@/lib/daily-report';

export const dynamic = 'force-dynamic';

// Today's applications, for the popup's end-of-day list. Email was dropped
// (onlinejobs.ph sends through its own system), so this is how he reads back
// what went out.
export async function GET(req: NextRequest) {
  const auth = await verifyExtensionAuth(req);
  if (auth instanceof NextResponse) return auth;

  try {
    // The Philippine day, expressed as the UTC instants that bound it.
    const day = phtDate();
    const startUtc = new Date(`${day}T00:00:00.000Z`).getTime() - 8 * 3600 * 1000;
    const endUtc = startUtc + 24 * 3600 * 1000;

    const { data, error } = await getServiceClient()
      .from('applications')
      .select('title, company, apply_url, lane, role, score, apply_points, subject, message, status, sent_at')
      .eq('user_id', auth.userId)
      .gte('sent_at', new Date(startUtc).toISOString())
      .lt('sent_at', new Date(endUtc).toISOString())
      .order('sent_at', { ascending: false });

    if (error) {
      console.error('applications query failed:', error);
      return NextResponse.json({ error: 'Could not read applications', applications: [] }, { status: 500 });
    }

    const rows = data || [];
    return NextResponse.json({
      day,
      applications: rows,
      sent: rows.filter((r) => r.status !== 'needs_manual').length,
      needs_manual: rows.filter((r) => r.status === 'needs_manual').length,
      points: rows.reduce((n, r) => n + (r.apply_points || 0), 0),
    });
  } catch (err) {
    console.error('applications error:', err);
    return NextResponse.json({ error: String(err), applications: [] }, { status: 500 });
  }
}
