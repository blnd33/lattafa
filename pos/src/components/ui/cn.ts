import clsx, { type ClassValue } from 'clsx'

/** Tiny className joiner (clsx). Later classes are simply appended. */
export const cn = (...v: ClassValue[]): string => clsx(v)
