// Remembers the path an anonymous visitor was trying to reach (e.g. an
// event deep link from an invite email) so VerifyOtp can send them there
// after login instead of the default landing. sessionStorage: survives the
// signup -> verify hops in the same tab, dies with the tab.

const KEY = 'kc.returnTo'

// Never worth returning to: the auth screens themselves and the root.
const IGNORED = new Set(['/', '/signup', '/verify', '/onboarding'])

function isSafePath(path: string): boolean {
  // Same-origin, absolute paths only -- no protocol-relative "//evil.com".
  return path.startsWith('/') && !path.startsWith('//')
}

export function setReturnTo(path: string): void {
  if (!isSafePath(path)) return
  const pathname = path.split('?')[0]
  if (IGNORED.has(pathname)) return
  try {
    sessionStorage.setItem(KEY, path)
  } catch {
    // storage unavailable (private mode, blocked) -- deep link just won't stick
  }
}

/** Reads and clears the stored path. */
export function consumeReturnTo(): string | null {
  try {
    const value = sessionStorage.getItem(KEY)
    sessionStorage.removeItem(KEY)
    return value && isSafePath(value) ? value : null
  } catch {
    return null
  }
}

export function clearReturnTo(): void {
  try {
    sessionStorage.removeItem(KEY)
  } catch {
    // ignore
  }
}
