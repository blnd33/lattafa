# Three channels, three stocks

**Asked for, 22 November 2026:** the catalogue gets unlimited stock, the delegate app gets an inventory of its own,
new perfumes reach every channel automatically, and the prices are in dollars.

This is written before any code is changed, because one part of it reverses a decision made on 31 October and
another throws away machinery that went live yesterday. Both are worth seeing before they happen.

---

## 1 · What was answered

| Question | Answer |
|---|---|
| A shop in Türkiye opens the catalogue and you have 10 bottles | **No limit** — it can order any amount; you decide when the order reaches you |
| You buy 300 bottles | **All to the shop**, then you move some to the catalogue or a delegate |
| You approve an order for 500 and have 10 | **Nothing** — the shelf stays 10; you order from the supplier and ship |
| New perfumes | Added once, in Products, and they appear in the catalogue and the delegate app by themselves |

Everything below follows from those four.

---

## 2 · The product list stays one list

Nothing to build. Products is already the single source: the catalogue and the delegate app both read it, and a
perfume added there is already in both the next time they load. "Different items per channel" is then just a
matter of what each channel holds or shows, not a second catalogue of perfumes to keep in step.

The catalogue already has its own per-perfume switch (**hidden**), so a perfume can be kept out of it without
touching the till.

---

## 3 · The catalogue: no stock at all

Today the catalogue is wired to the shop's shelf. That was the whole point of §36 of the brief, and it is what
shipped yesterday. Unlimited stock removes it:

**Goes:**

* `Inventory::available()` — the one place holds were subtracted from the shelf
* reservations: `wholesale_reservations`, `wholesale_reservation_items`, and the row locking around them
* the `out_of_stock` refusal, in the quote and at checkout
* "held for 3 days", the **Release hold** button, and the held-stock column in Orders
* stock deduction on approval — approving becomes a decision, not a stock movement

**Stays:**

* every price rule — minimum order, smallest quantity, quantity steps, agreed prices and discounts
* approve / refuse / cancel, the status history, and the payment track

**What a buyer sees:** no "In stock" or "Out of stock" anywhere, and no quantity cap. They order what they want.

### What this costs, said plainly

Two things you have today stop being true, and neither is a reason not to do it — just worth knowing:

1. **Approving an order will no longer tell you whether you can fill it.** Today the catalogue cannot accept an
   order for more than you hold. After this it can, and the check is yours.
2. **Wholesale sales will not appear in your stock figures.** Bottles shipped abroad leave the shelf without the
   system knowing, so stock value and "what did I sell" reports cover the shop and the delegates, not the
   catalogue — unless you record the bottles leaving separately.

If either of those turns out to matter, the middle answer from the question — *the catalogue gets its own number,
e.g. 200, kept apart from the shop's* — gives you both back without tying the catalogue to the shop's shelf. It is
roughly the same amount of work. Say so and I will build that instead.

---

## 4 · The delegate app: its own van stock again

**This reverses what you asked for on 31 October.** Then you said, in so many words: *"only the stock — the stock
will be the same as the pos — 12 on pos, delegate sells 2, both 10"*, and that is what was built: a delegate sells
the shop's stock, and a sale deducts from `loc-store` like a till sale.

What you are asking for now is the older design, which is still in the code and switched off: every delegate has a
van (`van:<user id>`), a manager loads it from the shop, and a sale deducts from the van rather than the shelf.

**To re-enable it:**

* delegate sales deduct from `van:<delegate>` instead of `loc-store` (`SaleService` line 391)
* the delegate's phone goes back to carrying its van's stock, which `delegate/src/data.ts` still has the table for
* **Load van** and **Unload van** come back to the admin panel — the transfers themselves still work
* a delegate sees only what is in their van; an empty van sells nothing
* stock requests, already built and unused, become useful again

> **Built, 22 November.** Confirmed and done. A delegate sale now deducts from `van:<their id>` (`SaleService`),
> and the phone asks for its own van with `GET /sync/pull?stock=van` — the *app* says which stock it wants, not
> the device, because one laptop can be registered as both a till and a phone and the owner account is a delegate
> as well as a cashier. The van is still worked out from who is asking, so the parameter says which stock, never
> whose. Voids and returns needed no change: they already put bottles back wherever the sale took them from.
>
> Admin panel → Delegates → **Van** shows what each is carrying, what it is worth, and loads or unloads it.
>
> The four tests that pinned the October behaviour were rewritten, one of them named for it. 360 backend tests
> pass on PostgreSQL and SQLite, 252 on the front end.
>
> **Remember:** the delegates' vans are empty until somebody loads them. Nobody can sell anything on the road
> until that is done.

---

## 5 · Prices are already in dollars

Both channels already price in whole US cents, and neither uses the dinar:

* **delegate** — `variants.wholesale_usd_cents`, edited in Admin → Delegates → **Prices**, with Excel out and back
* **catalogue** — the same dollar list underneath, with a country's price on top of it, and a particular
  business's agreed price or percentage on top of that

So "the prices will be by dollars" is already true. If what is wanted is a *third* list — a delegate price that
differs from the catalogue's dollar price for the same bottle — that is a small addition, and worth saying.

---

## 6 · What it comes to

| | Work | Estimate |
|---|---|---|
| 1 | Catalogue: unlimited stock, reservations removed, orders and tests reworked | 1 day |
| 2 | Delegate: van stock re-enabled, loading screens back, phone stock table | 1½ days |
| 3 | Reports and stock value taught about the three locations | ½ day |
| 4 | Tests on PostgreSQL, a live check, deploy | ½ day |
| | | **~3½ days** |

Nothing here needs new tables: `stock` has been keyed by (variant, location) since the beginning, and the van
locations and transfers are already written.

---

## 7 · Before anything starts

1. **Confirm the delegate reversal** (§4) — it undoes 31 October.
2. **Confirm unlimited really is unlimited** (§3) — or take the catalogue's own number instead.
3. Two commits are finished and waiting: the access-code fix and the delete button. The live site is still
   refusing good access codes until the first of them is deployed.
