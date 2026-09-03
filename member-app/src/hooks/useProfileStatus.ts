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

// Accepts an optional key (e.g. the current route) to force a refetch --
// components that persist across navigations (like the header) otherwise
// never see profile changes made on other screens, since their effect only
// runs once on mount.
export function useProfileStatus(refreshKey?: unknown): ProfileStatus {
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

        let person = await getOwnPerson(session.user.id)
        if (cancelled) return

        if (person && isWizardComplete(person)) {
          // Assign a member code the first time a profile is seen complete.
          // state_code is populated client-side from the state dropdown
          // (see formOptions.ts) -- the RPC only handles collision-safe
          // number assignment, not the name -> code lookup.
          if (!person.member_code) {
            try {
              const { data: code, error: rpcError } = await supabase.rpc('assign_member_code')
              if (!rpcError && code) person = { ...person, member_code: code }
            } catch (rpcErr) {
              console.error('[useProfileStatus] failed to assign member code', rpcErr)
            }
            if (cancelled) return
          }
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
  }, [attempt, refreshKey])

  return status
}
