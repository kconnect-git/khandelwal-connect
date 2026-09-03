import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../utils/supabase'
import { getOwnPerson } from '../lib/people'
import {
  getChildren,
  addChild,
  getFamilyRelations,
  validateRelativeContact,
  EMPTY_RELATIVE_CONTACT,
  type ChildRecord,
  type FamilySlot,
  type RelativeContact,
} from '../lib/familyDetails'
import { RelationField } from '../components/familyDetails/RelationField'
import { RelationSearchInput } from '../components/familyDetails/RelationSearchInput'
import { RelativeContactFields } from '../components/familyDetails/RelativeContactFields'
import { ChildField } from '../components/familyDetails/ChildField'
import { ProfileLoadError } from '../components/guards/ProfileLoadError'
import type { FamilyRelationRow, Person } from '../types/database'

function relationInitial(relations: Map<FamilySlot, FamilyRelationRow>, slot: FamilySlot) {
  const row = relations.get(slot)
  return {
    initialName: row?.related_name ?? '',
    initialMemberCode: row?.related_member_code ?? '',
    initialContact: {
      mobileNumber: row?.mobile_number ?? '',
      dob: row?.dob ?? '',
    } satisfies RelativeContact,
  }
}

export function FamilyDetails() {
  const [person, setPerson] = useState<Person | null>(null)
  const [relations, setRelations] = useState<Map<FamilySlot, FamilyRelationRow> | null>(null)
  const [children, setChildren] = useState<ChildRecord[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loadAttempt, setLoadAttempt] = useState(0)

  const [newChildName, setNewChildName] = useState('')
  const [newChildMemberCode, setNewChildMemberCode] = useState('')
  const [newChildContact, setNewChildContact] = useState<RelativeContact>(EMPTY_RELATIVE_CONTACT)
  const [addingChild, setAddingChild] = useState(false)
  const [addChildError, setAddChildError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const { data: sessionData } = await supabase.auth.getSession()
        const session = sessionData.session
        if (!session) return

        const loaded = await getOwnPerson(session.user.id)
        if (cancelled || !loaded) return

        const [loadedRelations, loadedChildren] = await Promise.all([
          getFamilyRelations(loaded.id),
          getChildren(loaded.id),
        ])
        if (cancelled) return

        setPerson(loaded)
        setRelations(new Map(loadedRelations.map((r) => [r.slot, r])))
        setChildren(loadedChildren)
      } catch (err) {
        if (cancelled) return
        console.error('[FamilyDetails] failed to load', err)
        setLoadError(err instanceof Error ? err.message : 'Something went wrong loading this page.')
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

  if (!person || !relations || !children) return null

  async function handleAddChild() {
    setAddChildError(null)
    if (newChildName.trim().length === 0) return

    const contactError = validateRelativeContact(newChildContact)
    if (contactError) {
      setAddChildError(contactError)
      return
    }

    setAddingChild(true)
    try {
      const id = await addChild(newChildName.trim(), newChildMemberCode.trim() || null, newChildContact)
      setChildren((prev) => [
        ...(prev ?? []),
        {
          id,
          child_name: newChildName.trim(),
          child_member_code: newChildMemberCode.trim() || null,
          child_id: null,
          child_mobile_number: newChildContact.mobileNumber.trim() || null,
          child_dob: newChildContact.dob.trim() || null,
        },
      ])
      setNewChildName('')
      setNewChildMemberCode('')
      setNewChildContact(EMPTY_RELATIVE_CONTACT)
    } catch (err) {
      setAddChildError(err instanceof Error ? err.message : 'Something went wrong adding this child.')
    } finally {
      setAddingChild(false)
    }
  }

  const isMarried = person.marital_status?.toLowerCase() === 'married'

  return (
    <div className="flex-1 flex flex-col items-start gap-6 px-5 py-10 max-w-2xl mx-auto w-full">
      <div className="w-full flex items-center justify-between">
        <h1 className="font-heading text-2xl font-semibold">Family details</h1>
        <Link
          to="/dashboard"
          className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
        >
          Back to dashboard
        </Link>
      </div>
      <p className="text-sm text-[var(--color-text-muted)] -mt-4">
        Search for a relative if they're already a member to link their record, or just type their
        name if they haven't joined yet — you can add their member ID later once they do.
      </p>

      <div className="w-full flex flex-col gap-4">
        {/* No gotraHint here (it used to be passed for father only): the RPC
            applies it as an exact match, so any spelling/whitespace variance
            in the father's own row made his search silently return nothing
            while every other slot worked. Results show each candidate's
            gotra, so the user can disambiguate visually instead. */}
        <RelationField
          key={`father-${loadAttempt}`}
          label="Father"
          slot="father"
          {...relationInitial(relations, 'father')}
        />
        <RelationField
          key={`mother-${loadAttempt}`}
          label="Mother"
          slot="mother"
          {...relationInitial(relations, 'mother')}
        />
        <RelationField
          key={`maternal_uncle-${loadAttempt}`}
          label="Maternal uncle (mama)"
          slot="maternal_uncle"
          {...relationInitial(relations, 'maternal_uncle')}
        />
        {isMarried && (
          <>
            <RelationField
              key={`spouse-${loadAttempt}`}
              label="Spouse"
              slot="spouse"
              {...relationInitial(relations, 'spouse')}
            />
            <RelationField
              key={`spouse_father-${loadAttempt}`}
              label="Spouse's father"
              slot="spouse_father"
              {...relationInitial(relations, 'spouse_father')}
            />
            <RelationField
              key={`spouse_mother-${loadAttempt}`}
              label="Spouse's mother"
              slot="spouse_mother"
              {...relationInitial(relations, 'spouse_mother')}
            />
          </>
        )}
      </div>

      <div className="w-full flex flex-col gap-4">
        <h2 className="font-heading text-lg font-semibold">Children</h2>

        {children.map((child) => (
          <ChildField
            key={child.id}
            child={child}
            onRemoved={(id) => setChildren((prev) => (prev ?? []).filter((c) => c.id !== id))}
          />
        ))}

        <div className="flex flex-col gap-3 rounded-xl border border-dashed border-[var(--color-border)] p-4">
          <h3 className="font-heading font-semibold">Add a child</h3>
          <RelationSearchInput
            name={newChildName}
            memberCode={newChildMemberCode}
            onNameChange={setNewChildName}
            onMemberCodeChange={setNewChildMemberCode}
            onMobileNumberFound={(mobileNumber) =>
              setNewChildContact((prev) => ({ ...prev, mobileNumber }))
            }
          />
          <RelativeContactFields value={newChildContact} onChange={setNewChildContact} />
          {addChildError && <p className="text-sm text-[var(--color-accent)]">{addChildError}</p>}
          <button
            type="button"
            onClick={handleAddChild}
            disabled={addingChild || newChildName.trim().length === 0}
            className="self-start rounded-lg bg-[var(--color-accent)] text-white font-medium px-4 py-2 text-sm hover:bg-[var(--color-accent-hover)] disabled:opacity-60 transition-colors"
          >
            {addingChild ? 'Adding…' : 'Add child'}
          </button>
        </div>
      </div>
    </div>
  )
}
