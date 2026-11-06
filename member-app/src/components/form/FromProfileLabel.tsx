/** (10.4) A field label with the accent "From your profile" marker, for
 * forms that start from the member's own profile (the listing form, Buy &
 * Sell posts). Plain text when `marked` is false. */
export function FromProfileLabel({ text, marked }: { text: string; marked: boolean }) {
  if (!marked) return <>{text}</>
  return (
    <span className="flex items-baseline justify-between gap-2">
      <span>{text}</span>
      <span className="text-xs font-medium text-[var(--color-accent)]">From your profile</span>
    </span>
  )
}
