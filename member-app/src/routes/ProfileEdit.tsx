import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../utils/supabase'
import {
  formValuesToPatch,
  getOwnPerson,
  personToFormValues,
  updateOwnPerson,
  type PersonFormValues,
} from '../lib/people'
import { getProfileCompletion } from '../lib/profileCompletion'
import type { Person } from '../types/database'
import { validateStep } from './wizard/validation'
import { StepPersonal } from './wizard/StepPersonal'
import { StepLocation } from './wizard/StepLocation'
import { StepGotraBackground } from './wizard/StepGotraBackground'

export function ProfileEdit() {
  const [person, setPerson] = useState<Person | null>(null)
  const [form, setForm] = useState<PersonFormValues | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [savedMessage, setSavedMessage] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function load() {
      const { data: sessionData } = await supabase.auth.getSession()
      const session = sessionData.session
      if (!session) return

      const loaded = await getOwnPerson(session.user.id)
      if (cancelled || !loaded) return

      setPerson(loaded)
      setForm(personToFormValues(loaded))
    }

    load()
    return () => {
      cancelled = true
    }
  }, [])

  if (!person || !form) return null

  function handleChange(patch: Partial<PersonFormValues>) {
    setForm((prev) => (prev ? { ...prev, ...patch } : prev))
    setSavedMessage(null)
  }

  async function handleSave() {
    if (!form || !person) return

    for (const step of [1, 2, 3] as const) {
      const message = validateStep(step, form)
      if (message) {
        setError(message)
        return
      }
    }

    setError(null)
    setSaving(true)
    try {
      const updated = await updateOwnPerson(person.id, formValuesToPatch(form))
      setPerson(updated)
      setForm(personToFormValues(updated))
      setSavedMessage('Saved.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong saving your changes.')
    } finally {
      setSaving(false)
    }
  }

  const completion = getProfileCompletion(person)

  return (
    <div className="flex-1 flex flex-col items-start gap-6 px-5 py-10 max-w-2xl mx-auto w-full">
      <div className="w-full flex items-center justify-between">
        <h1 className="font-heading text-2xl font-semibold">Edit profile</h1>
        <Link
          to="/dashboard"
          className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
        >
          Back to dashboard
        </Link>
      </div>

      <div className="flex flex-col gap-1">
        <p className="text-sm text-[var(--color-text-muted)]">
          {completion.completed}/{completion.total} fields · {completion.percent}% complete
        </p>
        {completion.missingNotYetEditable.length > 0 && (
          <p className="text-sm text-[var(--color-text-muted)]">
            {completion.missingNotYetEditable.map((f) => f.label).join(', ')} aren't available to
            fill in yet — they arrive with the family tree and photo upload features in a later
            update.
          </p>
        )}
      </div>

      <div className="w-full flex flex-col gap-6">
        <StepPersonal value={form} onChange={handleChange} />
        <StepLocation value={form} onChange={handleChange} />
        <StepGotraBackground value={form} onChange={handleChange} />
      </div>

      {error && <p className="text-sm text-[var(--color-accent)]">{error}</p>}
      {savedMessage && (
        <p className="text-sm text-[var(--color-text-muted)]">{savedMessage}</p>
      )}

      <button
        type="button"
        onClick={handleSave}
        disabled={saving}
        className="rounded-lg bg-[var(--color-accent)] text-white font-medium py-2.5 px-6 hover:bg-[var(--color-accent-hover)] disabled:opacity-60 transition-colors"
      >
        {saving ? 'Saving…' : 'Save changes'}
      </button>
    </div>
  )
}
