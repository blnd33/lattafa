import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@/styles/index.css'
import { reloadOnStaleBuild } from '@/lib/staleBuild'
import { useUI } from '@/store/ui'
import { isPreview } from './api'
import { MenuApp } from './MenuApp'

// Inside the admin panel's live preview, switching the language there must not change the visitor's saved choice.
if (isPreview()) useUI.persist.setOptions({ storage: { getItem: () => null, setItem: () => {}, removeItem: () => {} } })

// a menu left open on a phone across an update reloads instead of going blank
reloadOnStaleBuild()

// The public menu is a plain web page: no service worker, no sign-in, nothing stored but the last menu it showed.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MenuApp />
  </StrictMode>,
)
