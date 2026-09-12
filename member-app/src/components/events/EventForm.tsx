import { TextField } from '../form/TextField'
import { SelectField } from '../form/SelectField'
import { EVENT_VISIBILITY_OPTIONS, INDIAN_STATE_OPTIONS } from '../../lib/formOptions'
import type { EventFormValues } from '../../lib/events'
import type { EventVisibility } from '../../types/database'

type EventFormProps = {
  value: EventFormValues
  onChange: (value: EventFormValues) => void
  /** Approved events: everything but the description is read-only (the
   * server ignores the other fields anyway -- see update_event, 0018). */
  locked?: boolean
}

function SubHeading({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-widest text-[var(--color-text-muted)] mt-1">
      {children}
    </p>
  )
}

/** Controlled, fields only -- validation and saving live in the caller
 * (same shape as BusinessForm). */
export function EventForm({ value, onChange, locked = false }: EventFormProps) {
  function patch(partial: Partial<EventFormValues>) {
    onChange({ ...value, ...partial })
  }

  return (
    <div className="flex flex-col gap-4">
      <SubHeading>Basics</SubHeading>
      <TextField
        label="Title"
        value={value.title}
        onChange={(title) => patch({ title })}
        required
        maxLength={120}
        disabled={locked}
      />
      <label className="flex flex-col gap-1.5">
        <span className="text-sm text-[var(--color-text-muted)]">Description</span>
        <textarea
          value={value.description}
          onChange={(e) => patch({ description: e.target.value })}
          rows={4}
          maxLength={2000}
          placeholder="What is the event, who is it for, anything guests should know…"
          className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5 outline-none focus:border-[var(--color-accent)] resize-y"
        />
      </label>

      <SubHeading>When</SubHeading>
      <TextField
        label="Starts"
        type="datetime-local"
        value={value.starts_at}
        onChange={(starts_at) => patch({ starts_at })}
        required
        disabled={locked}
      />
      <TextField
        label="Ends (optional)"
        type="datetime-local"
        value={value.ends_at}
        onChange={(ends_at) => patch({ ends_at })}
        min={value.starts_at || undefined}
        disabled={locked}
      />

      <SubHeading>Where</SubHeading>
      <TextField
        label="Venue"
        value={value.venue}
        onChange={(venue) => patch({ venue })}
        placeholder="Hall, address or landmark"
        maxLength={200}
        disabled={locked}
      />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <TextField
          label="City"
          value={value.city}
          onChange={(city) => patch({ city })}
          disabled={locked}
        />
        <SelectField
          label="State"
          value={value.state}
          onChange={(state) => patch({ state })}
          options={[{ value: '', label: 'Select…' }, ...INDIAN_STATE_OPTIONS]}
          disabled={locked}
        />
      </div>

      <SubHeading>Guests</SubHeading>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <TextField
          label="Capacity (optional)"
          value={value.capacity}
          onChange={(capacity) => patch({ capacity: capacity.replace(/\D/g, '') })}
          placeholder="Leave blank for no limit"
          disabled={locked}
        />
        <SelectField
          label="Who can see it"
          value={value.visibility}
          onChange={(visibility) => patch({ visibility: visibility as EventVisibility })}
          options={EVENT_VISIBILITY_OPTIONS}
          disabled={locked}
        />
      </div>
      {value.visibility === 'invite_only' && !locked && (
        <p className="text-sm text-[var(--color-text-muted)]">
          Only people you invite will see this event. You can add invitees once an admin has
          approved it.
        </p>
      )}
    </div>
  )
}
