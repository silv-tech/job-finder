import { NextRequest, NextResponse } from 'next/server';
import { verifyExtensionAuth } from '@/lib/auth-api';
import { getServiceClient } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

// GET - fetch profile for the authenticated user
export async function GET(req: NextRequest) {
  const auth = await verifyExtensionAuth(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const supabase = getServiceClient();
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('user_id', auth.userId)
      .single();

    if (error || !data) {
      // No profile yet, return empty
      return NextResponse.json({ profile: null });
    }

    return NextResponse.json({
      profile: {
        name: data.name || '',
        email: data.email || auth.email,
        phone: data.phone || '',
        portfolio_url: data.portfolio_url || '',
        linkedin_url: data.linkedin_url || '',
        upwork_url: data.upwork_url || '',
        resume_url: data.resume_url || '',
        headline: data.headline || '',
        skills: data.skills || [],
        bio: data.bio || '',
      },
    });
  } catch {
    return NextResponse.json({ profile: null, error: 'Could not fetch profile' });
  }
}

// POST - save profile (from app or extension)
export async function POST(req: NextRequest) {
  // Try auth header first (extension), fall back to no-auth (same-origin app)
  const authHeader = req.headers.get('authorization');
  let userId: string | null = null;

  if (authHeader?.startsWith('Bearer ')) {
    const auth = await verifyExtensionAuth(req);
    if (auth instanceof NextResponse) return auth;
    userId = auth.userId;
  }

  try {
    const body = await req.json();

    // If no userId from auth, try to get from body (app sends it)
    if (!userId) userId = body.user_id || null;
    if (!userId) return NextResponse.json({ error: 'No user ID' }, { status: 400 });

    const supabase = getServiceClient();

    const { error } = await supabase
      .from('profiles')
      .upsert({
        user_id: userId,
        name: body.name || '',
        email: body.email || '',
        phone: body.phone || '',
        portfolio_url: body.portfolio_url || '',
        linkedin_url: body.linkedin_url || '',
        upwork_url: body.upwork_url || '',
        resume_url: body.resume_url || '',
        headline: body.headline || '',
        skills: body.skills || [],
        bio: body.bio || '',
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'Could not save profile' }, { status: 500 });
  }
}
