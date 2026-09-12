import { useState } from 'react'
import { Avatar } from '../Avatar'
import { searchRegisteredMembers, type MemberCandidate } from '../../lib/familyDetails'

type EventInviteePickerProps = {
  /** Person ids already on the invite list (their Add button is disabled). */
  invitedIds: Set<string>
  /** The organiser's own person id -- can't invite yourself. */
  selfId: string
  onAdd: (candidate: MemberCandidate) => Promise<void>
}

/** Search registered members by name and add them one at a time. Simpler
 * than familyDetails' RelationSearchInput, which fills a form; here each
 * result just has an Add button. */
export function EventInviteePicker({ invitedIds, selfId, onAdd }: EventInviteePickerProps) {
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [results, setResults] = useState<MemberCandidate[] | null>(null)
  const [addingId, setAddingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleSearch() {
    if (query.trim().length < 3) {
      setError('Type at least 3 letters of the name to search.')
      setResults(null)
      return
    }
    setSearching(true)
    setError(null)
    try {
      setResults(await searchRegisteredMembers({ fullName: query.trim() }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed.')
    } finally {
      setSearching(false)
    }
  }

  async function handleAdd(candidate: MemberCandidate) {
    setAddingId(candidate.id)
    setError(null)
    try {
      await onAdd(candidate)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add this person.')
    } finally {
      setAddingId(null)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <div className="flex-1 flex items-center rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] focus-within:border-[var(--color-accent)]">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                handleSearch()
              }
            }}
            placeholder="Search members by name…"
            aria-label="Search members to invite"
            className="flex-1 min-w-0 bg-transparent px-3 py-2.5 outline-none"
          />
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

      {error && <p className="text-sm text-[var(--color-accent)]">{error}</p>}

      {results && (
        <ul className="flex flex-col rounded-lg border border-[var(--color-border)] overflow-hidden">
          {results.length === 0 && (
            <li className="px-3 py-2 text-sm text-[var(--color-text-muted)]">
              No registered members matched.
            </li>
          )}
          {results.map((candidate) => {
            const isSelf = candidate.id === selfId
            const already = invitedIds.has(candidate.id)
            return (
              <li
                key={candidate.id}
                className="flex items-center gap-3 px-3 py-2 border-b border-[var(--color-border)] last:border-b-0"
              >
                <Avatar name={candidate.full_name} size={32} />
                <span className="flex-1 min-w-0 flex flex-col">
                  <span className="text-sm font-medium truncate">{candidate.full_name}</span>
                  <span className="text-xs text-[var(--color-text-muted)] truncate">
                    {[candidate.current_city, candidate.native_place].filter(Boolean).join(' · ') ||
                      'No further details'}{' '}
                    · {candidate.member_code}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => handleAdd(candidate)}
                  disabled={isSelf || already || addingId === candidate.id}
                  className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-text-muted)] disabled:opacity-60 transition-colors"
                >
                  {isSelf ? 'You' : already ? 'Invited' : addingId === candidate.id ? 'Adding…' : 'Add'}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
