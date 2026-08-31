import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useProfileStatus } from '../../hooks/useProfileStatus'

type AuthGateProps = {
  children: ReactNode
  requireComplete?: boolean
}

export function AuthGate({ children, requireComplete = false }: AuthGateProps) {
  const status = useProfileStatus()

  if (status.state === 'loading') return null
  if (status.state === 'anonymous') return <Navigate to="/signup" replace />
  if (status.state === 'incomplete' && requireComplete) {
    return <Navigate to="/onboarding" replace />
  }

  return <>{children}</>
}
