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

export function useProfileStatus(): ProfileStatus {
  const [status, setStatus] = useState<ProfileStatus>({ state: 'loading' })

  useEffect(() => {
    let cancelled = false

    async function load() {
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
    }

    load()
    return () => {
      cancelled = true
    }
  }, [])

  return status
}
