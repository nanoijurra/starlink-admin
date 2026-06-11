import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

export const SUPABASE_URL = 'https://vyvdqwqotxgoblixmloj.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_HALe1aF8ffTbQiGGbB5Fmw_PmyDnAkp';
export const SUPABASE_ANON_KEY = SUPABASE_PUBLISHABLE_KEY;

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true
  }
});
