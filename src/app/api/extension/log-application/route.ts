import { NextRequest, NextResponse } from 'next/server';
import { verifyExtensionAuth } from '@/lib/auth-api';
import { getServiceClient } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

// Record an application the moment it is sent. Without this the message that
// went out is lost, and the end-of-day report has nothing to show.
export async function POST(req: NextRequest) {
  const auth = await verifyExtensionAuth(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await req.json() as {
      title?: string;
      company?: string;
      apply_url?: string;
      lane?: string;
      role?: string;
      score?: number;
      apply_points?: number;
      subject?: string;
      message?: string;
      posted_at?: string;
      // 'sent' or 'needs_manual' (a Loom video, a trial task, an external form)
      status?: string;
    };

    if (!body.title) {
      return NextResponse.json({ error: 'title is required' }, { status: 400 });
    }

    const { error } = await getServiceClient().from('applications').insert({
      user_id: auth.userId,
      title: body.title.slice(0, 300),
      company: (body.company || '').slice(0, 200),
      apply_url: (body.apply_url || '').slice(0, 1000),
      lane: (body.lane || '').slice(0, 40),
      role: (body.role || '').slice(0, 40),
      score: typeof body.score === 'number' ? Math.round(body.score) : null,
      apply_points: typeof body.apply_points === 'number' ? Math.round(body.apply_points) : null,
      subject: (body.subject || '').slice(0, 500),
      message: (body.message || '').slice(0, 20000),
      posted_at: (body.posted_at || '').slice(0, 40),
      // Without this every manual job was recorded as 'sent', so the popup
      // could not tell a Loom-video job from one that actually went out.
      status: body.status === 'needs_manual' ? 'needs_manual' : 'sent',
    });

    if (error) {
      console.error('log-application insert failed:', error);
      return NextResponse.json({ error: 'Could not record the application' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('log-application error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
