import { getServiceClient } from '@/lib/supabase';
import { ensureRoleHighlights } from '@/lib/role-highlights';
import type { WriterProfile } from '@/lib/application-writer';

// The authoritative profile for writing applications: the stored Supabase
// profile (which has the resume text, writing samples and role examples),
// overlaid with any non-empty fields the caller sent. Role examples are
// refreshed first if the resume or portfolio changed.
export async function loadWriterProfile(
  userId: string,
  bodyProfile: Record<string, unknown> = {}
): Promise<WriterProfile> {
  let stored: Record<string, unknown> = {};
  try {
    const { data } = await getServiceClient().from('profiles').select('*').eq('user_id', userId).maybeSingle();
    if (data) stored = data as Record<string, unknown>;
  } catch {
    // Supabase unavailable: fall back to what the caller sent.
  }

  const merged: Record<string, unknown> = { ...stored };
  for (const [k, v] of Object.entries(bodyProfile || {})) {
    if (k === 'role_highlights') continue; // always use the stored ones
    const empty = v == null || v === '' || (Array.isArray(v) && v.length === 0);
    if (!empty) merged[k] = v;
  }

  if (stored.user_id) {
    merged.role_highlights = await ensureRoleHighlights(userId, merged as WriterProfile);
  }
  return merged as WriterProfile;
}
