import { getSupabase } from './supabase';

// fetch() wrapper that attaches the logged-in user's Supabase access token as a
// Bearer header, so the API routes can authenticate the caller and scope data
// to that user. Falls back to an unauthenticated request if there is no session
// (the route will then reject it with 401).
export async function authedFetch(
  input: RequestInfo | URL,
  init: RequestInit = {}
): Promise<Response> {
  const headers = new Headers(init.headers);
  try {
    const { data } = await getSupabase().auth.getSession();
    const token = data.session?.access_token;
    if (token) headers.set('Authorization', `Bearer ${token}`);
  } catch {
    // Supabase not configured or no session — send as-is.
  }
  return fetch(input, { ...init, headers });
}
