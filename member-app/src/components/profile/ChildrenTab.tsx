import { useState } from 'react'
import { RelationSearchInput } from '../familyDetails/RelationSearchInput'
import { RelativeContactFields } from '../familyDetails/RelativeContactFields'
import { ChildDetailsFields } from '../familyDetails/ChildDetailsFields'
import { ChildField } from '../familyDetails/ChildField'
import {
  addChild,
  validateRelativeContact,
  EMPTY_CHILD_DETAILS,
  EMPTY_RELATIVE_CONTACT,
  type ChildDetails,
  type ChildRecord,
  type RelativeContact,
} from '../../lib/familyDetails'

type ChildrenTabProps = {
  items: ChildRecord[]
  onChange: (next: ChildRecord[]) => void
}

export function ChildrenTab({ items: children, onChange }: ChildrenTabProps) {
  const [newName, setNewName] = useState('')
  const [newMemberCode, setNewMemberCode] = useState('')
  const [newContact, setNewContact] = useState<RelativeContact>(EMPTY_RELATIVE_CONTACT)
  const [newDetails, setNewDetails] = useState<ChildDetails>(EMPTY_CHILD_DETAILS)
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)

  async function handleAdd() {
    setAddError(null)
    if (newName.trim().length === 0) return

    const contactError = validateRelativeContact(newContact)
    if (contactError) {
      setAddError(contactError)
      return
    }

    setAdding(true)
    try {
      const id = await addChild(newName.trim(), newMemberCode.trim() || null, newContact, newDetails)
      onChange([
        ...children,
        {
          id,
          child_name: newName.trim(),
          child_member_code: newMemberCode.trim() || null,
          child_id: null,
          child_mobile_number: newContact.mobileNumber.trim() || null,
          child_dob: newContact.dob.trim() || null,
          relation: newDetails.relation || null,
          education: newDetails.education.trim() || null,
          profession: newDetails.profession || null,
          marital_status: newDetails.maritalStatus || null,
          spouse_name:
            newDetails.maritalStatus === 'Married' ? newDetails.spouseName.trim() || null : null,
          blood_group: newDetails.bloodGroup || null,
        },
      ])
      setNewName('')
      setNewMemberCode('')
      setNewContact(EMPTY_RELATIVE_CONTACT)
      setNewDetails(EMPTY_CHILD_DETAILS)
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Something went wrong adding this child.')
    } finally {
      setAdding(false)
    }
  }

  return (
    <div className="w-full flex flex-col gap-4">
      <p className="text-sm text-[var(--color-text-muted)]">
        Search for a child if they're already a member to link their record, or just type their
        name if they haven't joined yet.
      </p>

      {children.map((child) => (
        <ChildField
          key={child.id}
          child={child}
          onRemoved={(id) => onChange(children.filter((c) => c.id !== id))}
        />
      ))}

      <div className="flex flex-col gap-3 rounded-xl border border-dashed border-[var(--color-border)] p-4">
        <h3 className="font-heading font-semibold">Add a child</h3>
        <RelationSearchInput
          name={newName}
          memberCode={newMemberCode}
          onNameChange={setNewName}
          onMemberCodeChange={setNewMemberCode}
          onMobileNumberFound={(mobileNumber) =>
            setNewContact((prev) => ({ ...prev, mobileNumber }))
          }
        />
        <RelativeContactFields value={newContact} onChange={setNewContact} />
        <ChildDetailsFields value={newDetails} onChange={setNewDetails} />
        {addError && <p className="text-sm text-[var(--color-accent)]">{addError}</p>}
        <button
          type="button"
          onClick={handleAdd}
          disabled={adding || newName.trim().length === 0}
          className="self-start rounded-lg bg-[var(--color-accent)] text-white font-medium px-4 py-2 text-sm hover:bg-[var(--color-accent-hover)] disabled:opacity-60 transition-colors"
        >
          {adding ? 'Adding…' : 'Add child'}
        </button>
      </div>
    </div>
  )
}
