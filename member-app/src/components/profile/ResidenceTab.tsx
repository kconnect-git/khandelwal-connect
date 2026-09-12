import { TextField } from '../form/TextField'
import { SelectField } from '../form/SelectField'
import { TabSaveBar } from './TabSaveBar'
import type { PersonTabProps } from './tabTypes'
import { INDIAN_STATE_OPTIONS, STATE_CODE_BY_NAME } from '../../lib/formOptions'

export function ResidenceTab({ value, onChange, saveState, onSave }: PersonTabProps) {
  return (
    <div className="w-full flex flex-col gap-4">
      <TextField
        label="Address line 1"
        required
        value={value.home_address}
        onChange={(v) => onChange({ home_address: v })}
      />
      <TextField
        label="Address line 2"
        value={value.address_line2}
        onChange={(v) => onChange({ address_line2: v })}
      />
      <TextField
        label="Address line 3"
        value={value.address_line3}
        onChange={(v) => onChange({ address_line3: v })}
      />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <TextField
          label="City"
          required
          value={value.current_city}
          onChange={(v) => onChange({ current_city: v })}
        />
        <TextField
          label="District"
          required
          value={value.current_district}
          onChange={(v) => onChange({ current_district: v })}
        />
        <SelectField
          label="State"
          required
          value={value.current_state}
          onChange={(v) => onChange({ current_state: v, state_code: STATE_CODE_BY_NAME[v] ?? '' })}
          options={INDIAN_STATE_OPTIONS}
        />
        <TextField
          label="PIN code"
          type="tel"
          maxLength={6}
          value={value.pincode}
          onChange={(v) => onChange({ pincode: v.replace(/\D/g, '').slice(0, 6) })}
          placeholder="302001"
        />
      </div>
      <TextField
        label="Residence phone"
        type="tel"
        value={value.residence_phone}
        onChange={(v) => onChange({ residence_phone: v })}
        placeholder="e.g. 0141 2345678"
      />
      <TabSaveBar state={saveState} onSave={onSave} />
    </div>
  )
}
