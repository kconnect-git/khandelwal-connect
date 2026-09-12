import { useRef, useState } from 'react'
import { Avatar } from '../Avatar'
import { removeProfilePhoto, uploadProfilePhoto } from '../../lib/profilePhoto'
import type { Person } from '../../types/database'

type ProfilePhotoControlProps = {
  person: Person
  authUserId: string
  /** Called with the updated row after an upload or removal succeeds. */
  onChanged: (updated: Person) => void
}

/** Avatar + Add/Change/Remove photo buttons. Moved verbatim from the old
 * Edit profile screen (Phase 3a) onto the Profile page (Phase 3c). */
export function ProfilePhotoControl({ person, authUserId, onChanged }: ProfilePhotoControlProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function handleSelected(file: File | undefined) {
    if (!file) return
    setBusy(true)
    setError(null)
    try {
      onChanged(await uploadProfilePhoto(file, authUserId, person))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong uploading the photo.')
    } finally {
      setBusy(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  async function handleRemove() {
    setBusy(true)
    setError(null)
    try {
      onChanged(await removeProfilePhoto(person))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong removing the photo.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="w-full flex flex-col gap-2">
      <div className="flex items-center gap-4">
        <Avatar name={person.full_name} photoUrl={person.profile_photo_url} size={64} />
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={busy}
            className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-text-muted)] disabled:opacity-60 transition-colors"
          >
            {busy ? 'Working…' : person.profile_photo_url ? 'Change photo' : 'Add photo'}
          </button>
          {person.profile_photo_url && (
            <button
              type="button"
              onClick={handleRemove}
              disabled={busy}
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
          onChange={(e) => handleSelected(e.target.files?.[0])}
        />
      </div>
      {error && <p className="text-sm text-[var(--color-accent)]">{error}</p>}
    </div>
  )
}
