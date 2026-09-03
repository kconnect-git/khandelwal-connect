export function getInitials(fullName: string | null | undefined): string {
  const words = (fullName ?? '').trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[words.length - 1][0]).toUpperCase()
}

type AvatarProps = {
  name: string | null | undefined
  photoUrl?: string | null
  /** Diameter in px. Text scales with it. */
  size?: number
}

export function Avatar({ name, photoUrl, size = 32 }: AvatarProps) {
  const style = { width: size, height: size }

  if (photoUrl) {
    return (
      <img
        src={photoUrl}
        alt={name ?? 'Profile photo'}
        style={style}
        className="rounded-full object-cover shrink-0 border border-[var(--color-border)]"
      />
    )
  }

  return (
    <span
      style={{ ...style, fontSize: Math.max(11, Math.round(size * 0.38)) }}
      className="flex items-center justify-center rounded-full bg-[var(--color-accent)] text-white font-semibold shrink-0 select-none"
    >
      {getInitials(name)}
    </span>
  )
}
