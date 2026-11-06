import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../utils/supabase'
import { getOwnPerson } from '../lib/people'
import { deleteBusiness, getMyBusinesses } from '../lib/businesses'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { MyBusinessesList } from '../components/businesses/MyBusinessesList'
import type { BusinessRow } from '../types/database'

// Phase 10.5: the owner's own listings with where each stands with the
// admins. Replaces the old /businesses/mine -> Profile redirect; Profile >
// Business now just links here.

export function MyBusinesses() {
  const [businesses, setBusinesses] = useState<BusinessRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [removing, setRemoving] = useState<BusinessRow | null>(null)
  const [removeBusy, setRemoveBusy] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const { data } = await supabase.auth.getSession()
        const session = data.session
        if (!session) throw new Error('Please sign in again.')
        const person = await getOwnPerson(session.user.id)
        if (!person) throw new Error('Could not load your profile.')
        const loaded = await getMyBusinesses(person.id)
        if (!cancelled) setBusinesses(loaded)
      } catch (err) {
        if (cancelled) return
        console.error('[MyBusinesses] failed to load', err)
        setError(err instanceof Error ? err.message : 'Something went wrong loading your listings.')
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [])

  async function handleRemove() {
    if (!removing) return
    setRemoveBusy(true)
    setError(null)
    try {
      await deleteBusiness(removing)
      setBusinesses((current) => current?.filter((b) => b.id !== removing.id) ?? null)
      setRemoving(null)
    } catch (err) {
      setRemoving(null)
      setError(err instanceof Error ? err.message : 'Something went wrong removing this listing.')
    } finally {
      setRemoveBusy(false)
    }
  }

  return (
    <div className="flex-1 flex flex-col gap-5 px-5 py-8 max-w-2xl mx-auto w-full">
      <Link
        to="/businesses"
        className="text-xs font-semibold uppercase tracking-widest text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
      >
        ‹ Businesses
      </Link>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <h1 className="font-heading text-2xl font-semibold">My businesses</h1>
          <Link
            to="/businesses/new"
            className="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--color-accent-hover)] transition-colors"
          >
            + Add
          </Link>
        </div>
        <p className="text-sm text-[var(--color-text-muted)]">
          New listings are shown to members after an admin approves them.
        </p>
      </div>

      {error && <p className="text-sm text-[var(--color-accent)]">{error}</p>}

      {businesses === null ? (
        !error && <p className="text-sm text-[var(--color-text-muted)]">Loading your listings…</p>
      ) : (
        <>
          {businesses.length > 0 && (
            <MyBusinessesList businesses={businesses} onRemove={setRemoving} />
          )}
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-[var(--color-border)] px-4 py-6 text-center">
            <p className="text-sm text-[var(--color-text-muted)]">
              {businesses.length > 0
                ? 'Own another business? Add it here.'
                : 'You haven’t listed a business yet.'}
            </p>
            <Link
              to="/businesses/new"
              className="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--color-accent-hover)] transition-colors"
            >
              List a business
            </Link>
          </div>
        </>
      )}

      <ConfirmDialog
        open={removing !== null}
        title={removing ? `Remove "${removing.name}"?` : ''}
        description="It's deleted for good. You can list your business again as a new listing."
        confirmLabel="Remove listing"
        busy={removeBusy}
        onConfirm={() => handleRemove()}
        onCancel={() => setRemoving(null)}
      />
    </div>
  )
}
