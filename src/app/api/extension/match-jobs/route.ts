import { NextRequest, NextResponse } from 'next/server';
import { verifyExtensionAuth } from '@/lib/auth-api';

export const dynamic = 'force-dynamic';

interface ScrapedJob {
  title: string;
  company: string;
  description: string;
  salary?: string;
  location?: string;
  apply_url: string;
  source: string;
}

export async function POST(req: NextRequest) {
  const auth = await verifyExtensionAuth(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const { jobs, profile } = await req.json() as { jobs: ScrapedJob[]; profile: { skills: string[]; headline: string; bio: string } };

    if (!jobs || jobs.length === 0) {
      return NextResponse.json({ matches: [] });
    }

    // Fast keyword matching for all job scanning
    const matches = jobs.map((job) => {
      const desc = (job.title + ' ' + (job.description || '')).toLowerCase();
      const matchedSkills = (profile.skills || []).filter((s) => {
        const parts = s.toLowerCase().split(/[\/&(,]+/).map((p) => p.trim()).filter(Boolean);
        return parts.some((part) => desc.includes(part));
      });
      const score = Math.min(100, Math.round((matchedSkills.length / Math.min(profile.skills?.length || 1, 5)) * 100));
      const should_apply = score >= 40;
      return {
        ...job,
        score,
        should_apply,
        reason: matchedSkills.length > 0
          ? `Matched ${matchedSkills.length} skills: ${matchedSkills.join(', ')}`
          : 'No skill matches found',
      };
    });

    return NextResponse.json({
      matches: matches.filter((m) => m.score > 0).sort((a, b) => b.score - a.score),
    });
  } catch (err) {
    console.error('Match jobs error:', err);
    return NextResponse.json({ error: String(err), matches: [] }, { status: 500 });
  }
}
