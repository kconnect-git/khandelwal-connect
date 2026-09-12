import type { PersonFormValues } from '../../lib/people'
import { EMAIL_PATTERN } from '../../lib/familyDetails'
import { PERSON_TAB_FIELDS, type ProfileTabKey } from '../../lib/profileTabs'

export type WizardStep = 1 | 2 | 3

export const STEP_FIELDS: Record<WizardStep, (keyof PersonFormValues)[]> = {
  1: ['first_name', 'last_name', 'gender', 'dob', 'mobile_number'],
  2: ['home_address', 'current_city', 'current_district', 'current_state', 'state_code', 'native_place'],
  3: ['gotra', 'marital_status', 'education'],
}

const MOBILE_PATTERN = /^\+91[6-9]\d{9}$/
const PINCODE_PATTERN = /^\d{6}$/
const MIN_AGE_YEARS = 13
const MAX_AGE_YEARS = 115

function isFilled(value: string): boolean {
  return value.trim() !== ''
}

export function stepFieldsMissing(step: WizardStep, form: PersonFormValues): boolean {
  return STEP_FIELDS[step].some((field) => !isFilled(form[field]))
}

type FieldRule = (form: PersonFormValues) => string | null

/** One rule per field. Required-ness lives here too (the wizard-required
 * fields return a message when blank; optional ones only check format).
 * Both the wizard (per step) and the Profile page (per tab) validate by
 * picking the fields they own from this table, so a rule is written once. */
const FIELD_RULES: Partial<Record<keyof PersonFormValues, FieldRule>> = {
  first_name: (f) => (isFilled(f.first_name) ? null : 'First name is required.'),
  last_name: (f) => (isFilled(f.last_name) ? null : 'Last name is required.'),
  gender: (f) => (isFilled(f.gender) ? null : 'Please select a gender.'),
  dob: (f) => {
    if (!isFilled(f.dob)) return 'Date of birth is required.'
    const dob = new Date(f.dob)
    const now = new Date()
    if (Number.isNaN(dob.getTime()) || dob > now) {
      return 'Please enter a valid date of birth.'
    }
    const ageYears = (now.getTime() - dob.getTime()) / (1000 * 60 * 60 * 24 * 365.25)
    if (ageYears < MIN_AGE_YEARS || ageYears > MAX_AGE_YEARS) {
      return 'Please enter a plausible date of birth.'
    }
    return null
  },
  mobile_number: (f) => {
    if (!isFilled(f.mobile_number)) return 'Mobile number is required.'
    if (!MOBILE_PATTERN.test(f.mobile_number.trim())) {
      return 'Please enter a valid 10-digit mobile number.'
    }
    return null
  },
  home_address: (f) => (isFilled(f.home_address) ? null : 'Home address is required.'),
  current_city: (f) => (isFilled(f.current_city) ? null : 'Current city is required.'),
  current_district: (f) => (isFilled(f.current_district) ? null : 'Current district is required.'),
  // state_code is set alongside current_state by the same dropdown pick
  // (see StepLocation.tsx) -- checking it too catches rows saved before
  // that pairing existed, where current_state has a value but state_code
  // was never backfilled. Re-picking the same state repopulates it.
  current_state: (f) =>
    isFilled(f.current_state) && isFilled(f.state_code) ? null : 'Please select your current state.',
  native_place: (f) => (isFilled(f.native_place) ? null : 'Native place is required.'),
  gotra: (f) => (isFilled(f.gotra) ? null : 'Gotra is required.'),
  marital_status: (f) => (isFilled(f.marital_status) ? null : 'Please select a marital status.'),
  education: (f) => (isFilled(f.education) ? null : 'Qualification is required.'),
  // Profile-only optional fields: format checks only.
  secondary_email: (f) => {
    const email = f.secondary_email.trim()
    if (email.length > 0 && !EMAIL_PATTERN.test(email)) {
      return 'Please enter a valid secondary email, or leave it blank.'
    }
    return null
  },
  secondary_mobile: (f) => {
    const mobile = f.secondary_mobile.trim()
    if (mobile.length > 0 && !MOBILE_PATTERN.test(mobile)) {
      return 'Please enter a valid 10-digit secondary mobile number, or leave it blank.'
    }
    return null
  },
  pincode: (f) => {
    const pin = f.pincode.trim()
    if (pin.length > 0 && !PINCODE_PATTERN.test(pin)) {
      return 'PIN code must be 6 digits, or leave it blank.'
    }
    return null
  },
  date_of_marriage: (f) => {
    const raw = f.date_of_marriage.trim()
    if (raw.length === 0) return null
    const marriage = new Date(raw)
    if (Number.isNaN(marriage.getTime())) return 'Please enter a valid date of marriage.'
    if (marriage > new Date()) return 'Date of marriage cannot be in the future.'
    if (isFilled(f.dob)) {
      const dob = new Date(f.dob)
      if (!Number.isNaN(dob.getTime()) && marriage < dob) {
        return 'Date of marriage cannot be before your date of birth.'
      }
    }
    return null
  },
}

/** First error among the given fields, in the order given. */
export function validateFields(
  fields: (keyof PersonFormValues)[],
  form: PersonFormValues,
): string | null {
  for (const field of fields) {
    const message = FIELD_RULES[field]?.(form)
    if (message) return message
  }
  return null
}

export function validateStep(step: WizardStep, form: PersonFormValues): string | null {
  return validateFields(STEP_FIELDS[step], form)
}

/** Edit-profile only (not a wizard step). Occupation itself is optional;
 * once it's 'Job', the three job sub-fields become required. */
export function validateOccupation(form: PersonFormValues): string | null {
  if (form.occupation_type !== 'Job') return null
  if (!isFilled(form.job_title)) return 'Job title is required when your occupation is Job.'
  if (!isFilled(form.company_name)) return 'Company is required when your occupation is Job.'
  if (!isFilled(form.job_location)) return 'Work location is required when your occupation is Job.'
  return null
}

/** Validates only the fields a Profile tab owns (PERSON_TAB_FIELDS). */
export function validateProfileTab(tab: ProfileTabKey, form: PersonFormValues): string | null {
  const message = validateFields(PERSON_TAB_FIELDS[tab] ?? [], form)
  if (message) return message
  if (tab === 'business') return validateOccupation(form)
  return null
}
