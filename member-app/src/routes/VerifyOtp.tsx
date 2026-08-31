import { useEffect, useState, type FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '../utils/supabase'

type LocationState = { email: string; fullName: string }

const RESEND_COOLDOWN_SECONDS = 30

export function VerifyOtp() {
  const navigate = useNavigate()
  const location = useLocation()
  const state = location.state as LocationState | null

  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [resending, setResending] = useState(false)
  const [resendMessage, setResendMessage] = useState<string | null>(null)
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_SECONDS)

  useEffect(() => {
    if (cooldown === 0) return
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000)
    return () => clearTimeout(timer)
  }, [cooldown])

  if (!state?.email) {
    return <Navigate to="/signup" replace />
  }

  const { email, fullName } = state

  async function handleResend() {
    setResending(true)
    setResendMessage(null)
    setError(null)

    try {
      console.log('[verify] resending OTP for', email)
      const { data, error: resendError } = await supabase.auth.signInWithOtp({ email })
      console.log('[verify] resend result', { data, resendError })

      if (resendError) {
        setError(resendError.message)
        return
      }

      setResendMessage('New code sent.')
      setCooldown(RESEND_COOLDOWN_SECONDS)
    } catch (err) {
      console.error('[verify] unexpected resend error', err)
      setError(err instanceof Error ? err.message : 'Something went wrong resending the code.')
    } finally {
      setResending(false)
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      console.log('[verify] verifying OTP for', email)
      const { data, error: verifyError } = await supabase.auth.verifyOtp({
        email,
        token: code,
        type: 'email',
      })
      console.log('[verify] verifyOtp result', { data, verifyError })

      if (verifyError || !data.session) {
        setError(verifyError?.message ?? 'Could not verify code.')
        return
      }

      console.log('[verify] inserting people row for', data.session.user.id)
      const { error: insertError } = await supabase.from('people').insert({
        auth_user_id: data.session.user.id,
        full_name: fullName,
      })
      console.log('[verify] insert result', { insertError })

      if (insertError) {
        setError(insertError.message)
        return
      }

      navigate('/dashboard', { replace: true })
    } catch (err) {
      console.error('[verify] unexpected verify error', err)
      setError(err instanceof Error ? err.message : 'Something went wrong verifying the code.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex-1 flex items-center justify-center px-5">
      <form onSubmit={handleSubmit} className="w-full max-w-sm flex flex-col gap-4">
        <h1 className="font-heading text-2xl font-semibold">Enter your code</h1>
        <p className="text-[var(--color-text-muted)]">
          We sent a 6-digit code to <span className="text-[var(--color-text)]">{email}</span>.
        </p>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm text-[var(--color-text-muted)]">6-digit code</span>
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]{6}"
            maxLength={6}
            required
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5 tracking-[0.4em] text-center text-lg outline-none focus:border-[var(--color-accent)]"
          />
        </label>

        {error && <p className="text-sm text-[var(--color-accent)]">{error}</p>}
        {resendMessage && <p className="text-sm text-[var(--color-text-muted)]">{resendMessage}</p>}

        <button
          type="submit"
          disabled={loading || code.length !== 6}
          className="rounded-lg bg-[var(--color-accent)] text-white font-medium py-2.5 hover:bg-[var(--color-accent-hover)] disabled:opacity-60 transition-colors"
        >
          {loading ? 'Verifying…' : 'Verify'}
        </button>

        <button
          type="button"
          onClick={handleResend}
          disabled={resending || cooldown > 0}
          className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-60 transition-colors"
        >
          {resending
            ? 'Resending…'
            : cooldown > 0
              ? `Resend code in ${cooldown}s`
              : 'Resend code'}
        </button>
      </form>
    </div>
  )
}
