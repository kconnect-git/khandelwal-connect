import { useEffect, useState } from 'react'
import { supabase } from '../utils/supabase'
import { getOwnPerson } from '../lib/people'
import { isWizardComplete } from '../lib/profileCompletion'
import type { Person } from '../types/database'

export type ProfileStatus =
  | { state: 'loading' }
  | { state: 'anonymous' }
  | { state: 'incomplete'; person: Person | null; authUserId: string }
  // (0019) Wizard done, but an admin hasn't approved the member yet --
  // pending, info_requested or rejected. AuthGate sends these to /pending.
  | { state: 'awaiting_approval'; person: Person }
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
          // Submit the profile for review the first time it is seen complete,
          // which also assigns the member code. state_code is populated
          // client-side from the state dropdown (see formOptions.ts) -- the
          // RPC only handles collision-safe number assignment, not the name
          // -> code lookup. (0019) This replaced a bare assign_member_code
          // call; submit_for_review does that *and* moves 'onboarding' ->
          // 'pending'. It is idempotent for an already-approved member, so it
          // is safe on every load, and it catches the historical rows that
          // completed the wizard but never got a code.
          if (person.member_status === 'onboarding' || !person.member_code) {
            try {
              const { data: code, error: rpcError } = await supabase.rpc('submit_for_review')
              if (!rpcError) {
                person = {
                  ...person,
                  member_code: code ?? person.member_code,
                  member_status: person.member_status === 'onboarding' ? 'pending' : person.member_status,
                }
              }
            } catch (rpcErr) {
              console.error('[useProfileStatus] failed to submit profile for review', rpcErr)
            }
            if (cancelled) return
          }

          // Strict equality on purpose: if this build ever runs against a
          // database without 0019, member_status is undefined and everyone
          // lands on /pending rather than silently getting full access.
          if (person.member_status === 'approved') {
            setStatus({ state: 'complete', person })
          } else {
            setStatus({ state: 'awaiting_approval', person })
          }
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
