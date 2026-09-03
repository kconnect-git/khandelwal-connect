import { Link } from 'react-router-dom'
import { TextField } from './TextField'
import { SelectField } from './SelectField'
import { OCCUPATION_OPTIONS } from '../../lib/formOptions'
import type { PersonFormValues } from '../../lib/people'

type OccupationFieldsProps = {
  value: PersonFormValues
  onChange: (patch: Partial<PersonFormValues>) => void
}

/** Occupation section for Edit profile. Deliberately not a wizard step --
 * onboarding stays at 3 steps. 'Job' reveals title/company/location;
 * 'Business' points at the Businesses pages, where listings live. */
export function OccupationFields({ value, onChange }: OccupationFieldsProps) {
  const isJob = value.occupation_type === 'Job'
  const isBusiness = value.occupation_type === 'Business'

  return (
    <div className="flex flex-col gap-4">
      <h2 className="font-heading text-lg font-semibold">Occupation</h2>
      <SelectField
        label="Occupation"
        required
        value={value.occupation_type}
        onChange={(v) => onChange({ occupation_type: v })}
        options={OCCUPATION_OPTIONS}
      />
      {isJob && (
        <>
          <TextField
            label="Job title"
            required
            value={value.job_title}
            onChange={(v) => onChange({ job_title: v })}
            placeholder="e.g. Chartered Accountant"
          />
          <TextField
            label="Company"
            required
            value={value.company_name}
            onChange={(v) => onChange({ company_name: v })}
            placeholder="e.g. Infosys"
          />
          <TextField
            label="Work location"
            required
            value={value.job_location}
            onChange={(v) => onChange({ job_location: v })}
            placeholder="e.g. Jaipur"
          />
        </>
      )}
      {isBusiness && (
        <p className="text-sm text-[var(--color-text-muted)]">
          Add your business under{' '}
          <Link to="/businesses/mine" className="underline hover:text-[var(--color-text)]">
            My businesses
          </Link>{' '}
          so other members can find it.
        </p>
      )}
    </div>
  )
}
