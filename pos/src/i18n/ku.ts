import { core } from './locales/ku/core'
import { admin } from './locales/ku/admin'
import { delegate } from './locales/ku/delegate'
import { sheet } from './locales/ku/sheet'
import { panel } from './locales/ku/panel'
import { buy } from './locales/ku/buy'
import { reports } from './locales/ku/reports'
import { menu } from './locales/ku/menu'
import { audit } from './locales/ku/audit'

export const ku: Record<string, string> = { ...core, ...admin, ...delegate, ...sheet, ...panel, ...buy, ...reports, ...menu, ...audit }
