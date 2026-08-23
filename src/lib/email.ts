import { Resend } from 'resend';

let resend: Resend | null = null;

function getResend() {
  if (!resend) {
    const key = process.env.RESEND_API_KEY;
    if (!key || key === 'your_resend_api_key_here') return null;
    resend = new Resend(key);
  }
  return resend;
}

export async function sendOutreachEmail(
  to: string,
  subject: string,
  body: string
): Promise<{ success: boolean; error?: string; code?: string }> {
  const client = getResend();
  if (!client) return { success: false, error: 'Resend API key not configured', code: 'CONFIG_ERROR' };

  try {
    await client.emails.send({
      from: `${process.env.SENDER_NAME} <${process.env.SENDER_EMAIL}>`,
      to,
      subject,
      html: body.replace(/\n/g, '<br>'),
    });
    return { success: true };
  } catch (err) {
    const message = String(err);
    const code = message.includes('fetch') || message.includes('ECONNREFUSED') || message.includes('timeout')
      ? 'NETWORK_ERROR'
      : 'SEND_ERROR';
    return { success: false, error: message, code };
  }
}

export async function sendAlertEmail(
  to: string,
  jobs: { title: string; company: string; apply_url: string }[]
): Promise<{ success: boolean; error?: string; code?: string }> {
  const client = getResend();
  if (!client) return { success: false, error: 'Resend API key not configured', code: 'CONFIG_ERROR' };

  const jobList = jobs
    .map((j) => `<li><strong>${j.title}</strong> at ${j.company} - <a href="${j.apply_url}">Apply</a></li>`)
    .join('\n');

  try {
    await client.emails.send({
      from: `Job Finder Alerts <${process.env.SENDER_EMAIL}>`,
      to,
      subject: `🔔 ${jobs.length} new job${jobs.length > 1 ? 's' : ''} found`,
      html: `
        <h2>New Jobs Matching Your Alerts</h2>
        <ul>${jobList}</ul>
        <p><a href="${process.env.NEXT_PUBLIC_APP_URL}">View all jobs →</a></p>
      `,
    });
    return { success: true };
  } catch (err) {
    const message = String(err);
    const code = message.includes('fetch') || message.includes('ECONNREFUSED') || message.includes('timeout')
      ? 'NETWORK_ERROR'
      : 'SEND_ERROR';
    return { success: false, error: message, code };
  }
}
