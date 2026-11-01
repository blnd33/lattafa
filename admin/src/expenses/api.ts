import { api } from '@/services/api'
import type { Currency } from '../money'

/** The server's expenses API — see backend/app/Services/ExpenseService.php. */
export const EXPENSE_CATEGORIES = ['rent', 'salaries', 'electricity', 'internet', 'transport', 'marketing', 'packaging', 'maintenance', 'food', 'fees', 'other'] as const
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number]

export interface Expense {
  id: string
  category: ExpenseCategory
  amount: number
  currency: Currency
  rate: number
  amountIQD: number
  method: string
  note: string
  spentAt: number
  userId: string | null
  userName: string
}

export interface ExpenseList {
  from: number
  to: number
  expenses: Expense[]
  totalIQD: number
  byCategory: { category: ExpenseCategory; amountIQD: number; count: number }[]
  /** delegates' road expenses from approved daily closings, in the same window */
  delegateIQD: number
}

export interface ExpenseInput { category: ExpenseCategory; amount: number; currency: Currency; rate?: number; method: string; note: string; spentAt: number }

export const listExpenses = (from: number, to: number) => api<ExpenseList>('GET', `/expenses?from=${from}&to=${to}`)
export const saveExpense = async (input: ExpenseInput, id?: string) => (await api<{ expense: Expense }>(id ? 'PUT' : 'POST', id ? `/expenses/${id}` : '/expenses', input)).expense
export const deleteExpense = async (id: string) => { await api('DELETE', `/expenses/${id}`) }

/** First and last millisecond of a calendar month, in this computer's time (the shop's). */
export function monthRange(year: number, month: number): [number, number] {
  return [new Date(year, month, 1).getTime(), new Date(year, month + 1, 1).getTime() - 1]
}
