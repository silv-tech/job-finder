// The end-of-day report: what was applied to, where, and exactly what was sent.
// Built as plain HTML because it is read in an email client, so no external CSS,
// no web fonts, and inline styles only.

export interface ApplicationRow {
  title: string;
  company?: string | null;
  apply_url?: string | null;
  lane?: string | null;
  role?: string | null;
  score?: number | null;
  apply_points?: number | null;
  subject?: string | null;
  message?: string | null;
  sent_at?: string | null;
  // 'sent' or 'needs_manual'. Parked jobs are recorded in the same table, so
  // without this they were counted and described as having gone out.
  status?: string | null;
}

const LANE_LABELS: Record<string, string> = {
  developer: 'Developer',
  automations: 'Automations',
  automation: 'Automations',
  management: 'Management',
  exec_assistant: 'Exec Assistant',
  general_va: 'General VA',
};

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Philippine time, since that is the day the applicant and the site both run on.
export function phtDate(when: Date = new Date()): string {
  return new Date(when.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

function phtTime(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const shifted = new Date(d.getTime() + 8 * 3600 * 1000);
  return shifted.toISOString().slice(11, 16);
}

export function isParked(r: ApplicationRow): boolean {
  return r.status === 'needs_manual';
}

export function reportSubject(rows: ApplicationRow[], day: string): string {
  const sent = rows.filter((r) => !isParked(r));
  const parked = rows.filter(isParked);
  const tail = parked.length ? `, ${parked.length} waiting on you` : '';
  if (sent.length === 0) {
    return parked.length
      ? `Job Finder: nothing sent ${day}, ${parked.length} waiting on you`
      : `Job Finder: nothing sent ${day}`;
  }
  const best = Math.max(...sent.map((r) => r.score ?? 0));
  return `Job Finder: ${sent.length} application${sent.length > 1 ? 's' : ''} sent ${day} (best match ${best}%)${tail}`;
}

// The jobs that could not be finished automatically: a Loom video, a skills
// test, a call. The message is already written, so what is left is the video and
// a send. This goes at the TOP of the mail because it is the only part that is
// waiting on him.
function parkedSection(parked: ApplicationRow[]): string {
  if (parked.length === 0) return '';
  const items = parked.map((r) => {
    const link = r.apply_url
      ? `<a href="${esc(r.apply_url)}" style="color:#92400e;text-decoration:none;font-weight:700;">${esc(r.title)}</a>`
      : `<strong>${esc(r.title)}</strong>`;
    return `
      <tr><td style="padding:0 0 10px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
               style="border:1px solid #fde68a;border-radius:8px;background:#ffffff;">
          <tr><td style="padding:10px 12px;">
            <div style="font-size:14px;line-height:1.35;">${link}</div>
            <div style="font-size:12px;color:#b45309;padding-top:3px;">
              ${r.score ? `${esc(r.score)}% match &middot; ` : ''}${esc(LANE_LABELS[r.lane || ''] || r.lane || 'unclassified')}
            </div>
            <div style="font-size:12px;color:#92400e;padding-top:6px;">
              <strong>Subject:</strong> ${esc(r.subject || '(not drafted)')}
            </div>
          </td></tr>
        </table>
      </td></tr>`;
  }).join('');

  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
           style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;margin:0 0 20px;">
      <tr><td style="padding:14px 16px;">
        <div style="font-size:13px;font-weight:700;color:#92400e;padding-bottom:4px;">
          ${parked.length} job${parked.length > 1 ? 's' : ''} waiting on you
        </div>
        <div style="font-size:12px;color:#b45309;padding-bottom:10px;">
          These asked for a video, a test or a call, so nothing was sent. The message is
          already written and waiting in the extension popup under &ldquo;Needs you&rdquo;.
        </div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${items}</table>
      </td></tr>
    </table>`;
}

export function reportHtml(allRows: ApplicationRow[], day: string, pointsLeft?: number | null): string {
  const parked = allRows.filter(isParked);
  const rows = allRows.filter((r) => !isParked(r));
  const points = rows.reduce((n, r) => n + (r.apply_points ?? 0), 0);
  const byLane = rows.reduce<Record<string, number>>((acc, r) => {
    const k = r.lane || 'other';
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});

  const laneSummary = Object.entries(byLane)
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${esc(LANE_LABELS[k] || k)} ${n}`)
    .join(' &middot; ');

  if (rows.length === 0) {
    return wrap(day, `
      ${parkedSection(parked)}
      <p style="margin:0 0 8px;font-size:15px;color:#0f172a;">No applications went out today.</p>
      <p style="margin:0;font-size:13px;color:#64748b;">
        Either nothing cleared the match bar, the daily budget was already spent, or auto-apply was off.
        Apply Points refill at 10 a day and only on days you log in, so it is worth opening the site.
      </p>
    `);
  }

  const cards = rows.map((r) => {
    const score = r.score ?? 0;
    // Green for a strong match, amber for a marginal one. No red: nothing below
    // the bar was sent in the first place.
    const tone = score >= 85 ? '#047857' : score >= 70 ? '#b45309' : '#64748b';
    const link = r.apply_url
      ? `<a href="${esc(r.apply_url)}" style="color:#1d4ed8;text-decoration:none;">${esc(r.title)}</a>`
      : esc(r.title);

    return `
      <tr><td style="padding:0 0 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
               style="border:1px solid #e2e8f0;border-radius:10px;background:#ffffff;">
          <tr><td style="padding:14px 16px 10px;">
            <div style="font-size:15px;font-weight:700;color:#0f172a;line-height:1.35;">${link}</div>
            <div style="font-size:12px;color:#64748b;padding-top:3px;">
              ${esc(r.company || 'OnlineJobs.ph employer')}${r.sent_at ? ` &middot; sent ${esc(phtTime(r.sent_at))}` : ''}
            </div>
            <div style="padding-top:8px;font-size:12px;">
              <span style="color:${tone};font-weight:700;">${score}% match</span>
              <span style="color:#cbd5e1;"> | </span>
              <span style="color:#475569;">${esc(LANE_LABELS[r.lane || ''] || r.lane || 'unclassified')}</span>
              <span style="color:#cbd5e1;"> | </span>
              <span style="color:#475569;">${r.apply_points ?? 1} apply point${(r.apply_points ?? 1) === 1 ? '' : 's'}</span>
            </div>
          </td></tr>
          <tr><td style="padding:0 16px 14px;">
            <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:10px 12px;">
              <div style="font-size:10px;font-weight:700;letter-spacing:.06em;color:#94a3b8;text-transform:uppercase;">Subject</div>
              <div style="font-size:13px;color:#0f172a;padding:2px 0 8px;">${esc(r.subject || '(none)')}</div>
              <div style="font-size:10px;font-weight:700;letter-spacing:.06em;color:#94a3b8;text-transform:uppercase;">Message sent</div>
              <div style="font-size:13px;color:#1e293b;line-height:1.55;white-space:pre-wrap;padding-top:3px;">${esc(r.message || '(none)')}</div>
            </div>
          </td></tr>
        </table>
      </td></tr>`;
  }).join('');

  const pointsNote = pointsLeft == null
    ? 'Points left: not reported yet.'
    : `Points left: <strong style="color:#0f172a;">${pointsLeft}</strong>.`;

  return wrap(day, `
    ${parkedSection(parked)}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
           style="background:#f1f5f9;border-radius:10px;margin:0 0 20px;">
      <tr><td style="padding:14px 16px;">
        <div style="font-size:22px;font-weight:800;color:#0f172a;line-height:1;">
          ${rows.length} application${rows.length > 1 ? 's' : ''}
        </div>
        <div style="font-size:13px;color:#475569;padding-top:6px;">${laneSummary}</div>
        <div style="font-size:12px;color:#64748b;padding-top:8px;">
          ${points} apply point${points === 1 ? '' : 's'} spent. ${pointsNote}
        </div>
      </td></tr>
    </table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${cards}</table>
  `);
}

function wrap(day: string, inner: string): string {
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f8fafc;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
             style="max-width:640px;background:#ffffff;border-radius:12px;padding:24px;
                    font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
        <tr><td>
          <div style="font-size:11px;font-weight:700;letter-spacing:.08em;color:#94a3b8;text-transform:uppercase;">Job Finder</div>
          <div style="font-size:19px;font-weight:800;color:#0f172a;padding:2px 0 18px;">Daily report &middot; ${esc(day)}</div>
          ${inner}
          <div style="border-top:1px solid #e2e8f0;margin-top:18px;padding-top:12px;font-size:11px;color:#94a3b8;">
            Sent automatically at 5:00 PM Philippine time. Links go straight to each job post.
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}
