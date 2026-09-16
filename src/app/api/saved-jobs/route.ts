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
      .from('saved_jobs')
      .select('*')
      .eq('user_id', auth.userId)
      .order('created_at', { ascending: false });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ jobs: data });
  } catch {
    return NextResponse.json({ jobs: [], error: 'Supabase not configured' });
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const supabase = getServiceClient();
    const body = await req.json();

    const { data, error } = await supabase
      .from('saved_jobs')
      .upsert(
        {
          user_id: auth.userId,
          source_id: body.source_id,
          source: body.source,
          title: body.title,
          company: body.company,
          company_logo: body.company_logo,
          location: body.location,
          salary_min: body.salary_min,
          salary_max: body.salary_max,
          description: body.description,
          skills: body.skills,
          job_type: body.job_type,
          remote: body.remote,
          apply_url: body.apply_url,
          contact_email: body.contact_email,
          posted_at: body.posted_at,
          status: body.status || 'interested',
          notes: body.notes,
        },
        { onConflict: 'user_id,source_id' }
      )
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ job: data });
  } catch {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const supabase = getServiceClient();
    const { id, ...updates } = await req.json();

    // Never let the caller move a row to another user.
    delete updates.user_id;

    const { data, error } = await supabase
      .from('saved_jobs')
      .update(updates)
      .eq('id', id)
      .eq('user_id', auth.userId)
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ job: data });
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
      .from('saved_jobs')
      .delete()
      .eq('id', id)
      .eq('user_id', auth.userId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  }
}
