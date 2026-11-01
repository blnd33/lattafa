// Browser-API shims for the jsdom tests (jsdom has no matchMedia / scrollIntoView / print).
import '@testing-library/jest-dom/vitest'

if (typeof window !== 'undefined') {
  const WIDTH = 1280 // pretend to be a desktop till
  window.matchMedia = ((query: string) => {
    const min = /min-width:\s*(\d+)px/.exec(query)
    const matches = min ? WIDTH >= Number(min[1]) : /hover:\s*hover/.test(query)
    return {
      matches, media: query, onchange: null,
      addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
    } as MediaQueryList
  }) as typeof window.matchMedia
  Element.prototype.scrollIntoView = () => {}
  window.print = () => {}
  window.scrollTo = () => {}
}
