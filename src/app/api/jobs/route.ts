import { NextRequest, NextResponse } from 'next/server';
import { searchJobs } from '@/lib/jobs-api';

// Simple in-memory rate limiting: max 10 requests per minute per IP
const rateLimit = new Map<string, { count: number; resetTime: number }>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimit.get(ip);

  if (!entry || now > entry.resetTime) {
    rateLimit.set(ip, { count: 1, resetTime: now + 60000 });
    return true;
  }

  if (entry.count >= 10) return false;

  entry.count++;
  return true;
}

export async function GET(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown';

  if (!checkRateLimit(ip)) {
    return NextResponse.json(
      { error: 'Too many requests. Please wait a moment before searching again.' },
      { status: 429 }
    );
  }
  const { searchParams } = req.nextUrl;
  const query = searchParams.get('q') || 'virtual assistant developer';
  const page = parseInt(searchParams.get('page') || '1');
  const remoteOnly = searchParams.get('remote') === 'true';
  const dateFilter = searchParams.get('date') || 'week';

  try {
    const jobs = await searchJobs(query, page, remoteOnly, dateFilter);
    return NextResponse.json({ jobs, count: jobs.length });
  } catch (err) {
    console.error('Search error:', err);
    return NextResponse.json({ error: 'Failed to fetch jobs' }, { status: 500 });
  }
}
