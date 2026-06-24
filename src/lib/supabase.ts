import { createClient, SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null = null;
let serviceClient: SupabaseClient | null = null;

export function getSupabase() {
  if (!client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key || url === 'your_supabase_url_here') {
      throw new Error('Supabase not configured');
    }
    client = createClient(url, key);
  }
  return client;
}

export function getServiceClient() {
  if (!serviceClient) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key || url === 'your_supabase_url_here') {
      throw new Error('Supabase not configured');
    }
    serviceClient = createClient(url, key);
  }
  return serviceClient;
}
