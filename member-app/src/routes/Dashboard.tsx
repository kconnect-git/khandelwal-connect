import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../utils/supabase'
import { getOwnPerson } from '../lib/people'
import { getProfileCompletion } from '../lib/profileCompletion'
import { listDirectory } from '../lib/directory'
import type { Person } from '../types/database'

export function Dashboard() {
  const navigate = useNavigate()
  const [person, setPerson] = useState<Person | null>(null)
  const [memberCount, setMemberCount] = useState<number | null>(null)
  const [loggingOut, setLoggingOut] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const { data: sessionData } = await supabase.auth.getSession()
        const session = sessionData.session
        if (!session) return

        const loaded = await getOwnPerson(session.user.id)
        if (!cancelled) setPerson(loaded)
      } catch (err) {
        console.error('[Dashboard] failed to load profile', err)
      }
    }

    load()
    listDirectory({ limit: 1 })
      .then((page) => {
        if (!cancelled) setMemberCount(page.length > 0 ? page[0].total_count : 0)
      })
      .catch((err) => console.error('[Dashboard] failed to load member count', err))

    return () => {
      cancelled = true
    }
  }, [])

  async function handleLogout() {
    setLoggingOut(true)
    await supabase.auth.signOut()
    navigate('/signup', { replace: true })
  }

  const completion = person ? getProfileCompletion(person) : null

  return (
    <div className="flex-1 flex flex-col items-start gap-4 px-5 py-10 max-w-2xl mx-auto w-full">
      <h1 className="font-heading text-2xl font-semibold">
        Welcome{person?.full_name ? `, ${person.full_name}` : ''}
      </h1>
      <p className="text-[var(--color-text-muted)]">
        Your dashboard is coming together — events and more will land here in the next phases.
      </p>

      {memberCount !== null && (
        <Link
          to="/directory"
          className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 hover:bg-[var(--color-surface-hover)] transition-colors"
        >
          <span className="font-heading text-3xl font-bold leading-tight">{memberCount}</span>
          <span className="block text-sm text-[var(--color-text-muted)]">
            members in the directory
          </span>
        </Link>
      )}

      {completion && (
        <div className="w-full flex flex-col gap-2">
          <p className="text-sm text-[var(--color-text-muted)]">
            {completion.completed}/{completion.total} fields · {completion.percent}% complete
          </p>
          <div className="w-full h-2 rounded-full bg-[var(--color-surface)] border border-[var(--color-border)] overflow-hidden">
            <div
              className="h-full bg-[var(--color-accent)]"
              style={{ width: `${completion.percent}%` }}
            />
          </div>
          {completion.missingNotYetEditable.length > 0 && (
            <p className="text-sm text-[var(--color-text-muted)]">
              {completion.missingNotYetEditable.map((f) => f.label).join(', ')} arrive in a later
              update.
            </p>
          )}
        </div>
      )}

      <div className="flex gap-3">
        <Link
          to="/profile/edit"
          className="rounded-lg bg-[var(--color-accent)] text-white font-medium px-4 py-2 text-sm hover:bg-[var(--color-accent-hover)] transition-colors"
        >
          Edit profile
        </Link>
        <button
          type="button"
          onClick={handleLogout}
          disabled={loggingOut}
          className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-text-muted)] disabled:opacity-60 transition-colors"
        >
          {loggingOut ? 'Logging out…' : 'Log out'}
        </button>
      </div>
    </div>
  )
}
