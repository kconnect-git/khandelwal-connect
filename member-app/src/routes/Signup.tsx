import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../utils/supabase'

export function Signup() {
  const navigate = useNavigate()
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const { error } = await supabase.auth.signInWithOtp({ email })

    setLoading(false)

    if (error) {
      setError(error.message)
      return
    }

    navigate('/verify', { state: { email, fullName } })
  }

  return (
    <div className="flex-1 flex items-center justify-center px-5">
      <form onSubmit={handleSubmit} className="w-full max-w-sm flex flex-col gap-4">
        <h1 className="font-heading text-2xl font-semibold">Join Khandelwal Connect</h1>
        <p className="text-[var(--color-text-muted)]">
          Enter your name and email to get a one-time code.
        </p>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm text-[var(--color-text-muted)]">Full name</span>
          <input
            type="text"
            required
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5 outline-none focus:border-[var(--color-accent)]"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm text-[var(--color-text-muted)]">Email</span>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5 outline-none focus:border-[var(--color-accent)]"
          />
        </label>

        {error && <p className="text-sm text-[var(--color-accent)]">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="rounded-lg bg-[var(--color-accent)] text-white font-medium py-2.5 hover:bg-[var(--color-accent-hover)] disabled:opacity-60 transition-colors"
        >
          {loading ? 'Sending code…' : 'Send code'}
        </button>
      </form>
    </div>
  )
}
