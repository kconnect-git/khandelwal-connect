import { Navigate } from 'react-router-dom'
import { useProfileStatus } from '../hooks/useProfileStatus'

export function RootRedirect() {
  const status = useProfileStatus()

  if (status.state === 'loading') return null
  if (status.state === 'anonymous') return <Navigate to="/signup" replace />
  if (status.state === 'incomplete') return <Navigate to="/onboarding" replace />
  return <Navigate to="/dashboard" replace />
}
