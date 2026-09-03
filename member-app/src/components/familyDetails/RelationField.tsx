import { useState } from 'react'
import { RelationSearchInput } from './RelationSearchInput'
import { InviteControl } from './InviteControl'
import { saveFamilyRelation, type FamilySlot } from '../../lib/familyDetails'

type RelationFieldProps = {
  label: string
  slot: FamilySlot
  initialName: string
  initialMemberCode: string
  gotraHint?: string
  nativePlaceHint?: string
}

export function RelationField({
  label,
  slot,
  initialName,
  initialMemberCode,
  gotraHint,
  nativePlaceHint,
}: RelationFieldProps) {
  const [name, setName] = useState(initialName)
  const [memberCode, setMemberCode] = useState(initialMemberCode)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [notFound, setNotFound] = useState(false)

  async function handleSave() {
    setError(null)
    setSaved(false)
    setSaving(true)
    try {
      await saveFamilyRelation(slot, name.trim(), memberCode.trim() || null)
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
        gotraHint={gotraHint}
        nativePlaceHint={nativePlaceHint}
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
        {notFound && memberCode.trim().length === 0 && <InviteControl slot={slot} />}
      </div>
    </div>
  )
}
