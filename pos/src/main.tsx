import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import { App } from './App'
import { reloadOnStaleBuild } from './lib/staleBuild'
import './styles/index.css'

// Offline support: the service worker caches the app shell; new versions install silently.
registerSW({ immediate: true })
reloadOnStaleBuild()

// Ask the browser not to evict our IndexedDB (sales queue!) under storage pressure.
void navigator.storage?.persist?.()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
