import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { verifyExtensionAuth } from '@/lib/auth-api';
import { AI_MODEL } from '@/lib/ai-config';

export const dynamic = 'force-dynamic';

let anthropic: Anthropic | null = null;

function getClient() {
  if (!anthropic) {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key || key === 'your_anthropic_api_key_here') return null;
    anthropic = new Anthropic({ apiKey: key });
  }
  return anthropic;
}

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

  const client = getClient();

  try {
    const { jobs, profile } = await req.json() as { jobs: ScrapedJob[]; profile: { skills: string[]; headline: string; bio: string } };

    if (!jobs || jobs.length === 0) {
      return NextResponse.json({ matches: [] });
    }

    // Always use fast keyword matching for job scanning
    // AI is reserved for writing actual applications where quality matters
    if (true) {
      const matches = jobs.map((job) => {
        const desc = (job.title + ' ' + (job.description || '')).toLowerCase();
        // More flexible matching — split skills into individual keywords
        const matchedSkills = profile.skills.filter((s) => {
          const parts = s.toLowerCase().split(/[\/&(,]+/).map((p) => p.trim()).filter(Boolean);
          return parts.some((part) => desc.includes(part));
        });
        const score = Math.min(100, Math.round((matchedSkills.length / Math.min(profile.skills.length, 5)) * 100));
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
    }
  } catch (err) {
    console.error('Match jobs error:', err);
    return NextResponse.json({ error: String(err), matches: [] }, { status: 500 });
  }
}
