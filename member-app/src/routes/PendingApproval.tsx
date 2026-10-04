import { useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { useProfileStatus } from '../hooks/useProfileStatus'
import { useProfileRefresh } from '../context/ProfileRefreshContext'
import { ProfileLoadError } from '../components/guards/ProfileLoadError'
import { submitForReview } from '../lib/people'
import { supabase } from '../utils/supabase'
import { clearReturnTo } from '../lib/returnTo'

// Phase 5a. Where a member sits between finishing the wizard and being let
// into the app. Three faces, driven by people.member_status:
//
//   pending         we have it, an admin will look
//   info_requested  the admin asked for something -- edit, then resubmit
//   rejected        declined, with the reason; no self-resubmit (an admin can
//                   reopen it from the Rejected tab of the queue)
//
// Reads its own status rather than taking it as a prop so that resubmitting
// (and triggerRefresh from the Profile page) re-renders it immediately.
//
// The member code is deliberately not shown here. It is issued at wizard
// completion, but printing an ID next to "not approved yet" reads as a
// contradiction -- the header hides it for the same reason.
export function PendingApproval() {
  // Reading `version` is what makes triggerRefresh() below actually refetch --
  // useProfileStatus only re-runs when its key changes.
  const { version, triggerRefresh } = useProfileRefresh()
  const status = useProfileStatus(version)
  const navigate = useNavigate()
  const [submitting, setSubmitting] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (status.state === 'loading') return null
  if (status.state === 'error') {
    return <ProfileLoadError message={status.message} retry={status.retry} />
  }
  if (status.state === 'anonymous') return <Navigate to="/signup" replace />
  if (status.state === 'incomplete') return <Navigate to="/onboarding" replace />
  if (status.state === 'complete') return <Navigate to="/dashboard" replace />

  const person = status.person

  async function handleResubmit() {
    setSubmitting(true)
    setError(null)
    try {
      await submitForReview()
      triggerRefresh()
    } catch (err) {
      console.error('[PendingApproval] failed to resubmit', err)
      setError(err instanceof Error ? err.message : 'Could not send your profile for review.')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleLogout() {
    setLoggingOut(true)
    clearReturnTo()
    await supabase.auth.signOut()
    setLoggingOut(false)
    navigate('/signup', { replace: true })
  }

  const canResubmit = person.member_status === 'info_requested'

  return (
    <div className="mx-auto w-full max-w-lg px-5 py-10">
      {person.member_status === 'pending' && (
        <>
          <h1 className="font-heading text-2xl font-semibold">Your membership is under review</h1>
          <p className="mt-3 text-sm text-[var(--color-text-muted)]">
            Thanks{person.first_name ? `, ${person.first_name}` : ''} — we have your details. An
            admin from the mandal will check them and approve your account. You'll get an email as
            soon as that happens.
          </p>
        </>
      )}

      {person.member_status === 'info_requested' && (
        <>
          <h1 className="font-heading text-2xl font-semibold">We need a little more information</h1>
          <p className="mt-3 text-sm text-[var(--color-text-muted)]">
            An admin looked at your profile and asked for this before approving it:
          </p>
          {person.admin_message && (
            <blockquote className="mt-4 rounded-lg border-l-2 border-[var(--color-accent)] bg-[var(--color-surface)] px-4 py-3 text-sm whitespace-pre-line">
              {person.admin_message}
            </blockquote>
          )}
          <p className="mt-4 text-sm text-[var(--color-text-muted)]">
            Update your profile, then send it back for review.
          </p>
        </>
      )}

      {person.member_status === 'rejected' && (
        <>
          <h1 className="font-heading text-2xl font-semibold">Your application was not approved</h1>
          {person.admin_message && (
            <blockquote className="mt-4 rounded-lg border-l-2 border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-sm whitespace-pre-line">
              {person.admin_message}
            </blockquote>
          )}
          <p className="mt-4 text-sm text-[var(--color-text-muted)]">
            If you think this is a mistake, please get in touch with your mandal and they can look
            at it again.
          </p>
        </>
      )}

      {error && <p className="mt-4 text-sm text-[var(--color-accent)]">{error}</p>}

      <div className="mt-8 flex flex-wrap items-center gap-3">
        {canResubmit && (
          <button
            type="button"
            onClick={handleResubmit}
            disabled={submitting}
            className="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-50"
          >
            {submitting ? 'Sending…' : 'Resubmit for review'}
          </button>
        )}
        {person.member_status !== 'rejected' && (
          <Link
            to="/profile"
            className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm font-medium hover:bg-[var(--color-surface-hover)]"
          >
            {canResubmit ? 'Edit profile' : 'Review your profile'}
          </Link>
        )}
        <button
          type="button"
          onClick={handleLogout}
          disabled={loggingOut}
          className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-60"
        >
          {loggingOut ? 'Logging out…' : 'Log out'}
        </button>
      </div>
    </div>
  )
}
