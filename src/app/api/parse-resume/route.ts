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

  try {
    const formData = await req.formData();
    const file = formData.get('resume') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    }

    // Extract text from the file
    let resumeText = '';
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (file.name.endsWith('.pdf')) {
      const { PDFParse } = await import('pdf-parse');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const parser = new PDFParse(buffer) as any;
      if (parser.shouldParse()) await parser.load();
      const textResult = await parser.getText();
      resumeText = typeof textResult === 'string' ? textResult : String(textResult || '');
    } else if (file.name.endsWith('.txt') || file.name.endsWith('.md')) {
      resumeText = buffer.toString('utf-8');
    } else if (file.name.endsWith('.docx') || file.name.endsWith('.doc')) {
      // Basic text extraction from docx (XML-based)
      const text = buffer.toString('utf-8');
      // Strip XML tags for basic extraction
      resumeText = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    } else {
      // Try to read as text
      resumeText = buffer.toString('utf-8');
    }

    if (!resumeText || resumeText.length < 20) {
      return NextResponse.json({ error: 'Could not extract text from file. Try a PDF or TXT file.' }, { status: 400 });
    }

    // If no AI, do basic extraction
    if (!client) {
      return NextResponse.json({
        profile: {
          name: '',
          email: '',
          phone: '',
          headline: '',
          skills: [],
          bio: resumeText.slice(0, 500),
          portfolio_url: '',
          linkedin_url: '',
          upwork_url: '',
          resume_url: '',
        },
        raw_text: resumeText.slice(0, 1000),
      });
    }

    // Use AI to parse resume into structured profile
    const message = await client.messages.create({
      model: AI_MODEL,
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: `Extract profile information from this resume text. Return a JSON object with these fields:

{
  "name": "full name",
  "email": "email address",
  "phone": "phone number",
  "headline": "a short professional headline, max 10 words",
  "skills": ["skill1", "skill2", ...],
  "bio": "a 2-3 sentence professional summary written in first person, casual and human tone",
  "portfolio_url": "portfolio/website URL if found",
  "linkedin_url": "LinkedIn URL if found",
  "upwork_url": "Upwork URL if found"
}

Rules:
- Extract real data from the resume, don't make things up
- Skills should be specific technologies and tools (e.g. "React & Next.js", "Python", "Supabase & PostgreSQL"), not generic words
- Bio should sound natural and human, written as if the person is describing themselves casually
- If a field is not found, use an empty string or empty array
- Return ONLY the JSON, no other text

Resume text:
${resumeText.slice(0, 5000)}`,
        },
      ],
    });

    const content = message.content?.[0];
    if (!content || content.type !== 'text') {
      return NextResponse.json({ error: 'AI could not parse resume' }, { status: 500 });
    }

    let text = content.text.trim();
    if (text.startsWith('```')) {
      text = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }

    const parsed = JSON.parse(text);
    return NextResponse.json({ profile: parsed });
  } catch (err) {
    return NextResponse.json({ error: 'Failed to parse resume: ' + String(err) }, { status: 500 });
  }
}
