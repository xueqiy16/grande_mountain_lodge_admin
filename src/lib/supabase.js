import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabaseConfigError = (!supabaseUrl || !supabaseAnonKey)
  ? 'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Add them to a .env.local file in the project root (LodgeOS), then restart npm run dev.'
  : null

// Do not call createClient with empty values — that throws and leaves a blank page.
export const supabase = supabaseConfigError
  ? null
  : createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        storage: window.sessionStorage, // wipe session when the browser tab closes
        autoRefreshToken: true,
        persistSession: true
      }
    })
