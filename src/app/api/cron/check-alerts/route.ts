import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase';
import { searchJobs } from '@/lib/jobs-api';
import { sendAlertEmail } from '@/lib/email';

// This endpoint is called by Vercel Cron (see vercel.json)
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  // Verify cron secret to prevent unauthorized access
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 });
  }
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let supabase;
  try {
    supabase = getServiceClient();
  } catch {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  }

  const { data: alerts } = await supabase
    .from('alerts')
    .select('*')
    .eq('active', true);

  if (!alerts || alerts.length === 0) {
    return NextResponse.json({ message: 'No active alerts' });
  }

  let totalSent = 0;

  for (const alert of alerts) {
    const query = alert.keywords.join(' ');
    const jobs = await searchJobs(query, 1, false);

    // Filter to jobs posted since last alert
    const newJobs = alert.last_sent_at
      ? jobs.filter((j) => new Date(j.posted_at) > new Date(alert.last_sent_at))
      : jobs.slice(0, 10);

    if (newJobs.length > 0) {
      await sendAlertEmail(
        alert.email,
        newJobs.map((j) => ({ title: j.title, company: j.company, apply_url: j.apply_url }))
      );

      await supabase
        .from('alerts')
        .update({ last_sent_at: new Date().toISOString() })
        .eq('id', alert.id);

      totalSent++;
    }
  }

  return NextResponse.json({ message: `Checked ${alerts.length} alerts, sent ${totalSent} emails` });
}
