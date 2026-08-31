import { useEffect, useState } from 'react'
import { supabase } from '../utils/supabase'
import { getOwnPerson } from '../lib/people'
import { isWizardComplete } from '../lib/profileCompletion'
import type { Person } from '../types/database'

export type ProfileStatus =
  | { state: 'loading' }
  | { state: 'anonymous' }
  | { state: 'incomplete'; person: Person | null; authUserId: string }
  | { state: 'complete'; person: Person }
  | { state: 'error'; message: string; retry: () => void }

const AUTO_RETRY_DELAY_MS = 500

export function useProfileStatus(): ProfileStatus {
  const [status, setStatus] = useState<ProfileStatus>({ state: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const { data: sessionData } = await supabase.auth.getSession()
        const session = sessionData.session

        if (!session) {
          if (!cancelled) setStatus({ state: 'anonymous' })
          return
        }

        const person = await getOwnPerson(session.user.id)
        if (cancelled) return

        if (person && isWizardComplete(person)) {
          setStatus({ state: 'complete', person })
        } else {
          setStatus({ state: 'incomplete', person, authUserId: session.user.id })
        }
      } catch (err) {
        if (cancelled) return
        console.error('[useProfileStatus] load failed (attempt', attempt, ')', err)

        // A single silent retry smooths over transient blips (e.g. a read
        // landing right after a write) without the user having to notice.
        // Only surface a visible error once that retry also fails.
        if (attempt < 1) {
          setTimeout(() => {
            if (!cancelled) setAttempt((a) => a + 1)
          }, AUTO_RETRY_DELAY_MS)
          return
        }

        setStatus({
          state: 'error',
          message:
            err instanceof Error ? err.message : 'Something went wrong loading your profile.',
          retry: () => {
            setStatus({ state: 'loading' })
            setAttempt(0)
          },
        })
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [attempt])

  return status
}
