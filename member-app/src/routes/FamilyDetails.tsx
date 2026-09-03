import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../utils/supabase'
import { getOwnPerson } from '../lib/people'
import { getChildren, addChild, type ChildRecord } from '../lib/familyDetails'
import { RelationField } from '../components/familyDetails/RelationField'
import { RelationSearchInput } from '../components/familyDetails/RelationSearchInput'
import { ChildField } from '../components/familyDetails/ChildField'
import { ProfileLoadError } from '../components/guards/ProfileLoadError'
import type { Person } from '../types/database'

export function FamilyDetails() {
  const [person, setPerson] = useState<Person | null>(null)
  const [children, setChildren] = useState<ChildRecord[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loadAttempt, setLoadAttempt] = useState(0)

  const [newChildName, setNewChildName] = useState('')
  const [newChildMemberCode, setNewChildMemberCode] = useState('')
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

        const loadedChildren = await getChildren(loaded.id)
        if (cancelled) return

        setPerson(loaded)
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

  if (!person || !children) return null

  async function handleAddChild() {
    setAddChildError(null)
    if (newChildName.trim().length === 0) return

    setAddingChild(true)
    try {
      const id = await addChild(newChildName.trim(), newChildMemberCode.trim() || null)
      setChildren((prev) => [
        ...(prev ?? []),
        { id, child_name: newChildName.trim(), child_member_code: newChildMemberCode.trim() || null, child_id: null },
      ])
      setNewChildName('')
      setNewChildMemberCode('')
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
        <RelationField
          key={`father-${person.updated_at}`}
          label="Father"
          slot="father"
          initialName={person.father_name ?? ''}
          initialMemberCode={person.father_member_code ?? ''}
          gotraHint={person.gotra ?? undefined}
        />
        <RelationField
          key={`mother-${person.updated_at}`}
          label="Mother"
          slot="mother"
          initialName={person.mother_name ?? ''}
          initialMemberCode={person.mother_member_code ?? ''}
        />
        <RelationField
          key={`maternal_uncle-${person.updated_at}`}
          label="Maternal uncle (mama)"
          slot="maternal_uncle"
          initialName={person.maternal_uncle_name ?? ''}
          initialMemberCode={person.maternal_uncle_member_code ?? ''}
        />
        {isMarried && (
          <>
            <RelationField
              key={`spouse-${person.updated_at}`}
              label="Spouse"
              slot="spouse"
              initialName={person.spouse_name ?? ''}
              initialMemberCode={person.spouse_member_code ?? ''}
            />
            <RelationField
              key={`spouse_father-${person.updated_at}`}
              label="Spouse's father"
              slot="spouse_father"
              initialName={person.spouse_father_name ?? ''}
              initialMemberCode={person.spouse_father_member_code ?? ''}
            />
            <RelationField
              key={`spouse_mother-${person.updated_at}`}
              label="Spouse's mother"
              slot="spouse_mother"
              initialName={person.spouse_mother_name ?? ''}
              initialMemberCode={person.spouse_mother_member_code ?? ''}
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
          />
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
