import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import '@/styles/index.css'
import { reloadOnStaleBuild } from '@/lib/staleBuild'
import { DelegateApp } from './App'

// Installable and offline: the service worker keeps the app on the phone; the delegate's work waits in IndexedDB.
registerSW({ immediate: true })
reloadOnStaleBuild()
void navigator.storage?.persist?.()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DelegateApp />
  </StrictMode>,
)
