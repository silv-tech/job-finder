import { Resend, type CreateEmailOptions } from 'resend';

type SendResult = { success: boolean; error?: string; code?: string };

let resend: Resend | null = null;

function getResend() {
  if (!resend) {
    const key = process.env.RESEND_API_KEY;
    if (!key || key === 'your_resend_api_key_here') return null;
    resend = new Resend(key);
  }
  return resend;
}

// Resend does not throw on API errors (bad domain, invalid recipient, rate
// limit); it returns { data, error }. Check both paths so a failed send is
// never reported as success.
async function deliver(client: Resend, payload: CreateEmailOptions): Promise<SendResult> {
  try {
    const { data, error } = await client.emails.send(payload);
    if (error) {
      console.error('Resend error:', error);
      return { success: false, error: error.message || 'Email could not be sent', code: 'SEND_ERROR' };
    }
    if (!data?.id) return { success: false, error: 'Email could not be sent', code: 'SEND_ERROR' };
    return { success: true };
  } catch (err) {
    const message = String(err);
    const code = message.includes('fetch') || message.includes('ECONNREFUSED') || message.includes('timeout')
      ? 'NETWORK_ERROR'
      : 'SEND_ERROR';
    return { success: false, error: code === 'NETWORK_ERROR' ? 'Could not reach the email service' : 'Email could not be sent', code };
  }
}

export async function sendOutreachEmail(
  to: string,
  subject: string,
  body: string
): Promise<SendResult> {
  const client = getResend();
  if (!client) return { success: false, error: 'Resend API key not configured', code: 'CONFIG_ERROR' };

  return deliver(client, {
    from: `${process.env.SENDER_NAME} <${process.env.SENDER_EMAIL}>`,
    to,
    subject,
    html: body.replace(/\n/g, '<br>'),
  });
}

function escapeHtml(text: string): string {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeHttpUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

export async function sendAlertEmail(
  to: string,
  jobs: { title: string; company: string; apply_url: string }[]
): Promise<SendResult> {
  const client = getResend();
  if (!client) return { success: false, error: 'Resend API key not configured', code: 'CONFIG_ERROR' };

  // Job text comes from third-party job boards: show it as plain text, and only
  // link to real http(s) URLs.
  const jobList = jobs
    .map((j) => {
      const url = safeHttpUrl(j.apply_url);
      const apply = url ? ` - <a href="${escapeHtml(url)}">Apply</a>` : '';
      return `<li><strong>${escapeHtml(j.title)}</strong> at ${escapeHtml(j.company)}${apply}</li>`;
    })
    .join('\n');

  return deliver(client, {
    from: `Job Finder Alerts <${process.env.SENDER_EMAIL}>`,
    to,
    subject: `🔔 ${jobs.length} new job${jobs.length > 1 ? 's' : ''} found`,
    html: `
      <h2>New Jobs Matching Your Alerts</h2>
      <ul>${jobList}</ul>
      <p><a href="${process.env.NEXT_PUBLIC_APP_URL}">View all jobs →</a></p>
    `,
  });
}
