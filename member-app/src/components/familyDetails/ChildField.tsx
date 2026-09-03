import { useState } from 'react'
import { RelationSearchInput } from './RelationSearchInput'
import { RelativeContactFields } from './RelativeContactFields'
import { InviteControl } from './InviteControl'
import {
  updateChild,
  removeChild,
  validateRelativeContact,
  type ChildRecord,
  type RelativeContact,
} from '../../lib/familyDetails'

type ChildFieldProps = {
  child: ChildRecord
  onRemoved: (id: string) => void
}

export function ChildField({ child, onRemoved }: ChildFieldProps) {
  const [name, setName] = useState(child.child_name)
  const [memberCode, setMemberCode] = useState(child.child_member_code ?? '')
  const [contact, setContact] = useState<RelativeContact>({
    mobileNumber: child.child_mobile_number ?? '',
    dob: child.child_dob ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [notFound, setNotFound] = useState(false)

  async function handleSave() {
    setError(null)
    setSaved(false)

    const contactError = validateRelativeContact(contact)
    if (contactError) {
      setError(contactError)
      return
    }

    setSaving(true)
    try {
      await updateChild(child.id, name.trim(), memberCode.trim() || null, contact)
      setSaved(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong saving this.')
    } finally {
      setSaving(false)
    }
  }

  async function handleRemove() {
    setRemoving(true)
    try {
      await removeChild(child.id)
      onRemoved(child.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong removing this.')
      setRemoving(false)
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-[var(--color-border)] p-4">
      <RelationSearchInput
        name={name}
        memberCode={memberCode}
        onNameChange={(v) => {
          setName(v)
          setSaved(false)
          setNotFound(false)
        }}
        onMemberCodeChange={(v) => {
          setMemberCode(v)
          setSaved(false)
          setNotFound(false)
        }}
        onSearched={(results) => setNotFound(results.length === 0)}
        onMobileNumberFound={(mobileNumber) => {
          setContact((prev) => ({ ...prev, mobileNumber }))
          setSaved(false)
        }}
      />
      <RelativeContactFields
        value={contact}
        onChange={(v) => {
          setContact(v)
          setSaved(false)
        }}
      />
      {error && <p className="text-sm text-[var(--color-accent)]">{error}</p>}
      {saved && !error && <p className="text-sm text-[var(--color-text-muted)]">Saved.</p>}
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || name.trim().length === 0}
          className="rounded-lg bg-[var(--color-accent)] text-white font-medium px-4 py-2 text-sm hover:bg-[var(--color-accent-hover)] disabled:opacity-60 transition-colors"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        {notFound && memberCode.trim().length === 0 && <InviteControl slot="child" />}
        <button
          type="button"
          onClick={handleRemove}
          disabled={removing}
          className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-text-muted)] disabled:opacity-60 transition-colors"
        >
          {removing ? 'Removing…' : 'Remove'}
        </button>
      </div>
    </div>
  )
}
