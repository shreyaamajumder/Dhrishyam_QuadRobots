// src/services/supabase.ts
/**
 * Supabase Auth client for real sign-in.
 *
 * Reads VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY (both public values; never put a
 * secret key in a VITE_ variable). When either is missing, `supabase` is null and the app
 * falls back to the demo accounts, so local demo mode keeps working without Supabase.
 *
 * The client keeps the session in the browser and refreshes the access token before it
 * expires; api.ts asks it for the current token on every request.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// import.meta.env is undefined outside Vite (for example in `npm test`), so read it carefully.
const env: Record<string, string | undefined> = (typeof import.meta !== 'undefined' ? import.meta.env : undefined) ?? {};
const url = env.VITE_SUPABASE_URL as string | undefined;
const publishableKey = env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

export const supabase: SupabaseClient | null =
  url && publishableKey
    ? createClient(url.replace(/\/+$/, ''), publishableKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      })
    : null;

export const isSupabaseAuthEnabled = supabase !== null;
