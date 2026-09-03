import { useState } from 'react'
import { TextField } from '../form/TextField'
import { searchRegisteredMembers, type MemberCandidate } from '../../lib/familyDetails'

type RelationSearchInputProps = {
  name: string
  memberCode: string
  onNameChange: (value: string) => void
  onMemberCodeChange: (value: string) => void
  gotraHint?: string
  nativePlaceHint?: string
  /** Called after a search completes, with whatever it found (possibly
   * empty) -- lets the parent know when it's safe to offer "Invite". */
  onSearched?: (results: MemberCandidate[]) => void
}

/** Name + member-ID inputs with a "search registered members" affordance.
 * Selecting a search result fills both fields from that person's real
 * record; the member-ID field can also just be typed by hand. */
export function RelationSearchInput({
  name,
  memberCode,
  onNameChange,
  onMemberCodeChange,
  gotraHint,
  nativePlaceHint,
  onSearched,
}: RelationSearchInputProps) {
  const [searching, setSearching] = useState(false)
  const [results, setResults] = useState<MemberCandidate[] | null>(null)
  const [searchError, setSearchError] = useState<string | null>(null)

  async function handleSearch() {
    if (name.trim().length < 3) {
      setSearchError('Type at least 3 letters of the name to search.')
      setResults(null)
      return
    }

    setSearching(true)
    setSearchError(null)
    try {
      const found = await searchRegisteredMembers({
        fullName: name.trim(),
        gotra: gotraHint,
        nativePlace: nativePlaceHint,
      })
      setResults(found)
      onSearched?.(found)
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : 'Search failed.')
    } finally {
      setSearching(false)
    }
  }

  function handleSelect(candidate: MemberCandidate) {
    onNameChange(candidate.full_name)
    onMemberCodeChange(candidate.member_code)
    setResults(null)
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <TextField label="Name" value={name} onChange={onNameChange} />
        </div>
        <button
          type="button"
          onClick={handleSearch}
          disabled={searching}
          className="rounded-lg border border-[var(--color-border)] px-3 py-2.5 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-text-muted)] disabled:opacity-60 transition-colors"
        >
          {searching ? 'Searching…' : 'Search'}
        </button>
      </div>

      {searchError && <p className="text-sm text-[var(--color-accent)]">{searchError}</p>}

      {results && (
        <div className="flex flex-col gap-1 rounded-lg border border-[var(--color-border)] overflow-hidden">
          {results.length === 0 && (
            <p className="px-3 py-2 text-sm text-[var(--color-text-muted)]">
              No registered members matched. You can still enter this person as plain text below.
            </p>
          )}
          {results.map((candidate) => (
            <button
              key={candidate.id}
              type="button"
              onClick={() => handleSelect(candidate)}
              className="w-full text-left px-3 py-2 hover:bg-[var(--color-surface-hover)] transition-colors border-b border-[var(--color-border)] last:border-b-0"
            >
              <p className="text-sm font-medium">{candidate.full_name}</p>
              <p className="text-xs text-[var(--color-text-muted)]">
                {[candidate.gotra, candidate.native_place, candidate.current_city]
                  .filter(Boolean)
                  .join(' · ') || 'No further details'}{' '}
                · {candidate.member_code}
              </p>
            </button>
          ))}
        </div>
      )}

      <TextField
        label="Member ID (if known)"
        value={memberCode}
        onChange={onMemberCodeChange}
        placeholder="e.g. KHA-RJ-4578"
      />
    </div>
  )
}
