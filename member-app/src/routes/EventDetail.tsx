import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Avatar } from '../components/Avatar'
import { EventForm } from '../components/events/EventForm'
import { EventStatusBadge } from '../components/events/EventStatusBadge'
import { EventInviteesSection } from '../components/events/EventInviteesSection'
import {
  cancelEvent,
  EMPTY_EVENT_FORM,
  eventPlaceLine,
  eventToFormValues,
  EVENT_VISIBILITY_LABELS,
  formatEventWhen,
  getEvent,
  isEventEnded,
  isEventFull,
  rsvpEvent,
  updateEvent,
  validateEvent,
  type EventDetail as EventDetailData,
  type EventFormValues,
} from '../lib/events'

function Section({
  title,
  rows,
}: {
  title: string
  rows: Array<{ label: string; value: string | null }>
}) {
  const filled = rows.filter((row) => row.value)
  if (filled.length === 0) return null

  return (
    <section className="w-full flex flex-col gap-1">
      <h2 className="text-xs font-semibold uppercase tracking-widest text-[var(--color-text-muted)]">
        {title}
      </h2>
      <dl className="flex flex-col divide-y divide-[var(--color-border)]">
        {filled.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-4 py-2.5">
            <dt className="text-sm text-[var(--color-text-muted)]">{row.label}</dt>
            <dd className="text-sm font-medium text-right">{row.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

const OUTLINE_BUTTON =
  'rounded-full border border-[var(--color-border)] px-6 py-2.5 text-sm font-semibold hover:border-[var(--color-text-muted)] disabled:opacity-60 transition-colors'
const ACCENT_BUTTON =
  'rounded-full bg-[var(--color-accent)] text-white font-semibold px-6 py-2.5 text-sm hover:bg-[var(--color-accent-hover)] disabled:opacity-60 transition-colors'

export function EventDetail() {
  const { id } = useParams<{ id: string }>()
  const [event, setEvent] = useState<EventDetailData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [rsvpBusy, setRsvpBusy] = useState(false)
  const [rsvpError, setRsvpError] = useState<string | null>(null)

  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<EventFormValues>(EMPTY_EVENT_FORM)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState(false)

  const reload = useCallback(async () => {
    if (!id) return null
    const loaded = await getEvent(id)
    setEvent(loaded)
    return loaded
  }, [id])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    reload()
      .catch((err) => {
        if (cancelled) return
        console.error('[EventDetail] failed to load', err)
        setError(err instanceof Error ? err.message : 'Something went wrong loading this event.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [reload])

  async function handleRsvp(status: 'going' | 'not_going') {
    if (!event) return
    setRsvpBusy(true)
    setRsvpError(null)
    try {
      const goingCount = await rsvpEvent(event.id, status)
      setEvent({ ...event, going_count: goingCount, my_rsvp_status: status })
    } catch (err) {
      console.error('[EventDetail] rsvp failed', err)
      setRsvpError(err instanceof Error ? err.message : 'Could not update your RSVP.')
      // The count may have moved under us (e.g. someone took the last seat).
      reload().catch(() => {})
    } finally {
      setRsvpBusy(false)
    }
  }

  function startEditing() {
    if (!event) return
    setForm(eventToFormValues(event))
    setSaveError(null)
    setEditing(true)
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault()
    if (!event) return
    const problem = validateEvent(form, { requireFuture: event.can_edit_all })
    if (problem) {
      setSaveError(problem)
      return
    }
    setSaving(true)
    setSaveError(null)
    try {
      await updateEvent(event.id, form)
      await reload()
      setEditing(false)
    } catch (err) {
      console.error('[EventDetail] save failed', err)
      setSaveError(err instanceof Error ? err.message : 'Could not save the event.')
    } finally {
      setSaving(false)
    }
  }

  async function handleCancelEvent() {
    if (!event) return
    if (!window.confirm('Cancel this event? Guests will see it as cancelled and can no longer join.')) {
      return
    }
    setCancelling(true)
    setSaveError(null)
    try {
      await cancelEvent(event.id)
      await reload()
      setEditing(false)
    } catch (err) {
      console.error('[EventDetail] cancel failed', err)
      setSaveError(err instanceof Error ? err.message : 'Could not cancel the event.')
    } finally {
      setCancelling(false)
    }
  }

  if (loading) {
    return (
      <div className="flex-1 flex flex-col px-5 py-10 max-w-2xl mx-auto w-full">
        <p className="text-sm text-[var(--color-text-muted)]">Loading event…</p>
      </div>
    )
  }

  if (error || !event) {
    return (
      <div className="flex-1 flex flex-col items-start gap-4 px-5 py-10 max-w-2xl mx-auto w-full">
        <h1 className="font-heading text-2xl font-semibold">Event not found</h1>
        <p className="text-[var(--color-text-muted)]">
          {error ?? "This event does not exist, or you don't have access to it."}
        </p>
        <Link
          to="/events"
          className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-text-muted)] transition-colors"
        >
          Back to events
        </Link>
      </div>
    )
  }

  const ended = isEventEnded(event)
  const full = isEventFull(event)
  const going = event.my_rsvp_status === 'going'
  const canEdit = event.can_edit_all || event.can_edit_description
  const place = eventPlaceLine(event)

  // What the RSVP area says / offers, in priority order.
  let rsvp: React.ReactNode
  if (event.status === 'cancelled') {
    rsvp = <p className="text-sm text-[var(--color-text-muted)]">This event was cancelled.</p>
  } else if (event.status !== 'approved') {
    rsvp = (
      <p className="text-sm text-[var(--color-text-muted)]">
        {event.status === 'pending'
          ? 'Waiting for an admin to approve this event. Members will be able to join once it is.'
          : 'This event was not approved.'}
      </p>
    )
  } else if (ended) {
    rsvp = <p className="text-sm text-[var(--color-text-muted)]">This event has ended.</p>
  } else if (going) {
    rsvp = (
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-medium">You're going.</span>
        <button
          type="button"
          onClick={() => handleRsvp('not_going')}
          disabled={rsvpBusy}
          className={OUTLINE_BUTTON}
        >
          {rsvpBusy ? '…' : 'Leave'}
        </button>
      </div>
    )
  } else if (event.visibility === 'invite_only' && !event.is_invited && !event.is_creator) {
    rsvp = <p className="text-sm text-[var(--color-text-muted)]">This event is invite only.</p>
  } else if (full) {
    rsvp = <p className="text-sm text-[var(--color-text-muted)]">This event is full.</p>
  } else {
    rsvp = (
      <button
        type="button"
        onClick={() => handleRsvp('going')}
        disabled={rsvpBusy}
        className={ACCENT_BUTTON}
      >
        {rsvpBusy ? '…' : 'Join'}
      </button>
    )
  }

  return (
    <div className="flex-1 flex flex-col gap-6 px-5 py-6 max-w-2xl mx-auto w-full">
      <Link
        to={event.is_creator || event.is_invited ? '/events/mine' : '/events'}
        className="text-xs font-semibold uppercase tracking-widest text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
      >
        ‹ {event.is_creator || event.is_invited ? 'My events' : 'Events'}
      </Link>

      <div className="flex flex-col gap-2">
        <div className="flex items-start justify-between gap-3">
          <h1 className="font-heading text-2xl font-bold leading-tight">{event.title}</h1>
          {event.status !== 'approved' && <EventStatusBadge status={event.status} />}
        </div>
        <p className="text-sm text-[var(--color-text-muted)]">{formatEventWhen(event)}</p>
        {place && <p className="text-sm text-[var(--color-text-muted)]">{place}</p>}
        <p className="text-sm text-[var(--color-text-muted)]">
          {event.going_count} going{event.capacity !== null ? ` of ${event.capacity}` : ''}
          {event.visibility === 'invite_only' ? ' · Invite only' : ''}
        </p>
      </div>

      {event.status === 'rejected' && event.rejection_reason && (event.is_creator || event.is_admin) && (
        <p className="text-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
          <span className="text-[var(--color-text-muted)]">Reason: </span>
          {event.rejection_reason}
        </p>
      )}

      {rsvp}
      {rsvpError && <p className="text-sm text-[var(--color-accent)]">{rsvpError}</p>}

      {event.is_creator && !editing && (
        <div className="flex flex-wrap items-center gap-2">
          {canEdit && (
            <button type="button" onClick={startEditing} className={OUTLINE_BUTTON}>
              Edit
            </button>
          )}
          {event.status !== 'cancelled' && (
            <button
              type="button"
              onClick={handleCancelEvent}
              disabled={cancelling}
              className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-60 transition-colors px-2"
            >
              {cancelling ? 'Cancelling…' : 'Cancel event'}
            </button>
          )}
          {saveError && <p className="w-full text-sm text-[var(--color-accent)]">{saveError}</p>}
        </div>
      )}

      {event.is_admin && event.status === 'pending' && (
        <Link
          to="/admin/events"
          className="self-start text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
        >
          Review in the admin queue ›
        </Link>
      )}

      {editing ? (
        <form
          onSubmit={handleSave}
          className="flex flex-col gap-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
        >
          <p className="text-sm text-[var(--color-text-muted)]">
            {event.can_edit_all
              ? event.status === 'rejected'
                ? 'Saving will resubmit this event for approval.'
                : 'Saving keeps this event pending until an admin approves it.'
              : 'Only the description can be changed after approval. To change the date or venue, cancel this event and create a new one.'}
          </p>
          <EventForm value={form} onChange={setForm} locked={!event.can_edit_all} />
          {saveError && <p className="text-sm text-[var(--color-accent)]">{saveError}</p>}
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-[var(--color-accent)] text-white font-medium px-5 py-2 text-sm hover:bg-[var(--color-accent-hover)] disabled:opacity-60 transition-colors"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              disabled={saving}
              className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-60 transition-colors"
            >
              Discard
            </button>
          </div>
        </form>
      ) : (
        <>
          {event.description && (
            <section className="w-full flex flex-col gap-1">
              <h2 className="text-xs font-semibold uppercase tracking-widest text-[var(--color-text-muted)]">
                About
              </h2>
              <p className="text-sm whitespace-pre-line">{event.description}</p>
            </section>
          )}

          <Section
            title="Details"
            rows={[
              { label: 'Venue', value: event.venue },
              { label: 'City', value: event.city },
              { label: 'State', value: event.state },
              {
                label: 'Capacity',
                value: event.capacity !== null ? String(event.capacity) : null,
              },
              { label: 'Visibility', value: EVENT_VISIBILITY_LABELS[event.visibility] },
            ]}
          />
        </>
      )}

      {event.can_manage_invitees && (
        <EventInviteesSection eventId={event.id} selfId={event.creator_id} />
      )}

      <section className="w-full flex flex-col gap-1">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-[var(--color-text-muted)]">
          Organiser
        </h2>
        <Link
          to={`/members/${event.creator_id}`}
          className="flex items-center gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 hover:bg-[var(--color-surface-hover)] transition-colors"
        >
          <Avatar name={event.creator_name} photoUrl={event.creator_photo_url} size={40} />
          <span className="flex flex-col min-w-0">
            <span className="font-heading font-medium truncate">{event.creator_name}</span>
            <span className="text-xs tracking-wide text-[var(--color-text-muted)]">
              {event.creator_member_code}
            </span>
          </span>
        </Link>
      </section>
    </div>
  )
}
