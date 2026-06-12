import { createClient } from '@supabase/supabase-js';

// Values come from .env (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).
// Fallback kept so the app still works without a .env file.
const supabaseUrl =
  import.meta.env.VITE_SUPABASE_URL || 'https://gepwlkeagmoobjpemizh.supabase.co';
const supabaseKey =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdlcHdsa2VhZ21vb2JqcGVtaXpoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk0MjA3NTcsImV4cCI6MjA5NDk5Njc1N30.K7gvvBQYbLz3HIkWMAmBeJbaC4sKg-7ebEe84jFafOk';

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
  realtime: {
    params: {
      eventsPerSecond: 10,
    },
  },
});
