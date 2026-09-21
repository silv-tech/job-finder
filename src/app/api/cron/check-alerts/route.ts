import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase';
import { searchJobs } from '@/lib/jobs-api';
import { sendAlertEmail, isEmailConfigured } from '@/lib/email';

// Called daily by the GitHub Actions workflow in .github/workflows/daily-alerts.yml
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

  // Without email there's no way to deliver alerts, so don't spend job-search
  // quota. Starts working on its own once Resend is configured.
  if (!isEmailConfigured()) {
    return NextResponse.json({ message: 'Email not configured, skipping alerts' });
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
  let totalFailed = 0;

  for (const alert of alerts) {
    // Never let one malformed or failing alert abort the whole run.
    try {
      const query = Array.isArray(alert.keywords) ? alert.keywords.join(' ') : '';
      if (!query.trim() || !alert.email) continue;

      const jobs = await searchJobs(query, 1, false);

      // Filter to jobs posted since last alert
      const newJobs = alert.last_sent_at
        ? jobs.filter((j) => new Date(j.posted_at) > new Date(alert.last_sent_at))
        : jobs.slice(0, 10);

      if (newJobs.length > 0) {
        const result = await sendAlertEmail(
          alert.email,
          newJobs.map((j) => ({ title: j.title, company: j.company, apply_url: j.apply_url }))
        );

        // Only move last_sent_at forward when the email really went out,
        // otherwise these jobs would never be alerted.
        if (!result.success) {
          console.error('Alert email failed:', alert.id, result.error);
          totalFailed++;
          continue;
        }

        await supabase
          .from('alerts')
          .update({ last_sent_at: new Date().toISOString() })
          .eq('id', alert.id);

        totalSent++;
      }
    } catch (err) {
      console.error('Alert failed:', alert.id, err);
    }
  }

  return NextResponse.json({ message: `Checked ${alerts.length} alerts, sent ${totalSent} emails, ${totalFailed} failed` });
}
