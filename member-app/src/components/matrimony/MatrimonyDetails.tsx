import { formatHeight } from '../../lib/matrimony'
import type { MatrimonyProfileRow } from '../../types/database'

// Phase 6a: a matrimony profile's own fields, read-only. Used by the admin
// review screen now and the member-facing detail page in 6b. Opt-in details
// only appear when the member chose to share them -- an undisclosed field
// renders nothing, not "Not specified".

type Fields = Pick<
  MatrimonyProfileRow,
  | 'height_cm'
  | 'about_me'
  | 'about_family'
  | 'partner_expectations'
  | 'diet'
  | 'smoking'
  | 'drinking'
  | 'birth_time'
  | 'birth_place'
  | 'rashi'
  | 'nakshatra'
>

function Prose({ title, text }: { title: string; text: string | null }) {
  if (!text) return null
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="text-xs font-semibold uppercase tracking-widest text-[var(--color-text-muted)]">
        {title}
      </h3>
      <p className="whitespace-pre-line">{text}</p>
    </section>
  )
}

export function MatrimonyDetails({ profile }: { profile: Fields }) {
  const tags: { label: string; value: string | null }[] = [
    { label: 'Height', value: formatHeight(profile.height_cm) },
    { label: 'Diet', value: profile.diet },
    { label: 'Smoking', value: profile.smoking },
    { label: 'Drinking', value: profile.drinking },
    { label: 'Birth time', value: profile.birth_time?.slice(0, 5) ?? null },
    { label: 'Birth place', value: profile.birth_place },
    { label: 'Rashi', value: profile.rashi },
    { label: 'Nakshatra', value: profile.nakshatra },
  ]
  const shown = tags.filter((tag) => tag.value)

  return (
    <div className="flex flex-col gap-5">
      {shown.length > 0 && (
        <ul className="flex gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {shown.map((tag) => (
            <li
              key={tag.label}
              className="shrink-0 rounded-full border border-[var(--color-border)] px-3 py-1 text-sm whitespace-nowrap"
            >
              <span className="text-[var(--color-text-muted)]">{tag.label}:</span> {tag.value}
            </li>
          ))}
        </ul>
      )}
      <Prose title="About me" text={profile.about_me} />
      <Prose title="About my family" text={profile.about_family} />
      <Prose title="What I'm looking for" text={profile.partner_expectations} />
    </div>
  )
}
