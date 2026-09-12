import { TextField } from '../form/TextField'
import { TabSaveBar } from './TabSaveBar'
import type { PersonTabProps } from './tabTypes'

export function CulturalTab({ value, onChange, saveState, onSave }: PersonTabProps) {
  return (
    <div className="w-full flex flex-col gap-4">
      <TextField
        label="Gotra"
        required
        value={value.gotra}
        onChange={(v) => onChange({ gotra: v })}
      />
      <TextField
        label="Native place (Rajasthan)"
        required
        value={value.native_place}
        onChange={(v) => onChange({ native_place: v })}
      />
      <TextField
        label="Birth place"
        value={value.birth_place}
        onChange={(v) => onChange({ birth_place: v })}
        placeholder="e.g. Jaipur"
      />
      <TabSaveBar state={saveState} onSave={onSave} />
    </div>
  )
}
