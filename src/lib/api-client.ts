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

// The error message from a failed API response, or a fallback. fetch() only
// throws on network failure, so callers must check res.ok themselves.
export async function apiError(res: Response, fallback = 'Something went wrong. Please try again.'): Promise<string> {
  if (res.status === 401) return 'Your session expired. Please log in again.';
  try {
    const data = await res.json();
    if (typeof data?.error === 'string' && data.error) return data.error;
  } catch {
    // not JSON
  }
  return fallback;
}
