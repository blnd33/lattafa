<?php

namespace App\Services\Catalogue;

use App\Exceptions\AppException;
use App\Models\CatalogueCountry;
use App\Models\Customer;
use App\Models\User;
use App\Models\WholesaleCustomer;
use App\Services\AuditService;
use App\Services\Concerns\RequiresPermission;
use App\Support\Time;
use Illuminate\Support\Facades\DB;

/**
 * The businesses that buy wholesale: perfume shops and distributors, usually abroad.
 *
 * Kept apart from the shop's own `customers` table on purpose — that one is walk-ins and the shops a delegate
 * visits, with dinar balances and loyalty points, and none of it means anything here. Where the two turn out to be
 * the same business, `posCustomerId` points at it, and nothing is copied between them.
 */
class WholesaleCustomerService
{
    use RequiresPermission;

    public function __construct(private AuditService $audit) {}

    /**
     * @param array{q?: string, status?: string, countryId?: string} $filters
     * @return \Illuminate\Database\Eloquent\Collection<int, WholesaleCustomer>
     */
    public function list(User $actor, array $filters = [])
    {
        $this->need($actor, 'catalogue.customers');

        $q = trim($filters['q'] ?? '');

        return WholesaleCustomer::with('country')
            ->withCount(['codes as live_codes_count' => fn ($b) => $b->where('active', true)->whereNull('revoked_at')])
            ->when($q !== '', function ($b) use ($q) {
                $like = '%'.str_replace(['%', '_'], ['\%', '\_'], $q).'%';
                $b->where(fn ($w) => $w->where('business_name', 'like', $like)
                    ->orWhere('contact_person', 'like', $like)
                    ->orWhere('email', 'like', $like)
                    ->orWhere('phone', 'like', $like)
                    ->orWhere('whatsapp', 'like', $like));
            })
            ->when($filters['status'] ?? null, fn ($b, $s) => $b->where('status', $s))
            ->when($filters['countryId'] ?? null, fn ($b, $c) => $b->where('country_id', $c))
            ->orderBy('business_name')
            ->limit(500)
            ->get();
    }

    public function get(User $actor, string $id): WholesaleCustomer
    {
        $this->need($actor, 'catalogue.customers');

        return WholesaleCustomer::with(['country', 'codes' => fn ($b) => $b->orderByDesc('created_at')])->findOrFail($id);
    }

    /**
     * Adds a business or changes one.
     *
     * @param array{id?: string|null, businessName: string, contactPerson?: string, email?: string, phone?: string, whatsapp?: string, countryId?: string|null, address?: string, status?: string, notes?: string, posCustomerId?: string|null} $in
     */
    public function save(User $actor, array $in): WholesaleCustomer
    {
        $this->need($actor, 'catalogue.customers');

        $name = trim($in['businessName'] ?? '');
        if ($name === '') {
            throw new AppException('required_fields');
        }

        $status = $in['status'] ?? 'active';
        if (! in_array($status, WholesaleCustomer::STATUSES, true)) {
            throw new AppException('status_invalid');
        }

        $countryId = $in['countryId'] ?? null;
        if ($countryId !== null && ! CatalogueCountry::whereKey($countryId)->exists()) {
            throw new AppException('country_unknown');
        }

        $posCustomerId = $in['posCustomerId'] ?? null;
        if ($posCustomerId !== null && ! Customer::whereKey($posCustomerId)->exists()) {
            throw new AppException('customer_unknown');
        }

        return DB::transaction(function () use ($actor, $in, $name, $status, $countryId, $posCustomerId) {
            $customer = isset($in['id']) ? WholesaleCustomer::findOrFail($in['id']) : new WholesaleCustomer();
            $isNew = ! $customer->exists;
            $wasStatus = $customer->status;

            $customer->fill([
                'business_name' => $name,
                'contact_person' => trim($in['contactPerson'] ?? ''),
                'email' => trim($in['email'] ?? ''),
                'phone' => trim($in['phone'] ?? ''),
                'whatsapp' => trim($in['whatsapp'] ?? ''),
                'country_id' => $countryId,
                'address' => trim($in['address'] ?? ''),
                'status' => $status,
                'notes' => trim($in['notes'] ?? ''),
                'pos_customer_id' => $posCustomerId,
            ])->save();

            $meta = ['business' => $customer->business_name];
            if (! $isNew && $wasStatus !== $status) {
                $meta['status'] = [$wasStatus, $status];
            }
            $this->audit->log($actor, $isNew ? 'catalogue.customer_added' : 'catalogue.customer_updated', 'wholesale_customer', $customer->id, $meta);

            return $customer->fresh(['country']);
        });
    }

    /**
     * Puts a business on hold or lets it buy again. A suspended or closed business keeps its codes but cannot
     * unlock anything — `AccessCodeService` checks the status at every unlock, so sessions already open are
     * closed too.
     */
    public function setStatus(User $actor, string $id, string $status): WholesaleCustomer
    {
        $this->need($actor, 'catalogue.customers');
        if (! in_array($status, WholesaleCustomer::STATUSES, true)) {
            throw new AppException('status_invalid');
        }

        $customer = WholesaleCustomer::findOrFail($id);
        $was = $customer->status;
        if ($was === $status) {
            return $customer;
        }

        DB::transaction(function () use ($customer, $status, $actor, $was) {
            $customer->update(['status' => $status]);
            if ($status !== 'active') {
                // nothing half-open: whoever is reading their prices right now is shown the door as well
                $customer->sessions()->whereNull('revoked_at')->update(['revoked_at' => Time::nowMs()]);
            }
            $this->audit->log($actor, 'catalogue.customer_status', 'wholesale_customer', $customer->id, [
                'business' => $customer->business_name, 'status' => [$was, $status],
            ]);
        });

        return $customer->fresh();
    }

    /**
     * Removes a business entirely — for one entered by mistake, or that never traded.
     *
     * What belongs to the business goes with it: its access codes, any open sessions, the prices agreed with it,
     * its whole-order discount and the rules it was let off. Those are all `cascadeOnDelete` in the schema, so
     * the database does it in the same statement and nothing is left pointing at a business that is gone.
     *
     * **An order is where this stops.** `wholesale_orders` is `restrictOnDelete` on purpose: an order is a
     * commercial record, it may be holding stock off the shelf this minute, and its payments and status history
     * hang off it. A business that has ever ordered is closed instead, which stops it buying while every figure
     * stays where it is. The guard is here as well as in the schema so the owner is told why rather than meeting
     * a database error.
     */
    public function delete(User $actor, string $id): void
    {
        $this->need($actor, 'catalogue.customers');

        $customer = WholesaleCustomer::withCount('orders')->findOrFail($id);
        if ($customer->orders_count > 0) {
            throw new AppException('customer_has_orders', [
                'business' => $customer->business_name, 'orders' => $customer->orders_count,
            ]);
        }

        DB::transaction(function () use ($customer, $actor) {
            // said before the row is gone, while there is still something to name it by
            $this->audit->log($actor, 'catalogue.customer_deleted', 'wholesale_customer', $customer->id, [
                'business' => $customer->business_name, 'codes' => $customer->codes()->count(),
            ]);
            $customer->delete();
        });
    }
}
