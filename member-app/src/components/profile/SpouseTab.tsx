import { TextField } from '../form/TextField'
import { SelectField } from '../form/SelectField'
import { RelationField } from '../familyDetails/RelationField'
import { TabSaveBar } from './TabSaveBar'
import { relationInitial, type PersonTabProps, type RelationMap } from './tabTypes'
import { MARITAL_STATUS_OPTIONS } from '../../lib/formOptions'

const today = new Date().toISOString().slice(0, 10)

type SpouseTabProps = PersonTabProps & {
  relations: RelationMap
  loadAttempt: number
}

export function SpouseTab({
  value,
  onChange,
  saveState,
  onSave,
  relations,
  loadAttempt,
}: SpouseTabProps) {
  // Gated on the *live* dropdown value, so the cards appear the moment
  // "Married" is picked. Still Married-only, per phase-3a-summary.md §8.
  const isMarried = value.marital_status === 'Married'

  return (
    <div className="w-full flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <SelectField
            label="Marital status"
            required
            value={value.marital_status}
            onChange={(v) => onChange({ marital_status: v })}
            options={MARITAL_STATUS_OPTIONS}
          />
          {isMarried && (
            <TextField
              label="Date of marriage"
              type="date"
              min={value.dob || undefined}
              max={today}
              value={value.date_of_marriage}
              onChange={(v) => onChange({ date_of_marriage: v })}
            />
          )}
        </div>
        <TabSaveBar state={saveState} onSave={onSave} />
      </div>

      {isMarried ? (
        <div className="flex flex-col gap-4">
          <RelationField
            key={`spouse-${loadAttempt}`}
            label="Spouse"
            slot="spouse"
            showDetails
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
        </div>
      ) : (
        <p className="text-sm text-[var(--color-text-muted)]">
          Spouse details can be added once your marital status is set to Married.
        </p>
      )}
    </div>
  )
}
