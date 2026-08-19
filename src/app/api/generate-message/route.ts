import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

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

export async function POST(req: NextRequest) {
  const client = getClient();
  if (!client) {
    return NextResponse.json(
      { error: 'Anthropic API key not configured. Add ANTHROPIC_API_KEY to .env.local' },
      { status: 500 }
    );
  }

  try {
    const { job, profile } = await req.json();

    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: `You are writing a job application message on behalf of ${profile.name}. Write a concise, natural, and personalized application email.

APPLICANT PROFILE:
- Name: ${profile.name}
- Headline: ${profile.headline}
- Skills: ${profile.skills.join(', ')}
- Bio: ${profile.bio}
- Portfolio: ${profile.portfolio_url || 'N/A'}
- LinkedIn: ${profile.linkedin_url || 'N/A'}

JOB DETAILS:
- Title: ${job.title}
- Company: ${job.company}
- Description: ${job.description?.slice(0, 2000) || 'No description available'}
- Required Skills: ${job.skills?.join(', ') || 'Not specified'}

CRITICAL — HIDDEN INSTRUCTIONS CHECK:
Many job posts (especially on OnlineJobs.ph) include hidden tests like "Put 'Orange' in your subject line", "Start your message with the word 'Pineapple'", "Include the code XYZ123", etc. Carefully scan the ENTIRE job description for any such instructions and follow them EXACTLY in the appropriate field (subject line, first line of body, etc.).

INSTRUCTIONS:
1. Write a subject line (short, professional, includes the job title — and any hidden test word/code if required by the description)
2. Write the email body that:
   - Opens with a natural, non-generic hook that references something specific about the job or company
   - Highlights 2-3 of the applicant's most relevant skills/experiences that match this specific job
   - Mentions concrete achievements (products shipped, revenue scaled, team managed) but only the ones relevant to this role
   - Keeps it under 200 words — hiring managers skim
   - Sounds like a real person, not a template
   - Includes portfolio/LinkedIn links naturally
   - Ends with a clear call to action
   - If a hidden test instruction requires something in the body, include it naturally
3. Do NOT use phrases like "I'm excited to apply" or "I believe I would be a great fit" — be direct and specific instead

Respond in this exact JSON format:
{"subject": "your subject line", "body": "your email body"}`,
        },
      ],
    });

    const content = message.content[0];
    if (content.type !== 'text') {
      return NextResponse.json({ error: 'Unexpected response format' }, { status: 500 });
    }

    // Parse the JSON response, handling potential markdown code blocks
    let text = content.text.trim();
    if (text.startsWith('```')) {
      text = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }

    const parsed = JSON.parse(text);
    return NextResponse.json({ subject: parsed.subject, body: parsed.body });
  } catch (err) {
    console.error('AI generation error:', err);
    return NextResponse.json(
      { error: 'Failed to generate message. ' + String(err) },
      { status: 500 }
    );
  }
}
