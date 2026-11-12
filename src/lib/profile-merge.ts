// Merging a saved profile onto the stored row.
//
// The save path is an upsert, which replaces the whole row, and every field
// used to be written as `body.x || ''`. The profile page saves whatever it
// currently holds, and it keeps local values when its GET on mount returns
// nothing, so one failed fetch was enough for the next Save to write empty
// strings over the real ones. resume_text and writing_samples are thousands of
// characters that exist nowhere else, and nothing warned before they went.
//
// Empty therefore means "leave it alone". Deliberately clearing a field is not
// something this single-user app needs; losing the resume is.

export const PROFILE_TEXT_FIELDS = [
  'name', 'email', 'phone', 'portfolio_url', 'linkedin_url', 'upwork_url',
  'resume_url', 'headline', 'bio', 'resume_text', 'writing_samples',
] as const;

const URL_FIELDS = ['portfolio_url', 'linkedin_url', 'upwork_url', 'resume_url'] as const;

// A link saved without a scheme is reproduced character-for-character in
// applications, where a bare domain is not a link.
export function normaliseUrl(value: string): string {
  const v = value.trim();
  if (!v) return v;
  if (/^https?:\/\//i.test(v)) return v;
  if (/^\/\//.test(v)) return `https:${v}`;
  return `https://${v.replace(/^\/+/, '')}`;
}

export function mergeProfileRow(
  existing: Record<string, unknown> | null | undefined,
  body: Record<string, unknown>,
  userId: string
): Record<string, unknown> {
  const row: Record<string, unknown> = { ...(existing || {}) };
  row.user_id = userId;

  for (const k of PROFILE_TEXT_FIELDS) {
    const v = body[k];
    if (typeof v === 'string' && v.trim()) row[k] = v;
    else if (row[k] == null) row[k] = '';
  }

  if (Array.isArray(body.skills) && body.skills.length) row.skills = body.skills;
  else if (row.skills == null) row.skills = [];

  for (const k of URL_FIELDS) {
    const v = row[k];
    if (typeof v === 'string') row[k] = normaliseUrl(v);
  }

  // Never written from a request body: the highlights are derived server-side
  // and a stale copy round-tripping through the browser would overwrite a
  // fresher one.
  delete row.role_highlights;

  row.updated_at = new Date().toISOString();
  return row;
}
