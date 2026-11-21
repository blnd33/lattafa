import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@/styles/index.css'
import { reloadOnStaleBuild } from '@/lib/staleBuild'
import { CatalogueApp } from './CatalogueApp'

// Like the customer menu, the wholesale catalogue is a plain web page: no service worker and no offline copy, so an
// international buyer on a slow connection downloads as little as possible and always sees today's collection.
// A page left open across a release reloads instead of going blank.
reloadOnStaleBuild()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <CatalogueApp />
  </StrictMode>,
)
