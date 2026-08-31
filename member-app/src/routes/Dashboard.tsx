import { useEffect, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { supabase } from '../utils/supabase'

type Status = 'checking' | 'authed' | 'anon'

export function Dashboard() {
  const navigate = useNavigate()
  const [status, setStatus] = useState<Status>('checking')
  const [fullName, setFullName] = useState<string | null>(null)
  const [loggingOut, setLoggingOut] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function load() {
      const { data: sessionData } = await supabase.auth.getSession()

      if (!sessionData.session) {
        if (!cancelled) setStatus('anon')
        return
      }

      const { data: person } = await supabase
        .from('people')
        .select('full_name')
        .eq('auth_user_id', sessionData.session.user.id)
        .maybeSingle()

      if (!cancelled) {
        setFullName(person?.full_name ?? null)
        setStatus('authed')
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [])

  async function handleLogout() {
    setLoggingOut(true)
    await supabase.auth.signOut()
    navigate('/signup', { replace: true })
  }

  if (status === 'checking') return null
  if (status === 'anon') return <Navigate to="/signup" replace />

  return (
    <div className="flex-1 flex flex-col items-start gap-4 px-5 py-10 max-w-2xl mx-auto w-full">
      <h1 className="font-heading text-2xl font-semibold">
        Welcome{fullName ? `, ${fullName}` : ''}
      </h1>
      <p className="text-[var(--color-text-muted)]">
        Your dashboard is coming together — family tree, directory, events, and more will land
        here in the next phases.
      </p>
      <button
        type="button"
        onClick={handleLogout}
        disabled={loggingOut}
        className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-text-muted)] disabled:opacity-60 transition-colors"
      >
        {loggingOut ? 'Logging out…' : 'Log out'}
      </button>
    </div>
  )
}
