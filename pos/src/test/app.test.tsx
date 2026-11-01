// @vitest-environment jsdom
/**
 * End-to-end scenario through the real UI (jsdom + fake IndexedDB):
 *   first-run setup → Super Admin signs in → sells a perfume with cash straight away (no shift needed) →
 *   creates a cashier account → cashier signs in with a PIN → sees only what the role allows.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App } from '@/App'
import { db } from '@/data/db'
import { useSession } from '@/store/session'
import { useCart } from '@/store/cart'
import { useUI } from '@/store/ui'
import { setActor } from '@/services/context'

const user = userEvent.setup({ delay: null })
const wait = { timeout: 15000 }

afterEach(() => cleanup())

async function pressPin(pin: string) {
  for (const d of pin) await user.click(screen.getByRole('button', { name: d }))
  await user.click(screen.getByRole('button', { name: 'OK' }))
}

describe('Store POS — full scenario in the DOM', () => {
  it('setup → sale → create cashier → cashier is restricted', async () => {
    await db.delete(); await db.open()
    localStorage.clear(); setActor(null)
    useSession.setState({ actor: null, locked: false, lastUserId: null })
    useCart.getState().clear(); useUI.setState({ lang: 'en', theme: 'light' })
    window.location.hash = ''

    render(<App />)

    /* ---------- first-run wizard ---------- */
    expect(await screen.findByText('Set up your shop', {}, wait)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^Next$/ }))
    await user.type(screen.getByLabelText('Your full name'), 'Rand Owner')
    await user.type(screen.getByLabelText('Username'), 'owner')
    await user.type(screen.getByLabelText('Password'), 'Owner1234')
    await user.type(screen.getByLabelText('Repeat password'), 'Owner1234')
    await user.type(screen.getByLabelText('PIN'), '1111')
    await user.type(screen.getByLabelText('Repeat PIN'), '1111')
    await user.click(screen.getByRole('button', { name: /^Next$/ }))
    await user.click(screen.getByRole('button', { name: /Finish setup/ }))

    /* ---------- signed in as Super Admin, straight to selling: no shift to open ---------- */
    expect(await screen.findByRole('button', { name: 'Add Asad 100 ml' }, wait)).toBeInTheDocument()
    expect(screen.queryByText('Open your shift to start selling')).not.toBeInTheDocument()
    expect(screen.queryByText('No shift')).not.toBeInTheDocument()
    expect(screen.getAllByText('Super Admin').length).toBeGreaterThan(0)
    // the Super Admin sees every management area in the navigation
    const nav = screen.getByRole('navigation', { name: 'Main' })
    for (const label of ['Sell', 'Sales', 'Customers', 'Shift', 'Products', 'Inventory', 'Reports', 'Users', 'Settings']) expect(within(nav).getByText(label)).toBeInTheDocument()

    /* ---------- sell a perfume, pay cash, get a receipt ---------- */
    await user.click(screen.getByRole('button', { name: 'Add Asad 100 ml' }))
    const bill = screen.getByRole('region', { name: 'Current sale' })
    expect(within(bill).getByText('Asad')).toBeInTheDocument()
    await user.click(within(bill).getByRole('button', { name: /^Pay/ }))
    const pay = await screen.findByRole('dialog', {}, wait)
    await user.click(within(pay).getByRole('button', { name: '45,000' })) // customer hands over 45,000 for a 42,000 bill
    await user.click(within(pay).getByRole('button', { name: 'Add payment' }))
    expect(within(pay).getAllByText('3,000').length).toBeGreaterThan(0) // change to give back
    await user.click(within(pay).getByRole('button', { name: 'Complete sale' }))
    expect(await screen.findByText('Sale completed', { selector: 'div' }, wait)).toBeInTheDocument()
    expect(await db.sales.count()).toBe(1)
    expect((await db.sales.toArray())[0].changeIQD).toBe(3000)
    await user.click(screen.getByRole('button', { name: /New sale/ }))

    /* ---------- Super Admin creates a cashier account ---------- */
    await user.click(within(nav).getByText('Users'))
    await user.click(await screen.findByRole('button', { name: /New account/ }, wait))
    const editor = await screen.findByRole('dialog', {}, wait)
    await user.type(within(editor).getByLabelText('Name'), 'Nora Cashier')
    await user.type(within(editor).getByLabelText('Username'), 'nora')
    await user.type(within(editor).getByLabelText('PIN'), '2222')
    await user.click(within(editor).getByRole('button', { name: 'Save' }))
    await waitFor(async () => expect(await db.users.count()).toBe(2), wait)
    expect(await screen.findByText('Nora Cashier', {}, wait)).toBeInTheDocument()
    const nora = (await db.users.where('username').equals('nora').first())!
    const cashierRole = (await db.roles.where('key').equals('cashier').first())!
    expect(nora.roleId).toBe(cashierRole.id) // defaults to the Cashier role

    /* ---------- cashier signs in with the PIN ---------- */
    await user.click(screen.getByRole('button', { name: 'Rand Owner' })) // user menu
    await user.click(await screen.findByRole('button', { name: 'Sign out' }, wait))
    await user.click(await screen.findByRole('button', { name: /Nora Cashier/ }, wait))
    await pressPin('2222')

    // a cashier's navigation has no management areas…
    const nav2 = await screen.findByRole('navigation', { name: 'Main' }, wait)
    for (const label of ['Sell', 'Sales', 'Customers', 'Shift']) expect(within(nav2).getByText(label)).toBeInTheDocument()
    for (const label of ['Products', 'Inventory', 'Reports', 'Users', 'Settings']) expect(within(nav2).queryByText(label)).not.toBeInTheDocument()
    // …and typing the address by hand is blocked too
    window.location.hash = '#/users'
    expect(await screen.findByText('No access', {}, wait)).toBeInTheDocument()
    window.location.hash = '#/settings'
    await waitFor(() => expect(screen.getByText('No access')).toBeInTheDocument())
  }, 120000)

  it('switches to Arabic: right-to-left layout and translated UI', async () => {
    useSession.setState({ actor: null, locked: false })
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'عربي' }, wait))
    await waitFor(() => expect(document.documentElement.dir).toBe('rtl'))
    expect(document.documentElement.lang).toBe('ar')
    expect(await screen.findByText('اختر اسمك للبدء', {}, wait)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'کوردی' }))
    await waitFor(() => expect(document.documentElement.lang).toBe('ckb'))
    expect(document.documentElement.dir).toBe('rtl')
    await user.click(screen.getByRole('button', { name: 'EN' }))
    await waitFor(() => expect(document.documentElement.dir).toBe('ltr'))
  }, 60000)
})
