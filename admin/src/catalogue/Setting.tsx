import { Checkbox, Switch } from '@/components/ui/Controls'

/**
 * A switch or a tick with words beside it.
 *
 * The shared `Switch` and `Checkbox` carry their label as an aria-label and draw nothing — they were built for the
 * permissions matrix, where the row already says what the tick means. On a settings card there is no row to read,
 * so the words go here. They are `aria-hidden`: the control already announces itself, and saying it twice is worse
 * than not saying it at all.
 */
export function Setting({ checked, onChange, label, hint, disabled, kind = 'switch' }: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  hint?: string
  disabled?: boolean
  kind?: 'switch' | 'check'
}) {
  return (
    <div className="flex items-start gap-3">
      {kind === 'switch'
        ? <Switch checked={checked} onChange={onChange} label={label} disabled={disabled} />
        : <Checkbox checked={checked} onChange={onChange} label={label} disabled={disabled} />}
      <span aria-hidden className="min-w-0 text-sm leading-6">
        {label}
        {hint && <span className="block text-xs leading-5 text-fg-2">{hint}</span>}
      </span>
    </div>
  )
}
