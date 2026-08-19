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

    // If no AI available, do basic keyword matching
    if (!client) {
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

    // AI-powered matching
    const jobSummaries = jobs.map((j, i) => `[${i}] "${j.title}" at ${j.company}: ${j.description?.slice(0, 300)}`).join('\n\n');

    const message = await client.messages.create({
      model: AI_MODEL,
      max_tokens: 2048,
      messages: [
        {
          role: 'user',
          content: `Score these job listings for a candidate. Return ONLY a JSON array.

CANDIDATE:
- Headline: ${profile.headline}
- Skills: ${profile.skills.join(', ')}
- Bio: ${profile.bio}

JOBS:
${jobSummaries}

For each job, return: {"index": number, "score": 0-100, "reason": "1 sentence why this is/isn't a good match", "should_apply": boolean}

Only include jobs with score >= 30. Sort by score descending. Return as a JSON array.`,
        },
      ],
    });

    const content = message.content?.[0];
    if (!content || content.type !== 'text') {
      return NextResponse.json({ matches: [] });
    }

    let text = content.text.trim();
    if (text.startsWith('```')) {
      text = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }

    const scored: { index: number; score: number; reason: string; should_apply: boolean }[] = JSON.parse(text);

    const matches = scored.map((s) => ({
      ...jobs[s.index],
      score: s.score,
      reason: s.reason,
      should_apply: s.should_apply,
    }));

    return NextResponse.json({ matches });
  } catch (err) {
    console.error('Match jobs error:', err);
    return NextResponse.json({ error: String(err), matches: [] }, { status: 500 });
  }
}
