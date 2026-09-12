import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { EventForm } from '../components/events/EventForm'
import { createEvent, EMPTY_EVENT_FORM, validateEvent, type EventFormValues } from '../lib/events'

export function EventNew() {
  const navigate = useNavigate()
  const [form, setForm] = useState<EventFormValues>(EMPTY_EVENT_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const problem = validateEvent(form)
    if (problem) {
      setError(problem)
      return
    }
    setSaving(true)
    setError(null)
    try {
      const id = await createEvent(form)
      navigate(`/events/${id}`, { replace: true })
    } catch (err) {
      console.error('[EventNew] failed to create', err)
      setError(err instanceof Error ? err.message : 'Something went wrong creating the event.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex-1 flex flex-col gap-6 px-5 py-8 max-w-2xl mx-auto w-full">
      <Link
        to="/events"
        className="text-xs font-semibold uppercase tracking-widest text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
      >
        ‹ Events
      </Link>

      <div className="flex flex-col gap-1">
        <h1 className="font-heading text-2xl font-semibold">Create an event</h1>
        <p className="text-sm text-[var(--color-text-muted)]">
          Events are reviewed by an admin before they appear to members. You'll see it under My
          events while it's pending.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <EventForm value={form} onChange={setForm} />

        {error && <p className="text-sm text-[var(--color-accent)]">{error}</p>}

        <button
          type="submit"
          disabled={saving || form.title.trim().length === 0}
          className="self-start rounded-lg bg-[var(--color-accent)] text-white font-medium px-6 py-2.5 hover:bg-[var(--color-accent-hover)] disabled:opacity-60 transition-colors"
        >
          {saving ? 'Submitting…' : 'Submit for approval'}
        </button>
      </form>
    </div>
  )
}
