import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Server-side Supabase client using the SERVICE ROLE key — bypasses
// RLS. Must NEVER be imported on the client (the env var
// SUPABASE_SERVICE_ROLE_KEY is server-only and not prefixed with
// NEXT_PUBLIC_).
//
// Lazy singleton: we don't initialise at module load because that
// would throw during Next.js build for routes that statically import
// this module if env vars happened to be missing. First runtime call
// from an API handler is the correct moment to fail fast.

let cachedClient: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient {
  if (cachedClient) return cachedClient;

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl) {
    throw new Error(
      "Missing SUPABASE_URL env var. Set it in .env.local for dev and on Vercel for production.",
    );
  }
  if (!supabaseServiceRoleKey) {
    throw new Error(
      "Missing SUPABASE_SERVICE_ROLE_KEY env var. Set it in .env.local for dev and on Vercel for production.",
    );
  }

  cachedClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false },
  });
  return cachedClient;
}
