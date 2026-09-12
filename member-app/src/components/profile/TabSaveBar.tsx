import type { TabSaveState } from './tabTypes'

type TabSaveBarProps = {
  state: TabSaveState
  onSave: () => void
}

/** Error / "Saved." line plus the accent Save button, shared by every
 * person-backed Profile tab. */
export function TabSaveBar({ state, onSave }: TabSaveBarProps) {
  return (
    <div className="flex flex-col gap-3">
      {state.error && <p className="text-sm text-[var(--color-accent)]">{state.error}</p>}
      {state.saved && !state.error && (
        <p className="text-sm text-[var(--color-text-muted)]">Saved.</p>
      )}
      <button
        type="button"
        onClick={onSave}
        disabled={state.saving}
        className="self-start rounded-lg bg-[var(--color-accent)] text-white font-medium py-2.5 px-6 hover:bg-[var(--color-accent-hover)] disabled:opacity-60 transition-colors"
      >
        {state.saving ? 'Saving…' : 'Save changes'}
      </button>
    </div>
  )
}
