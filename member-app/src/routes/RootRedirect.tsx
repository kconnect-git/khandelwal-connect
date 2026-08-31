import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { supabase } from '../utils/supabase'

export function RootRedirect() {
  const [target, setTarget] = useState<'/dashboard' | '/signup' | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setTarget(data.session ? '/dashboard' : '/signup')
    })
  }, [])

  if (!target) return null

  return <Navigate to={target} replace />
}
