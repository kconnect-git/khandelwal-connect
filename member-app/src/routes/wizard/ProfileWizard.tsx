import { useEffect, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { supabase } from '../../utils/supabase'
import {
  formValuesToPatch,
  getOwnPerson,
  personToFormValues,
  saveOwnPerson,
  type PersonFormValues,
} from '../../lib/people'
import { isWizardComplete } from '../../lib/profileCompletion'
import type { Person } from '../../types/database'
import { STEP_FIELDS, stepFieldsMissing, validateStep, type WizardStep } from './validation'
import { StepPersonal } from './StepPersonal'
import { StepLocation } from './StepLocation'
import { StepGotraBackground } from './StepGotraBackground'
import { ProfileLoadError } from '../../components/guards/ProfileLoadError'
import { useProfileRefresh } from '../../context/ProfileRefreshContext'

const BLANK_FORM: PersonFormValues = {
  full_name: '',
  gender: '',
  dob: '',
  mobile_number: '',
  home_address: '',
  current_city: '',
  current_district: '',
  current_state: '',
  state_code: '',
  native_place: '',
  gotra: '',
  marital_status: '',
  education: '',
}

function pickStepValues(
  form: PersonFormValues,
  step: WizardStep,
): Partial<PersonFormValues> {
  const patch: Partial<PersonFormValues> = {}
  for (const field of STEP_FIELDS[step]) {
    patch[field] = form[field]
  }
  return patch
}

function firstIncompleteStep(form: PersonFormValues): WizardStep {
  const steps: WizardStep[] = [1, 2, 3]
  for (const step of steps) {
    if (stepFieldsMissing(step, form)) return step
  }
  return 3
}

type Status = 'loading' | 'ready' | 'anonymous' | 'done' | 'error'

export function ProfileWizard() {
  const navigate = useNavigate()
  const { triggerRefresh } = useProfileRefresh()
  const [status, setStatus] = useState<Status>('loading')
  const [authUserId, setAuthUserId] = useState<string | null>(null)
  const [existingPerson, setExistingPerson] = useState<Person | null>(null)
  const [form, setForm] = useState<PersonFormValues>(BLANK_FORM)
  const [step, setStep] = useState<WizardStep>(1)
  const [error, setError] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadAttempt, setLoadAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const { data: sessionData } = await supabase.auth.getSession()
        const session = sessionData.session

        if (!session) {
          if (!cancelled) setStatus('anonymous')
          return
        }

        const person = await getOwnPerson(session.user.id)
        if (cancelled) return

        if (person && isWizardComplete(person)) {
          setStatus('done')
          return
        }

        const seeded = person ? personToFormValues(person) : BLANK_FORM
        setAuthUserId(session.user.id)
        setExistingPerson(person)
        setForm(seeded)
        setStep(firstIncompleteStep(seeded))
        setStatus('ready')
      } catch (err) {
        if (cancelled) return
        console.error('[ProfileWizard] failed to load profile', err)
        setLoadError(
          err instanceof Error ? err.message : 'Something went wrong loading your profile.',
        )
        setStatus('error')
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [loadAttempt])

  if (status === 'loading') return null
  if (status === 'anonymous') return <Navigate to="/signup" replace />
  if (status === 'done') return <Navigate to="/dashboard" replace />
  if (status === 'error') {
    return (
      <ProfileLoadError
        message={loadError ?? 'Something went wrong loading your profile.'}
        retry={() => {
          setStatus('loading')
          setLoadAttempt((a) => a + 1)
        }}
      />
    )
  }

  function handleChange(patch: Partial<PersonFormValues>) {
    setForm((prev) => ({ ...prev, ...patch }))
  }

  async function handleNext() {
    if (!authUserId) return
    const message = validateStep(step, form)
    if (message) {
      setError(message)
      return
    }

    setError(null)
    setLoading(true)
    try {
      if (step === 3) {
        // One RPC call: saves the step-3 fields and generates the member
        // code in the same database round trip, rather than saving here
        // and leaving code assignment to a later page load.
        const { data: memberCode, error: rpcError } = await supabase.rpc(
          'complete_onboarding_step3',
          {
            p_gotra: form.gotra,
            p_marital_status: form.marital_status,
            p_education: form.education,
          },
        )
        if (rpcError) throw rpcError
        console.log('[ProfileWizard] onboarding complete, member code', memberCode)

        triggerRefresh()
        navigate('/dashboard', { replace: true })
        return
      }

      const patch = formValuesToPatch(pickStepValues(form, step))
      const saved = await saveOwnPerson(patch, existingPerson, authUserId)
      setExistingPerson(saved)
      // Header initials come from full_name -- refresh so a name typed in
      // step 1 shows up without leaving /onboarding.
      triggerRefresh()
      setStep((step + 1) as WizardStep)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong saving your details.')
    } finally {
      setLoading(false)
    }
  }

  function handleBack() {
    setError(null)
    setStep((step - 1) as WizardStep)
  }

  return (
    <div className="flex-1 flex items-center justify-center px-5 py-10">
      <div className="w-full max-w-sm flex flex-col gap-4">
        <div>
          <p className="text-sm text-[var(--color-text-muted)]">Step {step} of 3</p>
          <h1 className="font-heading text-2xl font-semibold">
            {step === 1 && 'Tell us about you'}
            {step === 2 && 'Where are you based?'}
            {step === 3 && 'Gotra & background'}
          </h1>
        </div>

        {step === 1 && <StepPersonal value={form} onChange={handleChange} />}
        {step === 2 && <StepLocation value={form} onChange={handleChange} />}
        {step === 3 && <StepGotraBackground value={form} onChange={handleChange} />}

        {error && <p className="text-sm text-[var(--color-accent)]">{error}</p>}

        <div className="flex gap-3">
          {step > 1 && (
            <button
              type="button"
              onClick={handleBack}
              disabled={loading}
              className="rounded-lg border border-[var(--color-border)] px-4 py-2.5 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-text-muted)] disabled:opacity-60 transition-colors"
            >
              Back
            </button>
          )}
          <button
            type="button"
            onClick={handleNext}
            disabled={loading}
            className="flex-1 rounded-lg bg-[var(--color-accent)] text-white font-medium py-2.5 hover:bg-[var(--color-accent-hover)] disabled:opacity-60 transition-colors"
          >
            {loading ? 'Saving…' : step === 3 ? 'Finish' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  )
}
