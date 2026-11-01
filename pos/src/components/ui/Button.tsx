import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from './cn'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'outline' | 'danger' | 'dark'
export type ButtonSize = 'sm' | 'md' | 'lg' | 'xl'

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-gradient-to-b from-gold to-gold-dark text-ink shadow-[0_8px_20px_rgba(184,137,47,.28)] hover:brightness-105',
  secondary: 'bg-surface-2 text-fg hover:bg-gold-soft dark:hover:bg-charcoal',
  ghost: 'text-fg hover:bg-surface-2',
  outline: 'border border-line text-fg hover:border-gold bg-transparent',
  danger: 'bg-danger text-white hover:brightness-110',
  dark: 'bg-ink text-gold-light hover:bg-charcoal dark:bg-gold dark:text-ink dark:hover:brightness-105',
}
const SIZES: Record<ButtonSize, string> = {
  sm: 'h-9 px-3 text-sm rounded-lg',
  md: 'h-11 px-4 text-sm rounded-xl',
  lg: 'h-12 px-5 text-base rounded-xl',
  xl: 'h-14 px-6 text-lg rounded-2xl',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  icon?: ReactNode
  iconEnd?: ReactNode
  block?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading, icon, iconEnd, block, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cn(
        'inline-flex select-none items-center justify-center gap-2 whitespace-nowrap font-semibold transition active:scale-[.98] disabled:pointer-events-none disabled:opacity-45',
        VARIANTS[variant], SIZES[size], block && 'w-full', className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="size-5 animate-spin" aria-hidden /> : icon}
      {children}
      {iconEnd}
    </button>
  )
})

/** Square icon-only button — always ≥ 44px so it works with a finger. */
export const IconButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { label: string; variant?: ButtonVariant; size?: 'sm' | 'md' | 'lg' }>(function IconButton(
  { label, variant = 'secondary', size = 'md', className, children, type = 'button', ...rest },
  ref,
) {
  const s = size === 'sm' ? 'size-9 rounded-lg' : size === 'lg' ? 'size-14 rounded-2xl' : 'size-11 rounded-xl'
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      className={cn('inline-flex shrink-0 select-none items-center justify-center transition active:scale-95 disabled:pointer-events-none disabled:opacity-45', VARIANTS[variant], s, className)}
      {...rest}
    >
      {children}
    </button>
  )
})
