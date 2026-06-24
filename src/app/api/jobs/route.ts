import { NextRequest, NextResponse } from 'next/server';
import { searchJobs } from '@/lib/jobs-api';

export async function GET(req: NextRequest) {
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
