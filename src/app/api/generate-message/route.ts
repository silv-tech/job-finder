import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
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
      model: AI_MODEL,
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: `You are writing a job application message on behalf of ${profile.name}. Write a concise, natural, and personalized application email.

APPLICANT PROFILE:
- Name: ${profile.name}
- Headline: ${profile.headline}
- Skills: ${profile.skills?.join(', ')}
- Bio: ${profile.bio}
- Portfolio: ${profile.portfolio_url || 'N/A'}
- LinkedIn: ${profile.linkedin_url || 'N/A'}
${profile.resume_text ? `
FULL RESUME/PORTFOLIO (use ONLY facts from this when writing, do not make up experience):
${profile.resume_text.slice(0, 5000)}
` : ''}

JOB DETAILS:
- Title: ${job.title}
- Company: ${job.company}
- Description: ${job.description?.slice(0, 6000) || 'No description available'}
- Required Skills: ${job.skills?.join(', ') || 'Not specified'}

CRITICAL — READ THE FULL JOB DESCRIPTION CAREFULLY:

1. HIDDEN INSTRUCTIONS: Scan for hidden tests like "Put 'Orange' in your subject line", "Include the code XYZ123", etc. Follow them EXACTLY.

2. APPLICATION REQUIREMENTS (VERY IMPORTANT): Many job posts end with specific questions like "When applying, please explain...", "Tell us about...", "Please briefly describe...". You MUST find and answer ALL of these. If the post asks 5 questions, answer all 5 using the applicant's real experience. Missing these makes the application look like spam.

3. WRITING STYLE:
- NEVER use the em dash character. Use a comma, period, or rewrite the sentence.
- Write like a real person who genuinely wants this job. Sincere, warm, grounded.
- Simple, natural language. Short sentences.
- No AI-sounding phrases like "I'm excited to", "leverage my skills", "dynamic team", "thriving environment".
- Sound like someone who carefully read the entire job post.
- Reference specific things from the description.
- Sign off with first name only.
- If the job asks specific questions, the message can be longer. Otherwise keep it under 150 words.

INSTRUCTIONS:
1. Write a simple subject line (include any hidden test word if required)
2. Write the email body that:
   - Opens naturally, references something specific about this job
   - Answers ALL application requirements/questions from the job post
   - Highlights relevant skills/experiences that match this role
   - Mentions concrete achievements but only relevant ones
   - Includes portfolio/LinkedIn links naturally
   - Ends with a simple call to action

Respond in this exact JSON format:
{"subject": "your subject line", "body": "your email body"}`,
        },
      ],
    });

    const content = message.content?.[0];
    if (!content || content.type !== 'text') {
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
