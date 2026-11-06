import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { supabase } from '../utils/supabase'
import { useProfileStatus } from '../hooks/useProfileStatus'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { TextField } from '../components/form/TextField'
import { AuthHeading, AuthShell } from '../components/kite/AuthShell'
import { pillPrimary } from '../components/kite/Brand'

// (KITE) /signin and /join, from kite-landing.html. Both are the same
// passwordless email code as the old /signup -- signInWithOtp creates the
// account on first use -- so the design's password and full-name fields are
// left out (the wizard asks for the name). Only the copy differs.

export type AuthMode = 'signin' | 'join'

const COPY: Record<
  AuthMode,
  { title: string; docTitle: string; intro: string; submit: string; switchText: string; switchTo: string; switchLabel: string }
> = {
  signin: {
    title: 'Welcome back',
    docTitle: 'Sign in | KITE',
    intro: 'Sign in to connect with your community.',
    submit: 'Sign in',
    switchText: 'New to KITE?',
    switchTo: '/join',
    switchLabel: 'Join KITE',
  },
  join: {
    title: 'Join KITE',
    docTitle: 'Join | KITE',
    intro: 'Every member is verified before joining.',
    submit: 'Request to join',
    switchText: 'Already a member?',
    switchTo: '/signin',
    switchLabel: 'Sign in',
  },
}

export function SignIn() {
  return <EmailCodePage mode="signin" />
}

export function Join() {
  return <EmailCodePage mode="join" />
}

function EmailCodePage({ mode }: { mode: AuthMode }) {
  const copy = COPY[mode]
  useDocumentTitle(copy.docTitle)
  const navigate = useNavigate()
  const status = useProfileStatus()
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  if (status.state === 'loading') return null
  // Already signed in: RootRedirect sends them on to the right screen.
  if (status.state !== 'anonymous') return <Navigate to="/" replace />

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      console.log(`[${mode}] requesting OTP for`, email)
      const { data, error } = await supabase.auth.signInWithOtp({ email })
      console.log(`[${mode}] signInWithOtp result`, { data, error })

      if (error) {
        setError(error.message)
        return
      }

      navigate('/verify', { state: { email, from: mode } })
    } catch (err) {
      console.error(`[${mode}] unexpected error`, err)
      setError(err instanceof Error ? err.message : 'Something went wrong sending the code.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthShell>
      <AuthHeading title={copy.title} intro={copy.intro} />
      <form onSubmit={handleSubmit} className="flex flex-col gap-4.5">
        <TextField
          label="Email"
          type="email"
          required
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={setEmail}
        />
        <p className="-mt-2 text-sm text-[var(--color-text-muted)]">We'll email you a 6-digit code.</p>

        {error && <p className="text-sm text-[var(--color-accent)]">{error}</p>}

        <button type="submit" disabled={loading} className={`${pillPrimary} w-full mt-1.5`}>
          {loading ? 'Sending code…' : copy.submit}
        </button>
      </form>
      <p className="mt-6 text-center text-[var(--color-text-muted)]">
        {copy.switchText}{' '}
        <Link
          to={copy.switchTo}
          className="inline-block py-2.5 px-1 font-semibold text-[var(--color-chip-warm-fg)] hover:underline"
        >
          {copy.switchLabel}
        </Link>
      </p>
    </AuthShell>
  )
}
