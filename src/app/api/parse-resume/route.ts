import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { AI_MODEL } from '@/lib/ai-config';
import { requireAuth } from '@/lib/auth-api';

export const dynamic = 'force-dynamic';

// Block server-side requests to localhost / private / link-local hosts so this
// URL-import endpoint can't be used to reach internal services or cloud
// metadata (SSRF). Not bulletproof against DNS rebinding, but combined with the
// auth gate it closes the practical vectors.
function isSafeImportUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.internal') ||
    host === 'metadata.google.internal' ||
    host === '0.0.0.0' ||
    host === '::1'
  ) {
    return false;
  }
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const a = +m[1];
    const b = +m[2];
    if (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    ) {
      return false;
    }
  }
  return true;
}

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
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const client = getClient();

  try {
    let resumeText = '';

    // Check if it's a URL import (JSON body) or file upload (FormData)
    const contentType = req.headers.get('content-type') || '';

    if (contentType.includes('application/json')) {
      // URL import
      const body = await req.json();
      if (!body.url) {
        return NextResponse.json({ error: 'No URL provided' }, { status: 400 });
      }
      if (!isSafeImportUrl(body.url)) {
        return NextResponse.json({ error: 'That URL is not allowed' }, { status: 400 });
      }

      try {
        const res = await fetch(body.url, {
          redirect: 'error', // don't follow redirects into blocked hosts
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; JobFinder/1.0)' },
          signal: AbortSignal.timeout(15000),
        });
        if (!res.ok) throw new Error(`Failed to fetch: ${res.status}`);
        const html = await res.text();
        // Strip HTML tags to get text content
        resumeText = html
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 8000);
      } catch (err) {
        return NextResponse.json({ error: 'Could not fetch URL: ' + String(err) }, { status: 400 });
      }
    } else {
      // File upload
      const formData = await req.formData();
      const file = formData.get('resume') as File | null;

      if (!file) {
        return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
      }

      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      if (file.name.endsWith('.pdf')) {
        const { extractText } = await import('unpdf');
        const result = await extractText(new Uint8Array(arrayBuffer));
        resumeText = Array.isArray(result.text) ? result.text.join('\n') : String(result.text || '');
      } else if (file.name.endsWith('.txt') || file.name.endsWith('.md')) {
        resumeText = buffer.toString('utf-8');
      } else if (file.name.endsWith('.docx') || file.name.endsWith('.doc')) {
        const text = buffer.toString('utf-8');
        resumeText = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      } else {
        resumeText = buffer.toString('utf-8');
      }
    }

    if (!resumeText || resumeText.length < 20) {
      return NextResponse.json({ error: 'Could not extract text. Try a PDF, TXT, or a different URL.' }, { status: 400 });
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
    // Include the full resume text so it can be stored and used for applications
    parsed.resume_text = resumeText.slice(0, 10000);
    return NextResponse.json({ profile: parsed });
  } catch (err) {
    return NextResponse.json({ error: 'Failed to parse resume: ' + String(err) }, { status: 500 });
  }
}
