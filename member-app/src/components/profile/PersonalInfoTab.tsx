import { TextField } from '../form/TextField'
import { SelectField } from '../form/SelectField'
import { RelationField } from '../familyDetails/RelationField'
import { TabSaveBar } from './TabSaveBar'
import { relationInitial, type PersonTabProps, type RelationMap } from './tabTypes'
// (TabSaveState lives in tabTypes.ts so this file only exports a component.)
import { BLOOD_GROUP_OPTIONS, GENDER_OPTIONS } from '../../lib/formOptions'
import { ageFromDob } from '../../lib/people'

const today = new Date().toISOString().slice(0, 10)
const minDob = new Date(new Date().setFullYear(new Date().getFullYear() - 115))
  .toISOString()
  .slice(0, 10)

type PersonalInfoTabProps = PersonTabProps & {
  relations: RelationMap
  /** Bumped on every reload so the relation cards re-seed their state. */
  loadAttempt: number
}

export function PersonalInfoTab({
  value,
  onChange,
  saveState,
  onSave,
  relations,
  loadAttempt,
}: PersonalInfoTabProps) {
  const age = ageFromDob(value.dob)

  return (
    <div className="w-full flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <TextField
            label="First name"
            required
            value={value.first_name}
            onChange={(v) => onChange({ first_name: v })}
          />
          <TextField
            label="Middle name"
            value={value.middle_name}
            onChange={(v) => onChange({ middle_name: v })}
          />
          <TextField
            label="Last name"
            required
            value={value.last_name}
            onChange={(v) => onChange({ last_name: v })}
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <SelectField
            label="Gender"
            required
            value={value.gender}
            onChange={(v) => onChange({ gender: v })}
            options={GENDER_OPTIONS}
          />
          <SelectField
            label="Blood group"
            value={value.blood_group}
            onChange={(v) => onChange({ blood_group: v })}
            options={[{ value: '', label: 'Select…' }, ...BLOOD_GROUP_OPTIONS]}
          />
          <TextField
            label="Date of birth"
            type="date"
            required
            min={minDob}
            max={today}
            value={value.dob}
            onChange={(v) => onChange({ dob: v })}
          />
          <div className="flex flex-col gap-1.5">
            <span className="text-sm text-[var(--color-text-muted)]">Age</span>
            <p className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5 text-[var(--color-text-muted)]">
              {age === null ? '—' : `${age} years`}
            </p>
          </div>
        </div>
        <TextField
          label="Qualification"
          required
          value={value.education}
          onChange={(v) => onChange({ education: v })}
          placeholder="e.g. B.Tech Computer Science, IIT Delhi"
        />
        <TabSaveBar state={saveState} onSave={onSave} />
      </div>

      <div className="flex flex-col gap-4">
        <div>
          <h2 className="font-heading text-lg font-semibold">Parents</h2>
          <p className="text-sm text-[var(--color-text-muted)]">
            Search for a relative if they're already a member to link their record, or just type
            their name if they haven't joined yet — you can add their member ID later once they
            do.
          </p>
        </div>
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
      </div>
    </div>
  )
}
