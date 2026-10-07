import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

if (!url || !publishableKey || publishableKey.startsWith('sb_secret_')) {
  throw new Error('Supabase browser configuration is missing or unsafe.')
}

export const supabase = createClient(url, publishableKey, {
  auth: {
    autoRefreshToken: true,
    detectSessionInUrl: false,
    persistSession: true,
  },
})
