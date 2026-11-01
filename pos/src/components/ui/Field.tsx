import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { ChevronDown, Search } from 'lucide-react'
import { cn } from './cn'

const FIELD =
  'w-full rounded-xl border border-line bg-surface px-3.5 text-fg placeholder:text-fg-2/70 outline-none transition focus:border-gold focus:ring-4 focus:ring-gold/20 disabled:opacity-60 aria-[invalid=true]:border-danger'

interface FieldShellProps {
  label?: ReactNode
  hint?: ReactNode
  error?: ReactNode
  className?: string
  children: (id: string) => ReactNode
}

/** Label + control + hint/error. Keeps every form in the app visually identical. */
export function Field({ label, hint, error, className, children }: FieldShellProps) {
  const id = useId()
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      {label && <label htmlFor={id} className="text-sm font-medium text-fg">{label}</label>}
      {children(id)}
      {error ? <p role="alert" className="text-xs font-medium text-danger">{error}</p> : hint ? <p className="text-xs text-fg-2">{hint}</p> : null}
    </div>
  )
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean; big?: boolean }>(function Input(
  { className, invalid, big, ...rest },
  ref,
) {
  return <input ref={ref} aria-invalid={invalid || undefined} className={cn(FIELD, big ? 'h-14 text-lg' : 'h-11 text-base sm:text-sm', className)} {...rest} />
})

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={cn(FIELD, 'min-h-24 py-2.5 text-base sm:text-sm', className)} {...rest} />
})

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...rest }, ref) {
  return (
    <div className="relative">
      <select ref={ref} className={cn(FIELD, 'h-11 appearance-none pe-10 text-base sm:text-sm', className)} {...rest}>
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute end-3 top-1/2 size-4 -translate-y-1/2 text-fg-2" aria-hidden />
    </div>
  )
})

/** Search box with icon (used on every list screen). */
export const SearchInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { big?: boolean }>(function SearchInput(
  { className, big, ...rest },
  ref,
) {
  return (
    <label className={cn('flex items-center gap-2.5 rounded-xl border border-line bg-surface px-3.5 text-fg-2 transition focus-within:border-gold focus-within:ring-4 focus-within:ring-gold/20', big ? 'h-14' : 'h-11', className)}>
      <Search className="size-5 shrink-0" aria-hidden />
      <input ref={ref} type="search" className="min-w-0 flex-1 bg-transparent text-base text-fg outline-none placeholder:text-fg-2/70 sm:text-sm" {...rest} />
    </label>
  )
})
