/** (10.7 / 10.8) A small number tile: Referrals' Given / Received / Closed,
 * the business dashboard's monthly numbers. */
export function StatCounter({
  value,
  label,
  sub,
}: {
  value: number | null
  label: string
  /** An extra green line under the label, e.g. "2 business done". */
  sub?: string
}) {
  return (
    <div className="flex flex-col gap-0.5 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-3">
      <span className="font-heading text-2xl font-bold leading-none">{value ?? '–'}</span>
      <span className="text-xs text-[var(--color-text-muted)]">{label}</span>
      {sub && <span className="text-xs text-[var(--color-badge-live-fg)]">{sub}</span>}
    </div>
  )
}
