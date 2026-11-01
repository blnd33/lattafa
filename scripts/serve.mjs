// The Lattafa system on one local address per app:
//   node scripts/serve.mjs all        → all four at once:
//                                        http://localhost:8001  customer menu
//                                        http://localhost:8002  store POS
//                                        http://localhost:8003  delegate app
//                                        http://localhost:8004  admin panel
//   node scripts/serve.mjs pos [port]  → just one of them
// Every address is the same Laravel backend and the same database (backend/.env), so the apps stay connected, and each
// is told where the others are, so they link to each other (admin → POS, POS → admin panel, …). Each address keeps its
// own sign-in and offline copy in the browser (a different origin). Build the apps first: `npm run build:backend`.
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PORTS = { menu: 8001, pos: 8002, delegate: 8003, admin: 8004 }
const APPS = Object.keys(PORTS)
const [which = 'all', portArg] = process.argv.slice(2)
if (which !== 'all' && !APPS.includes(which)) usage()
if (portArg !== undefined && (which === 'all' || !/^\d{2,5}$/.test(portArg))) usage()

const backend = fileURLToPath(new URL('../backend/', import.meta.url))
const router = join(backend, 'vendor/laravel/framework/src/Illuminate/Foundation/resources/server.php')
const ports = { ...PORTS, ...(portArg ? { [which]: Number(portArg) } : {}) }
const addr = (app) => `http://localhost:${ports[app]}`
// every server knows every app's address, so the links between them go to the right place
const addresses = { MENU_URL: `${addr('menu')}/`, POS_URL: `${addr('pos')}/`, DELEGATE_URL: `${addr('delegate')}/`, ADMIN_URL: `${addr('admin')}/` }

const children = []
for (const app of which === 'all' ? APPS : [which]) {
  if (!existsSync(join(backend, 'public', app, 'index.html'))) {
    console.error(`The ${app} app is not built yet: run \`npm run build:backend\` in the project root first.`)
    process.exit(1)
  }
  // `php artisan serve` doesn't pass settings like these on to its server, so PHP's own server is started directly.
  const child = spawn('php', ['-S', `127.0.0.1:${ports[app]}`, router], {
    cwd: join(backend, 'public'),
    // APP_HOME = what opens at "/"; APP_URL = this address (product photos are linked from it)
    env: { ...process.env, ...addresses, APP_HOME: app, APP_URL: addr(app) },
    stdio: 'inherit',
  })
  child.on('exit', (code) => { children.forEach((c) => c !== child && c.kill()); process.exit(code ?? 0) })
  children.push(child)
  console.log(`Lattafa ${app.padEnd(8)} → ${addr(app)}`)
}
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => children.forEach((c) => c.kill()))

function usage() {
  console.error(`usage: node scripts/serve.mjs all   |   node scripts/serve.mjs <${APPS.join('|')}> [port]`)
  process.exit(1)
}
