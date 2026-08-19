import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { verifyExtensionAuth } from '@/lib/auth-api';

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
  const auth = await verifyExtensionAuth(req);
  if (auth instanceof NextResponse) return auth;

  const client = getClient();

  try {
    const { job, profile, form_fields } = await req.json();

    // Fallback when no AI available — use template-based generation
    if (!client) {
      const skills = profile.skills?.slice(0, 4).join(', ') || 'various technologies';
      const coverLetter = `Hi,

I saw your listing for ${job.title} and wanted to reach out. I've been building apps and systems for over 6 years — shipped 7+ products, managed teams of 30+, and helped scale a business from $40K to $200K/month.

I'm experienced with ${skills}, and I pick things up fast. I'd love to discuss how I can contribute to your team.

Portfolio: ${profile.portfolio_url || ''}
LinkedIn: ${profile.linkedin_url || ''}

${profile.name}
${profile.email}
${profile.phone || ''}`.trim();

      const fields = {};
      for (const field of (form_fields || [])) {
        const label = (field.label || field.name || '').toLowerCase();
        if (label.includes('name')) fields[field.name || field.id] = profile.name;
        else if (label.includes('email')) fields[field.name || field.id] = profile.email;
        else if (label.includes('phone')) fields[field.name || field.id] = profile.phone || '';
        else if (label.includes('portfolio') || label.includes('website')) fields[field.name || field.id] = profile.portfolio_url || '';
        else if (label.includes('linkedin')) fields[field.name || field.id] = profile.linkedin_url || '';
      }

      return NextResponse.json({
        subject: `Application for ${job.title} — ${profile.name}`,
        cover_letter: coverLetter,
        fields,
        hidden_instructions_found: null,
      });
    }

    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      messages: [
        {
          role: 'user',
          content: `Generate a job application for the following position. The applicant needs to fill out an application form.

APPLICANT PROFILE:
- Name: ${profile.name}
- Email: ${profile.email}
- Phone: ${profile.phone || 'N/A'}
- Headline: ${profile.headline}
- Skills: ${profile.skills.join(', ')}
- Bio: ${profile.bio}
- Portfolio: ${profile.portfolio_url || 'N/A'}
- LinkedIn: ${profile.linkedin_url || 'N/A'}

JOB:
- Title: ${job.title}
- Company: ${job.company}
- Description: ${job.description?.slice(0, 2000) || 'No description'}

FORM FIELDS TO FILL (these are the actual form fields on the application page):
${JSON.stringify(form_fields || [], null, 2)}

CRITICAL — HIDDEN INSTRUCTIONS CHECK:
Many job posts (especially on OnlineJobs.ph) include hidden tests in the description like "Put 'Orange' in your subject line", "Start your message with the word 'Pineapple'", "Include the code XYZ123 in your application", etc. These are used to filter out applicants who didn't read the full description.
- Carefully scan the ENTIRE job description for ANY such instructions
- If found, follow them EXACTLY (use the exact word/phrase/code they specify)
- Apply them to the correct field (subject line, first line of message, etc.)
- If the instruction says to put something in the subject, include a "subject" key in your response

Generate responses for each form field. For text areas / cover letter fields, write a compelling, personalized message (under 200 words, sounds human, references specific job requirements).

Return a JSON object. Include a "cover_letter" key with a standalone cover letter message, a "subject" key if a subject line is needed, and a "fields" object mapping field names/IDs to values.

Example format:
{
  "subject": "subject line (include any hidden test words here if required)",
  "cover_letter": "the cover letter text",
  "fields": {
    "field_name_or_id": "value to fill",
    ...
  },
  "hidden_instructions_found": "description of any hidden test instructions found, or null if none"
}`,
        },
      ],
    });

    const content = message.content[0];
    if (content.type !== 'text') {
      return NextResponse.json({ error: 'Unexpected response' }, { status: 500 });
    }

    let text = content.text.trim();
    if (text.startsWith('```')) {
      text = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }

    const parsed = JSON.parse(text);
    return NextResponse.json(parsed);
  } catch (err) {
    console.error('Generate application error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
