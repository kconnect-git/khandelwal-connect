import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  POST_KIND_LABELS,
  POST_REPORT_REASON_OPTIONS,
  deleteBusinessPost,
  listBusinessPostResponses,
  reportBusinessPost,
  respondToBusinessPost,
  setBusinessPostOpen,
  setBusinessPostSaved,
  whatsAppLink,
} from '../../lib/businessPosts'
import { Avatar } from '../Avatar'
import { ConfirmDialog } from '../ConfirmDialog'
import { ReportDialog } from '../ReportDialog'
import type { BusinessPostResponder, BusinessPostRow, BusinessPostStatus } from '../../types/database'

// Phase 10.6: one Buy & Sell post. Browsing: Respond (records it, then
// hands over to WhatsApp), Save, Report. On the poster's own "Mine" tab:
// its state, who responded, and Close / Renew / Delete.

const DATE_FORMAT = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' })

const KIND_PILL: Record<BusinessPostRow['kind'], string> = {
  requirement: 'bg-[var(--color-chip-cool-bg)] text-[var(--color-chip-cool-fg)]',
  offer: 'bg-[var(--color-badge-live-bg)] text-[var(--color-badge-live-fg)]',
}

const STATUS_LABELS: Record<BusinessPostStatus, string> = {
  open: 'Open',
  closed: 'Closed',
  expired: 'Expired',
  hidden: 'Hidden by an admin',
}

const PRIMARY =
  'rounded-lg bg-[var(--color-accent)] py-2 text-sm font-semibold text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-60 transition-colors'
const OUTLINE =
  'rounded-lg border border-[var(--color-border)] py-2 text-sm font-semibold hover:border-[var(--color-text-muted)] disabled:opacity-60 transition-colors'

type Pending = 'close' | 'renew' | 'delete' | null

export function PostCard({
  post,
  onChanged,
  onRemoved,
}: {
  post: BusinessPostRow
  /** The post changed in a way the list should reload for (closed, renewed). */
  onChanged: () => void
  onRemoved: (id: string) => void
}) {
  const [saved, setSaved] = useState(post.is_saved)
  const [responded, setResponded] = useState(post.has_responded)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)
  const [reported, setReported] = useState(false)
  const [pending, setPending] = useState<Pending>(null)
  const [responders, setResponders] = useState<BusinessPostResponder[] | null>(null)
  const [showResponders, setShowResponders] = useState(false)

  const metaLine = [post.terms, post.city].filter(Boolean).join(' · ')
  const byLine = [post.poster_name, post.business_name].filter(Boolean).join(' · ')

  async function handleRespond() {
    setBusy(true)
    setError(null)
    try {
      const phone = await respondToBusinessPost(post.id)
      setResponded(true)
      // Same tab: a window.open after an await is blocked on most phones.
      window.location.href = whatsAppLink(
        phone,
        `Hi, I saw your Buy & Sell post "${post.title}" on KITE.`,
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open this post.')
    } finally {
      setBusy(false)
    }
  }

  async function handleToggleSaved() {
    const next = !saved
    setSaved(next)
    setError(null)
    try {
      await setBusinessPostSaved(post.id, next)
    } catch (err) {
      setSaved(!next)
      setError(err instanceof Error ? err.message : 'Could not update your saved posts.')
    }
  }

  async function handleReport(reason: string, details: string) {
    setBusy(true)
    setError(null)
    try {
      await reportBusinessPost(post.id, reason, details)
      setReported(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send your report.')
    } finally {
      setReportOpen(false)
      setBusy(false)
    }
  }

  async function handleToggleResponders() {
    const next = !showResponders
    setShowResponders(next)
    if (next && responders === null) {
      try {
        setResponders(await listBusinessPostResponses(post.id))
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not load who responded.')
      }
    }
  }

  async function handlePending() {
    if (!pending) return
    setBusy(true)
    setError(null)
    try {
      if (pending === 'delete') {
        await deleteBusinessPost(post.id)
        setPending(null)
        onRemoved(post.id)
        return
      }
      await setBusinessPostOpen(post.id, pending === 'renew')
      setPending(null)
      onChanged()
    } catch (err) {
      setPending(null)
      setError(err instanceof Error ? err.message : 'Could not update this post.')
    } finally {
      setBusy(false)
    }
  }

  const responseCount = post.response_count ?? 0

  return (
    <article className="flex flex-col gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <div className="flex items-center justify-between gap-2">
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${KIND_PILL[post.kind]}`}
        >
          {POST_KIND_LABELS[post.kind]}
        </span>
        <span className="text-xs text-[var(--color-text-muted)]">
          {DATE_FORMAT.format(new Date(post.created_at))}
        </span>
      </div>

      <div className="flex flex-col gap-1">
        <h2 className="font-heading font-semibold leading-snug">{post.title}</h2>
        {metaLine && <p className="text-sm text-[var(--color-text-muted)]">{metaLine}</p>}
        <p className="text-xs text-[var(--color-text-muted)]">
          {post.is_mine ? post.category : byLine}
        </p>
      </div>

      {post.details && (
        <div className="text-sm">
          <p className={`whitespace-pre-line ${expanded ? '' : 'line-clamp-3'}`}>{post.details}</p>
          {post.details.length > 160 && (
            <button
              type="button"
              onClick={() => setExpanded(!expanded)}
              className="mt-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            >
              {expanded ? 'Less' : 'More'}
            </button>
          )}
        </div>
      )}

      {post.is_mine ? (
        <>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                post.status === 'open'
                  ? 'bg-[var(--color-badge-live-bg)] text-[var(--color-badge-live-fg)]'
                  : post.status === 'hidden'
                    ? 'border border-[var(--color-accent)] text-[var(--color-accent)]'
                    : 'bg-[var(--color-badge-soon-bg)] text-[var(--color-badge-soon-fg)]'
              }`}
            >
              {STATUS_LABELS[post.status]}
            </span>
            <button
              type="button"
              onClick={handleToggleResponders}
              disabled={responseCount === 0}
              className="text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:hover:text-[var(--color-text-muted)]"
            >
              {responseCount} {responseCount === 1 ? 'member' : 'members'} responded
              {responseCount > 0 && (showResponders ? ' ▴' : ' ▾')}
            </button>
          </div>
          {post.status === 'hidden' && post.hidden_reason && (
            <p className="rounded-lg border-l-2 border-[var(--color-accent)] bg-[var(--color-bg)] px-3 py-2 text-sm whitespace-pre-line">
              {post.hidden_reason}
            </p>
          )}
          {showResponders && responders && (
            <ul className="flex flex-col gap-1.5">
              {responders.map((person) => (
                <li key={person.person_id}>
                  <Link
                    to={`/members/${person.person_id}`}
                    className="flex items-center gap-2 text-sm hover:underline underline-offset-2"
                  >
                    <Avatar name={person.full_name} photoUrl={person.profile_photo_url} size={28} />
                    {person.full_name}
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <div className="grid grid-cols-2 gap-2">
            {post.status === 'open' ? (
              <button type="button" onClick={() => setPending('close')} disabled={busy} className={OUTLINE}>
                Close
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setPending('renew')}
                disabled={busy || post.status === 'hidden'}
                className={OUTLINE}
              >
                Renew for 30 days
              </button>
            )}
            <button type="button" onClick={() => setPending('delete')} disabled={busy} className={OUTLINE}>
              Delete
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={handleRespond}
              disabled={busy}
              className={responded ? OUTLINE : PRIMARY}
            >
              {responded ? 'Responded · WhatsApp' : 'Respond'}
            </button>
            <button
              type="button"
              onClick={handleToggleSaved}
              aria-pressed={saved}
              className={OUTLINE}
            >
              {saved ? 'Saved' : 'Save'}
            </button>
          </div>
          <button
            type="button"
            onClick={() => setReportOpen(true)}
            disabled={reported}
            className="self-end text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:hover:text-[var(--color-text-muted)]"
          >
            {reported ? 'Reported — the admins will take a look' : 'Report'}
          </button>
        </>
      )}

      {error && <p className="text-sm text-[var(--color-accent)]">{error}</p>}

      <ReportDialog
        open={reportOpen}
        name="this post"
        busy={busy}
        reasons={POST_REPORT_REASON_OPTIONS}
        note="Only the admins see reports. The poster won’t be told who reported it."
        onSubmit={({ reason, details }) => handleReport(reason, details)}
        onCancel={() => setReportOpen(false)}
      />
      <ConfirmDialog
        open={pending !== null}
        title={
          pending === 'delete'
            ? 'Delete this post?'
            : pending === 'renew'
              ? 'Renew this post?'
              : 'Close this post?'
        }
        description={
          pending === 'delete'
            ? 'It’s removed for good, along with who responded.'
            : pending === 'renew'
              ? 'It goes back up on Buy & Sell for another 30 days.'
              : 'Members stop seeing it. You can renew it later.'
        }
        confirmLabel={pending === 'delete' ? 'Delete' : pending === 'renew' ? 'Renew' : 'Close post'}
        busy={busy}
        onConfirm={() => handlePending()}
        onCancel={() => setPending(null)}
      />
    </article>
  )
}
