import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from '../utils/supabase'
import {
  formValuesToPatch,
  getOwnPerson,
  personToFormValues,
  updateOwnPerson,
  type PersonFormValues,
} from '../lib/people'
import { getProfileCompletion } from '../lib/profileCompletion'
import {
  familyNameCompletionFlags,
  getChildren,
  getFamilyRelations,
  type ChildRecord,
} from '../lib/familyDetails'
import { getMyBusinesses } from '../lib/businesses'
import {
  DEFAULT_PROFILE_TAB,
  PERSON_TAB_FIELDS,
  isProfileTabKey,
  type ProfileTabKey,
} from '../lib/profileTabs'
import { validateProfileTab } from './wizard/validation'
import { ProfileLoadError } from '../components/guards/ProfileLoadError'
import { ProfilePhotoControl } from '../components/profile/ProfilePhotoControl'
import { ProfileTabs } from '../components/profile/ProfileTabs'
import {
  IDLE_SAVE_STATE,
  type RelationMap,
  type TabSaveState,
} from '../components/profile/tabTypes'
import { PersonalInfoTab } from '../components/profile/PersonalInfoTab'
import { ContactTab } from '../components/profile/ContactTab'
import { CulturalTab } from '../components/profile/CulturalTab'
import { ResidenceTab } from '../components/profile/ResidenceTab'
import { BusinessTab } from '../components/profile/BusinessTab'
import { SpouseTab } from '../components/profile/SpouseTab'
import { ChildrenTab } from '../components/profile/ChildrenTab'
import type { BusinessRow, Person } from '../types/database'
import { useProfileRefresh } from '../context/ProfileRefreshContext'

type SaveStates = Partial<Record<ProfileTabKey, TabSaveState>>

/** The member's own editing surface (Phase 3c): one page, seven tabs.
 * Tabs 1-4 + occupation write to `people` (each Save validates and patches
 * only the fields that tab owns -- see PERSON_TAB_FIELDS); relation,
 * child and business cards save themselves as before. */
export function Profile() {
  const { triggerRefresh } = useProfileRefresh()
  const [searchParams, setSearchParams] = useSearchParams()
  const tabParam = searchParams.get('tab')
  const tab: ProfileTabKey = isProfileTabKey(tabParam) ? tabParam : DEFAULT_PROFILE_TAB

  const [authUserId, setAuthUserId] = useState<string | null>(null)
  const [primaryEmail, setPrimaryEmail] = useState<string | null>(null)
  const [person, setPerson] = useState<Person | null>(null)
  const [form, setForm] = useState<PersonFormValues | null>(null)
  const [relations, setRelations] = useState<RelationMap | null>(null)
  const [children, setChildren] = useState<ChildRecord[] | null>(null)
  const [businesses, setBusinesses] = useState<BusinessRow[] | null>(null)
  const [saveStates, setSaveStates] = useState<SaveStates>({})
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loadAttempt, setLoadAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const { data: sessionData } = await supabase.auth.getSession()
        const session = sessionData.session
        if (!session) return

        const loaded = await getOwnPerson(session.user.id)
        if (cancelled || !loaded) return

        const [loadedRelations, loadedChildren, loadedBusinesses] = await Promise.all([
          getFamilyRelations(loaded.id),
          getChildren(loaded.id),
          getMyBusinesses(loaded.id),
        ])
        if (cancelled) return

        setAuthUserId(session.user.id)
        setPrimaryEmail(session.user.email ?? null)
        setPerson(loaded)
        setForm(personToFormValues(loaded))
        setRelations(new Map(loadedRelations.map((r) => [r.slot, r])))
        setChildren(loadedChildren)
        setBusinesses(loadedBusinesses)
        setSaveStates({})
      } catch (err) {
        if (cancelled) return
        console.error('[Profile] failed to load', err)
        setLoadError(err instanceof Error ? err.message : 'Something went wrong loading your profile.')
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

  if (!person || !form || !relations || !children || !businesses || !authUserId) return null

  function selectTab(next: ProfileTabKey) {
    setSearchParams(next === DEFAULT_PROFILE_TAB ? {} : { tab: next }, { replace: true })
  }

  function handleChange(patch: Partial<PersonFormValues>) {
    setForm((prev) => (prev ? { ...prev, ...patch } : prev))
    // Any edit clears the current tab's "Saved." so it never reads stale.
    setSaveStates((prev) => (prev[tab]?.saved ? { ...prev, [tab]: IDLE_SAVE_STATE } : prev))
  }

  function setSaveState(key: ProfileTabKey, state: TabSaveState) {
    setSaveStates((prev) => ({ ...prev, [key]: state }))
  }

  async function handleSaveTab(key: ProfileTabKey) {
    if (!form || !person) return
    const fields = PERSON_TAB_FIELDS[key]
    if (!fields) return

    const message = validateProfileTab(key, form)
    if (message) {
      setSaveState(key, { saving: false, error: message, saved: false })
      return
    }

    // Job sub-fields only make sense for occupation 'Job' -- clear any
    // stale values if the member switched to something else.
    const source: PersonFormValues =
      key === 'business' && form.occupation_type !== 'Job'
        ? { ...form, job_title: '', company_name: '', job_location: '' }
        : form

    const slice: Partial<PersonFormValues> = {}
    for (const field of fields) slice[field] = source[field]

    setSaveState(key, { saving: true, error: null, saved: false })
    try {
      const updated = await updateOwnPerson(person.id, formValuesToPatch(slice))
      setPerson(updated)
      setForm(personToFormValues(updated))
      setSaveState(key, { saving: false, error: null, saved: true })
      triggerRefresh()
    } catch (err) {
      setSaveState(key, {
        saving: false,
        error: err instanceof Error ? err.message : 'Something went wrong saving your changes.',
        saved: false,
      })
    }
  }

  const completion = getProfileCompletion({
    ...person,
    ...familyNameCompletionFlags([...relations.values()]),
  })

  const personTabProps = (key: ProfileTabKey) => ({
    value: form,
    onChange: handleChange,
    saveState: saveStates[key] ?? IDLE_SAVE_STATE,
    onSave: () => handleSaveTab(key),
  })

  return (
    <div className="flex-1 flex flex-col items-start gap-6 px-5 py-10 max-w-2xl mx-auto w-full">
      <div className="w-full flex items-center justify-between">
        <h1 className="font-heading text-2xl font-semibold">Profile</h1>
        <Link
          to="/dashboard"
          className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
        >
          Back to dashboard
        </Link>
      </div>

      <ProfilePhotoControl
        person={person}
        authUserId={authUserId}
        onChanged={(updated) => {
          setPerson(updated)
          triggerRefresh()
        }}
      />

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

      <ProfileTabs active={tab} onChange={selectTab} />

      {tab === 'personal' && (
        <PersonalInfoTab
          {...personTabProps('personal')}
          relations={relations}
          loadAttempt={loadAttempt}
        />
      )}
      {tab === 'contact' && <ContactTab {...personTabProps('contact')} primaryEmail={primaryEmail} />}
      {tab === 'cultural' && <CulturalTab {...personTabProps('cultural')} />}
      {tab === 'residence' && <ResidenceTab {...personTabProps('residence')} />}
      {tab === 'business' && (
        <BusinessTab
          {...personTabProps('business')}
          ownerId={person.id}
          authUserId={authUserId}
          businesses={businesses}
          onBusinessesChange={setBusinesses}
        />
      )}
      {tab === 'spouse' && (
        <SpouseTab {...personTabProps('spouse')} relations={relations} loadAttempt={loadAttempt} />
      )}
      {tab === 'children' && <ChildrenTab items={children} onChange={setChildren} />}
    </div>
  )
}
