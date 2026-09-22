import { NextRequest, NextResponse } from 'next/server';
import { verifyExtensionAuth } from '@/lib/auth-api';
import { detectRole } from '@/lib/roles';
import { LANES, apForScore, bestLane, isLaneKey, scoreForLane } from '@/lib/lanes';

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
    const { jobs, min_score, lane } = await req.json() as {
      jobs: ScrapedJob[];
      min_score?: number;
      lane?: string;
    };

    if (!jobs || jobs.length === 0) {
      return NextResponse.json({ matches: [] });
    }

    // Applying broadly to weak-fit jobs is the loudest automation signal and the
    // fastest way to get an account flagged, and every application costs Apply
    // Points that only refill at 10 a day. So the bar is a real fit, scored
    // against what the lane actually asks for rather than a keyword count.
    const laneKey = isLaneKey(lane) ? lane : null;
    const threshold = typeof min_score === 'number'
      ? min_score
      : laneKey ? LANES[laneKey].minScore : 60;

    const matches = jobs.map((job) => {
      const scored = laneKey ? scoreForLane(job, laneKey) : bestLane(job);
      const should_apply = scored.score >= threshold;
      return {
        ...job,
        score: scored.score,
        should_apply,
        lane: scored.lane,
        // The playbook to write with: what the post actually reads as, falling
        // back to the lane's own role when nothing is detected.
        role: detectRole(job) || LANES[scored.lane].role,
        // Points to spend if this one is applied to. Stronger match, more points.
        apply_points: apForScore(scored.score),
        reason: scored.reason,
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
