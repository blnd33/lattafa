// Copies the built web apps (dist/) into backend/public/ so Laravel serves menu, POS, delegate and the API on one domain.
// Only the folders/files the web build owns are replaced; Laravel's own public files (index.php, storage link…) are untouched.
import { cpSync, existsSync, readdirSync, rmSync } from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const dist = path.join(root, 'dist')
const pub = path.join(root, 'backend', 'public')

if (!existsSync(path.join(dist, 'pos', 'index.html'))) {
  console.error('dist/ is missing or incomplete — run `npm run build` first.')
  process.exit(1)
}

const OWNED = ['pos', 'delegate', 'menu', 'admin', 'assets', 'icons', 'sw.js', 'logo.png', 'favicon.png', 'pos.webmanifest', 'delegate.webmanifest']
const isWorkbox = (f) => /^workbox-.*\.js$/.test(f)

for (const name of [...OWNED, ...readdirSync(pub).filter(isWorkbox)]) {
  rmSync(path.join(pub, name), { recursive: true, force: true })
}
for (const name of readdirSync(dist)) {
  cpSync(path.join(dist, name), path.join(pub, name), { recursive: true })
}
console.log(`Published ${readdirSync(dist).length} items from dist/ to backend/public/`)
