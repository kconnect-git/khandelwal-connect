import { OccupationFields } from '../form/OccupationFields'
import { MyBusinessesEditor } from '../businesses/MyBusinessesEditor'
import { TabSaveBar } from './TabSaveBar'
import type { PersonTabProps } from './tabTypes'
import type { BusinessRow } from '../../types/database'

type BusinessTabProps = PersonTabProps & {
  ownerId: string
  authUserId: string
  businesses: BusinessRow[]
  onBusinessesChange: (next: BusinessRow[]) => void
}

/** Occupation (person fields, saved with the tab's Save) followed by the
 * member's business listings (each card saves itself). */
export function BusinessTab({
  value,
  onChange,
  saveState,
  onSave,
  ownerId,
  authUserId,
  businesses,
  onBusinessesChange,
}: BusinessTabProps) {
  return (
    <div className="w-full flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <h2 className="font-heading text-lg font-semibold">Occupation</h2>
        <OccupationFields value={value} onChange={onChange} />
        <TabSaveBar state={saveState} onSave={onSave} />
      </div>

      <div className="flex flex-col gap-4">
        <h2 className="font-heading text-lg font-semibold">My businesses</h2>
        <MyBusinessesEditor
          ownerId={ownerId}
          authUserId={authUserId}
          businesses={businesses}
          onChange={onBusinessesChange}
        />
      </div>
    </div>
  )
}
