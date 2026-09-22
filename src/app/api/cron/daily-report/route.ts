import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase';
import { sendHtmlEmail, isEmailConfigured } from '@/lib/email';
import { phtDate, reportHtml, reportSubject, type ApplicationRow } from '@/lib/daily-report';

// Called at 5:00 PM Philippine time by .github/workflows/daily-report.yml
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 });
  }
  if (req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!isEmailConfigured()) {
    return NextResponse.json({ message: 'Email not configured, skipping report' });
  }

  let supabase;
  try {
    supabase = getServiceClient();
  } catch {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  }

  // The Philippine day, expressed as the UTC instants that bound it.
  const day = phtDate();
  const startUtc = new Date(`${day}T00:00:00.000Z`).getTime() - 8 * 3600 * 1000;
  const endUtc = startUtc + 24 * 3600 * 1000;

  const { data: apps, error } = await supabase
    .from('applications')
    .select('user_id, title, company, apply_url, lane, role, score, apply_points, subject, message, sent_at')
    .gte('sent_at', new Date(startUtc).toISOString())
    .lt('sent_at', new Date(endUtc).toISOString())
    .order('score', { ascending: false });

  if (error) {
    console.error('daily-report query failed:', error);
    return NextResponse.json({ error: 'Could not read applications' }, { status: 500 });
  }

  // One report per user, to the address on their profile.
  const byUser = new Map<string, ApplicationRow[]>();
  for (const row of apps || []) {
    const list = byUser.get(row.user_id) || [];
    list.push(row as ApplicationRow);
    byUser.set(row.user_id, list);
  }

  // A day with nothing sent still gets a report: silence is ambiguous, and
  // "nothing cleared the bar" is itself worth knowing.
  if (byUser.size === 0) {
    const { data: profiles } = await supabase.from('profiles').select('user_id, email').limit(50);
    for (const p of profiles || []) {
      if (p.email) byUser.set(p.user_id, []);
    }
  }

  const sent: string[] = [];
  const failed: string[] = [];

  for (const [userId, rows] of byUser) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('email')
      .eq('user_id', userId)
      .single();

    const to = profile?.email;
    if (!to) {
      failed.push(`${userId}: no email on profile`);
      continue;
    }

    const result = await sendHtmlEmail(to, reportSubject(rows, day), reportHtml(rows, day, null));
    if (result.success) sent.push(to);
    else failed.push(`${to}: ${result.error}`);
  }

  return NextResponse.json({ day, users: byUser.size, sent: sent.length, failed });
}
