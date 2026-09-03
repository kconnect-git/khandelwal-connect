import { useEffect, useRef, useState } from 'react'
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
import { getFamilyNameCompletionFlags, type FamilyNameCompletionFlags } from '../lib/familyDetails'
import { removeProfilePhoto, uploadProfilePhoto } from '../lib/profilePhoto'
import type { Person } from '../types/database'
import { validateOccupation, validateStep } from './wizard/validation'
import { StepPersonal } from './wizard/StepPersonal'
import { StepLocation } from './wizard/StepLocation'
import { StepGotraBackground } from './wizard/StepGotraBackground'
import { OccupationFields } from '../components/form/OccupationFields'
import { ProfileLoadError } from '../components/guards/ProfileLoadError'
import { Avatar } from '../components/Avatar'
import { useProfileRefresh } from '../context/ProfileRefreshContext'

export function ProfileEdit() {
  const { triggerRefresh } = useProfileRefresh()
  const [person, setPerson] = useState<Person | null>(null)
  const [form, setForm] = useState<PersonFormValues | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [savedMessage, setSavedMessage] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [authUserId, setAuthUserId] = useState<string | null>(null)
  const [photoBusy, setPhotoBusy] = useState(false)
  const [photoError, setPhotoError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  // father_name/mother_name/spouse_name moved off `people` into
  // family_relations (post-3b); fetched separately just to feed the
  // completion count below, same as Dashboard.tsx.
  const [familyFlags, setFamilyFlags] = useState<FamilyNameCompletionFlags | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const { data: sessionData } = await supabase.auth.getSession()
        const session = sessionData.session
        if (!session) return

        const loaded = await getOwnPerson(session.user.id)
        if (cancelled || !loaded) return

        const flags = await getFamilyNameCompletionFlags(loaded.id)
        if (cancelled) return

        setAuthUserId(session.user.id)
        setPerson(loaded)
        setForm(personToFormValues(loaded))
        setFamilyFlags(flags)
      } catch (err) {
        if (cancelled) return
        console.error('[ProfileEdit] failed to load profile', err)
        setLoadError(
          err instanceof Error ? err.message : 'Something went wrong loading your profile.',
        )
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [loadAttempt])

  if (loadError) {
    return (
      <ProfileLoadError
        message={loadError}
        retry={() => {
          setLoadError(null)
          setLoadAttempt((a) => a + 1)
        }}
      />
    )
  }

  if (!person || !form || !familyFlags) return null

  function handleChange(patch: Partial<PersonFormValues>) {
    setForm((prev) => (prev ? { ...prev, ...patch } : prev))
    setSavedMessage(null)
  }

  async function handlePhotoSelected(file: File | undefined) {
    if (!file || !person || !authUserId) return
    setPhotoBusy(true)
    setPhotoError(null)
    try {
      const updated = await uploadProfilePhoto(file, authUserId, person)
      setPerson(updated)
      triggerRefresh()
    } catch (err) {
      setPhotoError(err instanceof Error ? err.message : 'Something went wrong uploading the photo.')
    } finally {
      setPhotoBusy(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  async function handleRemovePhoto() {
    if (!person) return
    setPhotoBusy(true)
    setPhotoError(null)
    try {
      const updated = await removeProfilePhoto(person)
      setPerson(updated)
      triggerRefresh()
    } catch (err) {
      setPhotoError(err instanceof Error ? err.message : 'Something went wrong removing the photo.')
    } finally {
      setPhotoBusy(false)
    }
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
    const occupationMessage = validateOccupation(form)
    if (occupationMessage) {
      setError(occupationMessage)
      return
    }

    // Job sub-fields only make sense for occupation 'Job' -- clear any
    // stale values if the member switched to something else.
    const toSave: PersonFormValues =
      form.occupation_type === 'Job'
        ? form
        : { ...form, job_title: '', company_name: '', job_location: '' }

    setError(null)
    setSaving(true)
    try {
      const updated = await updateOwnPerson(person.id, formValuesToPatch(toSave))
      setPerson(updated)
      setForm(personToFormValues(updated))
      setSavedMessage('Saved.')
      triggerRefresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong saving your changes.')
    } finally {
      setSaving(false)
    }
  }

  const completion = getProfileCompletion({ ...person, ...familyFlags })

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

      <div className="w-full flex items-center gap-4">
        <Avatar name={person.full_name} photoUrl={person.profile_photo_url} size={64} />
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={photoBusy}
            className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-text-muted)] disabled:opacity-60 transition-colors"
          >
            {photoBusy
              ? 'Working…'
              : person.profile_photo_url
                ? 'Change photo'
                : 'Add photo'}
          </button>
          {person.profile_photo_url && (
            <button
              type="button"
              onClick={handleRemovePhoto}
              disabled={photoBusy}
              className="rounded-lg px-3 py-1.5 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-60 transition-colors"
            >
              Remove
            </button>
          )}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => handlePhotoSelected(e.target.files?.[0])}
        />
      </div>
      {photoError && <p className="text-sm text-[var(--color-accent)]">{photoError}</p>}

      <div className="flex flex-col gap-1">
        <p className="text-sm text-[var(--color-text-muted)]">
          {completion.completed}/{completion.total} fields · {completion.percent}% complete
        </p>
        {completion.missingNotYetEditable.length > 0 && (
          <p className="text-sm text-[var(--color-text-muted)]">
            {completion.missingNotYetEditable.map((f) => f.label).join(', ')} arrive in a later
            update.
          </p>
        )}
      </div>

      <div className="w-full flex flex-col gap-6">
        <StepPersonal value={form} onChange={handleChange} />
        <StepLocation value={form} onChange={handleChange} />
        <StepGotraBackground value={form} onChange={handleChange} />
        <OccupationFields value={form} onChange={handleChange} />
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
