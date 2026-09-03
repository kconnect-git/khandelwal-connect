import type { PersonFormValues } from '../../lib/people'

export type WizardStep = 1 | 2 | 3

export const STEP_FIELDS: Record<WizardStep, (keyof PersonFormValues)[]> = {
  1: ['full_name', 'gender', 'dob', 'mobile_number'],
  2: ['home_address', 'current_city', 'current_district', 'current_state', 'state_code', 'native_place'],
  3: ['gotra', 'marital_status', 'education'],
}

const MOBILE_PATTERN = /^\+91[6-9]\d{9}$/
const MIN_AGE_YEARS = 13
const MAX_AGE_YEARS = 115

function isFilled(value: string): boolean {
  return value.trim() !== ''
}

export function stepFieldsMissing(step: WizardStep, form: PersonFormValues): boolean {
  return STEP_FIELDS[step].some((field) => !isFilled(form[field]))
}

export function validateStep(step: WizardStep, form: PersonFormValues): string | null {
  if (step === 1) {
    if (!isFilled(form.full_name)) return 'Full name is required.'
    if (!isFilled(form.gender)) return 'Please select a gender.'
    if (!isFilled(form.dob)) return 'Date of birth is required.'

    const dob = new Date(form.dob)
    const now = new Date()
    if (Number.isNaN(dob.getTime()) || dob > now) {
      return 'Please enter a valid date of birth.'
    }
    const ageYears = (now.getTime() - dob.getTime()) / (1000 * 60 * 60 * 24 * 365.25)
    if (ageYears < MIN_AGE_YEARS || ageYears > MAX_AGE_YEARS) {
      return 'Please enter a plausible date of birth.'
    }

    if (!isFilled(form.mobile_number)) return 'Mobile number is required.'
    if (!MOBILE_PATTERN.test(form.mobile_number.trim())) {
      return 'Please enter a valid 10-digit mobile number.'
    }

    return null
  }

  if (step === 2) {
    if (!isFilled(form.home_address)) return 'Home address is required.'
    if (!isFilled(form.current_city)) return 'Current city is required.'
    if (!isFilled(form.current_district)) return 'Current district is required.'
    // state_code is set alongside current_state by the same dropdown pick
    // (see StepLocation.tsx) -- checking it too catches rows saved before
    // that pairing existed, where current_state has a value but state_code
    // was never backfilled. Re-picking the same state repopulates it.
    if (!isFilled(form.current_state) || !isFilled(form.state_code)) {
      return 'Please select your current state.'
    }
    if (!isFilled(form.native_place)) return 'Native place is required.'
    return null
  }

  if (!isFilled(form.gotra)) return 'Gotra is required.'
  if (!isFilled(form.marital_status)) return 'Please select a marital status.'
  if (!isFilled(form.education)) return 'Education is required.'
  return null
}
