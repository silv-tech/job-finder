import { NextRequest, NextResponse } from 'next/server';
import { verifyExtensionAuth } from '@/lib/auth-api';
import { getServiceClient } from '@/lib/supabase';
import { detectRole } from '@/lib/roles';
import { LANES, apForScore, bestLane, isLaneKey, scoreForLane } from '@/lib/lanes';
import { checkDisqualifiers } from '@/lib/disqualifiers';

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

// Everything the applicant can honestly claim, as one blob, for checking a
// post's hard requirements against.
async function backgroundText(userId: string): Promise<string> {
  try {
    const { data } = await getServiceClient()
      .from('profiles')
      .select('resume_text, skills, bio, headline, role_highlights')
      .eq('user_id', userId)
      .single();
    if (!data) return '';
    const highlights = Object.values(data.role_highlights || {})
      .filter((v) => typeof v === 'string')
      .join('\n');
    return [data.resume_text, (data.skills || []).join(' '), data.bio, data.headline, highlights]
      .filter(Boolean)
      .join('\n');
  } catch {
    return '';
  }
}

export async function POST(req: NextRequest) {
  const auth = await verifyExtensionAuth(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const { jobs, min_score, lane } = await req.json() as {
      jobs: ScrapedJob[];
      min_score?: number;
      lane?: string;
    };

    if (!jobs || jobs.length === 0) {
      return NextResponse.json({ matches: [] });
    }

    const laneKey = isLaneKey(lane) ? lane : null;
    const threshold = typeof min_score === 'number'
      ? min_score
      : laneKey ? LANES[laneKey].minScore : 60;

    const background = await backgroundText(auth.userId);

    const matches = jobs.map((job) => {
      const scored = laneKey ? scoreForLane(job, laneKey) : bestLane(job);

      // A post that says "do not apply unless you have X" means it. Keyword
      // overlap cannot see that sentence, so it overrides the score outright:
      // applying anyway spends a point and annoys someone who asked us not to.
      const gate = checkDisqualifiers(job.description || '', background);

      const should_apply = scored.score >= threshold && !gate.blocked;

      return {
        ...job,
        score: scored.score,
        should_apply,
        blocked_by: gate.blocked ? gate.missing : undefined,
        lane: scored.lane,
        role: detectRole(job) || LANES[scored.lane].role,
        apply_points: apForScore(scored.score),
        reason: gate.blocked
          ? `Skipped: the post requires ${gate.missing.join(', ')}, which isn't in the background. "${gate.quote}"`
          : scored.reason,
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
