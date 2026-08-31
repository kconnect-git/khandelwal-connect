import { createClient } from '@supabase/supabase-js'
import type { Database } from '../types/database'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error(
    '[supabase] Missing env vars at build time.',
    'VITE_SUPABASE_URL:', supabaseUrl ? 'set' : 'MISSING',
    'VITE_SUPABASE_PUBLISHABLE_KEY:', supabaseKey ? 'set' : 'MISSING',
    '— on Vercel, these must be set in Project Settings > Environment Variables',
    'and the project redeployed after adding them (Vite inlines env vars at build time).',
  )
}

export const supabase = createClient<Database>(supabaseUrl, supabaseKey)

supabase.auth.onAuthStateChange((event, session) => {
  console.log('[supabase auth]', event, session?.user?.id ?? null)
})
