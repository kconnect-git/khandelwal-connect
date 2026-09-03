import { createClient, type SupabaseClient } from '@supabase/supabase-js'
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

// Vite HMR re-executes this module on every edit without disposing the
// previous client. Since createClient() + onAuthStateChange() both run at
// module scope, that used to spin up a new GoTrueClient (and a new auth
// listener) on each reload -- all sharing the same localStorage session key,
// which made them fire duplicate/looping SIGNED_IN events at each other.
// Stashing the client on globalThis in dev makes HMR reloads reuse the same
// instance instead of piling up new ones.
type SupabaseGlobal = { __supabase?: SupabaseClient<Database> }
const globalForSupabase = globalThis as unknown as SupabaseGlobal

export const supabase =
  globalForSupabase.__supabase ?? createClient<Database>(supabaseUrl, supabaseKey)

if (import.meta.env.DEV) {
  if (!globalForSupabase.__supabase) {
    supabase.auth.onAuthStateChange((event, session) => {
      console.log('[supabase auth]', event, session?.user?.id ?? null)
    })
  }
  globalForSupabase.__supabase = supabase
  // Console access for debugging/RLS spot-checks (dev builds only):
  // `await supabase.from('people').select('*')` etc.
  ;(window as unknown as { supabase: SupabaseClient<Database> }).supabase = supabase
} else {
  supabase.auth.onAuthStateChange((event, session) => {
    console.log('[supabase auth]', event, session?.user?.id ?? null)
  })
}
