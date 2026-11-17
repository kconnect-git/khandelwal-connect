// Phase 11.3: the paid-member badge beside a name in the Directory and on a
// member's profile. The server decides (has_paid_badge: a live grant for any
// service while at least one paywall is on), so until a paywall is turned on
// nobody shows it. Outline, not filled: names stay the loudest thing.

export function PaidBadge({ show }: { show: boolean }) {
  if (!show) return null
  return (
    <span
      title="Has paid access to a KITE service"
      className="inline-flex shrink-0 items-center rounded-full border border-[var(--color-accent)] px-2 py-0.5 text-[11px] font-medium leading-none tracking-wide text-[var(--color-accent)] uppercase"
    >
      Premium
    </span>
  )
}
