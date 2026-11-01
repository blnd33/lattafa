import { core } from './locales/ar/core'
import { admin } from './locales/ar/admin'
import { delegate } from './locales/ar/delegate'
import { sheet } from './locales/ar/sheet'
import { panel } from './locales/ar/panel'
import { buy } from './locales/ar/buy'
import { reports } from './locales/ar/reports'
import { menu } from './locales/ar/menu'
import { audit } from './locales/ar/audit'

export const ar: Record<string, string> = { ...core, ...admin, ...delegate, ...sheet, ...panel, ...buy, ...reports, ...menu, ...audit }
