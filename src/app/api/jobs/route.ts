import { NextRequest, NextResponse } from 'next/server';
import { searchJobs } from '@/lib/jobs-api';
import type { Job } from '@/lib/types';

// Several filters can be searched in one request (repeat ?q=). This counts as
// one request against the rate limit.
const MAX_QUERIES = 12;
const CONCURRENCY = 4;

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
  const queries = [...new Set(searchParams.getAll('q').map((q) => q.trim()).filter(Boolean))].slice(0, MAX_QUERIES);
  if (queries.length === 0) queries.push('virtual assistant developer');
  const page = parseInt(searchParams.get('page') || '1');
  const remoteOnly = searchParams.get('remote') === 'true';
  const dateFilter = searchParams.get('date') || 'week';

  try {
    const results: Job[][] = new Array(queries.length);
    let next = 0;
    async function worker() {
      while (next < queries.length) {
        const i = next++;
        results[i] = await searchJobs(queries[i], page, remoteOnly, dateFilter).catch((err) => {
          console.error('Search error:', queries[i], err);
          return [];
        });
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queries.length) }, worker));

    // Deduplicate across queries by title + company
    const seen = new Set<string>();
    const jobs = results.flat().filter((job) => {
      const key = `${job.title.toLowerCase()}_${job.company.toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return NextResponse.json({ jobs, count: jobs.length });
  } catch (err) {
    console.error('Search error:', err);
    return NextResponse.json({ error: 'Failed to fetch jobs' }, { status: 500 });
  }
}
