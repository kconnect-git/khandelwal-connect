import type { PersonFormValues } from '../../lib/people'
import type { FamilySlot, RelativeContact, RelationDetails } from '../../lib/familyDetails'
import type { FamilyRelationRow } from '../../types/database'

export type TabSaveState = {
  saving: boolean
  error: string | null
  saved: boolean
}

export const IDLE_SAVE_STATE: TabSaveState = { saving: false, error: null, saved: false }

/** Props every person-backed tab receives from Profile.tsx. */
export type PersonTabProps = {
  value: PersonFormValues
  onChange: (patch: Partial<PersonFormValues>) => void
  saveState: TabSaveState
  onSave: () => void
}

export type RelationMap = Map<FamilySlot, FamilyRelationRow>

/** Initial props for a RelationField card from the loaded relation row. */
export function relationInitial(relations: RelationMap, slot: FamilySlot) {
  const row = relations.get(slot)
  return {
    initialName: row?.related_name ?? '',
    initialMemberCode: row?.related_member_code ?? '',
    initialContact: {
      mobileNumber: row?.mobile_number ?? '',
      dob: row?.dob ?? '',
    } satisfies RelativeContact,
    initialDetails: {
      email: row?.email ?? '',
      profession: row?.profession ?? '',
      bloodGroup: row?.blood_group ?? '',
    } satisfies RelationDetails,
  }
}
