import { useState } from 'react'
import { RelationSearchInput } from './RelationSearchInput'
import { RelativeContactFields } from './RelativeContactFields'
import { RelationDetailsFields } from './RelationDetailsFields'
import { InviteControl } from './InviteControl'
import {
  saveFamilyRelation,
  validateRelativeContact,
  validateRelationDetails,
  EMPTY_RELATION_DETAILS,
  type FamilySlot,
  type RelativeContact,
  type RelationDetails,
} from '../../lib/familyDetails'

type RelationFieldProps = {
  label: string
  slot: FamilySlot
  initialName: string
  initialMemberCode: string
  initialContact: RelativeContact
  /** Profession / email / blood group. Only rendered when `showDetails`
   * is set (the spouse card); other slots leave both off. */
  initialDetails?: RelationDetails
  showDetails?: boolean
  gotraHint?: string
  nativePlaceHint?: string
}

export function RelationField({
  label,
  slot,
  initialName,
  initialMemberCode,
  initialContact,
  initialDetails,
  showDetails = false,
  gotraHint,
  nativePlaceHint,
}: RelationFieldProps) {
  const [name, setName] = useState(initialName)
  const [memberCode, setMemberCode] = useState(initialMemberCode)
  const [contact, setContact] = useState<RelativeContact>(initialContact)
  const [details, setDetails] = useState<RelationDetails>(initialDetails ?? EMPTY_RELATION_DETAILS)
  const [saving, setSaving] = useState(false)
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
    if (showDetails) {
      const detailsError = validateRelationDetails(details)
      if (detailsError) {
        setError(detailsError)
        return
      }
    }

    setSaving(true)
    try {
      await saveFamilyRelation(
        slot,
        name.trim(),
        memberCode.trim() || null,
        contact,
        showDetails ? details : undefined,
      )
      setSaved(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong saving this.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-[var(--color-border)] p-4">
      <h3 className="font-heading font-semibold">{label}</h3>
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
        gotraHint={gotraHint}
        nativePlaceHint={nativePlaceHint}
      />
      <RelativeContactFields
        value={contact}
        onChange={(v) => {
          setContact(v)
          setSaved(false)
        }}
      />
      {showDetails && (
        <RelationDetailsFields
          value={details}
          onChange={(v) => {
            setDetails(v)
            setSaved(false)
          }}
        />
      )}
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
        {notFound && memberCode.trim().length === 0 && <InviteControl slot={slot} />}
      </div>
    </div>
  )
}
