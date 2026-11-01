import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import '@/styles/index.css'
import { reloadOnStaleBuild } from '@/lib/staleBuild'
import { setServerMode } from '@/services/mode'
import { AdminApp } from './App'

// The admin panel always works against the shop server (it has no offline mode and is never a till). Its local copy of
// the shop data lives in its own database, apart from the POS — see @/data/app.
setServerMode(true)
registerSW({ immediate: true })
reloadOnStaleBuild()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AdminApp />
  </StrictMode>,
)
