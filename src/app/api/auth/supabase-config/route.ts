import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Exposes public Supabase config for the Chrome extension to authenticate directly
// These are public keys (anon key) — safe to expose
export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey || url === 'your_supabase_url_here') {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  }

  return NextResponse.json({ url, anonKey });
}
