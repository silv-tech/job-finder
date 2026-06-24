import { NextRequest, NextResponse } from 'next/server';
import { sendOutreachEmail } from '@/lib/email';

export async function POST(req: NextRequest) {
  try {
    const { to, subject, body } = await req.json();

    if (!to || !subject || !body) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const result = await sendOutreachEmail(to, subject, body);

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Message error:', err);
    return NextResponse.json({ error: 'Failed to send message' }, { status: 500 });
  }
}
