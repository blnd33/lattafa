/*
 * Notifications that arrive with the app closed. Loaded into the service worker (vite.config.ts → importScripts),
 * so it stays a plain script: no imports, no build step.
 *
 * A message is {title, body, url, tag}. Tapping it opens the app at `url` — or focuses the tab already showing it.
 */
/* global self, clients */

self.addEventListener('push', (event) => {
  let msg = {}
  try { msg = event.data ? event.data.json() : {} } catch { /* a push with no body still rings */ }
  const title = msg.title || 'Lattafa'
  event.waitUntil(self.registration.showNotification(title, {
    body: msg.body || '',
    tag: msg.tag || 'lattafa',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    lang: 'en',
    renotify: true,
    data: { url: msg.url || '/delegate/' },
  }))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/delegate/'
  event.waitUntil((async () => {
    const open = await clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const c of open) {
      // already open somewhere: bring that one forward instead of piling up windows
      if (c.url.includes(url.split('#')[0]) && 'focus' in c) { await c.focus(); if ('navigate' in c) await c.navigate(url); return }
    }
    if (clients.openWindow) await clients.openWindow(url)
  })())
})
