# Backend handoff — current tasks

What the frontend expects the API to implement or align with. Older features (auth, time, menu, company) are assumed unless noted.

---

## 1. Human-readable order number (not raw UUID)

Customers and kitchen should see codes like **`C001`**, **`C002`**, not the internal UUID.

**Option A (preferred):** Return a string on every order:

- `orderNumber`: `"C001"` (or your format)

**Option B:** Return an increment:

- `sequence`: `1` — frontend displays as `C001` via zero-padding.

If neither is present, the UI falls back to a short code derived from the UUID (still not the full GUID).

Apply on **`POST /api/orders`** response and **`GET /api/orders`** (and **`GET /api/orders/:id`** if you add it).

---

## 2. `POST /api/orders` — cash tender & change

When `paymentMethod` is cash (e.g. `CASH`), the body may include:

| Field | Type | Notes |
|-------|------|--------|
| `tenderCents` | number | Amount the customer paid (cents). |

**Response should include** (for receipts and history):

- `tenderCents` — echo or stored value  
- `changeDueCents` — `max(0, tenderCents - totalCents)` (or equivalent after your pricing rules)

Non-cash orders: omit `tenderCents` or send `null`.

---

## 3. `POST /api/orders` — existing fields (recap)

- `employeeId`, `lines[]`, `paymentMethod`, optional `discountCents`, optional **`paymentMethodDetail`**
- Optional **`autoCompleteNewOrders`** (boolean): Super Admin sets this in the app **Settings → New orders**. When **`true`**, create the order with status **`COMPLETED`** (typical paid-at-counter flow). When **`false`** or omitted, create as **`PENDING`** (e.g. kitchen / fulfillment must complete it later). The client always sends this field explicitly (`true` or `false`) based on the toggle.
- **`paymentMethod`** must stay within your enum (e.g. `CASH` | `CARD` | `OTHER`). When the cashier picks a custom method (e.g. TNG), the client sends `paymentMethod: "OTHER"` and **`paymentMethodDetail`**: cashier **code** string (e.g. `"TNG"`). **Persist and echo** this field on responses and on **`GET /api/orders`** so history, receipts, and reports show the correct label after reload.
- Validate lines, compute **`totalCents`** server-side (including discount)
- Return full order with **`orderNumber`** / **`sequence`**, **`status`**, lines, etc.

---

## 4. Order history & `GET /api/orders`

- List orders (newest first). Support `?status=` and `?employeeId=` if useful.
- Include **`orderNumber`** / **`sequence`**, **`paymentMethod`**, **`paymentMethodDetail`** (when set), **`discountCents`**, **`tenderCents`**, **`changeDueCents`** when applicable.
- Each list item must include **full line items** (`lines` or `items` with add-ons) — the **Reports** screen aggregates products and add-ons from this payload. Do not strip lines from the list endpoint unless you provide a separate report/export API.
- Add status **`REFUNDED`** when an order is refunded.
- **Performance (required for scale):** support **`?from=`** and **`?to=`** as ISO-8601 datetimes and filter **`createdAt`** server-side. See **§11**.
- **Employee display:** optional **`employeeName`** (or snake_case **`employee_name`**, **`cashierName`**, etc.) on each order so history and CSV can show the cashier without a second lookup. The client also merges **`GET /api/employees`** (see **§4a**) to resolve names from **`employeeId`** when the name field is absent.

### 4a. `GET /api/employees` (staff directory)

Return an array of **`{ id, name, role }`** for all staff the session may see (typically Super Admin gets everyone; other roles may get self-only or the same list per your policy). Used to show **names** instead of UUIDs on the **Timesheet** (admin CSV), **Order history** table, print, and CSV export. The frontend calls this after login and tolerates **404** / empty array (falls back to **`employeeName`** on orders/time rows and the logged-in user from the session).

---

## 5. `GET /api/orders/:id` (optional)

Return a single order (same shape as list item). Used if you want detail views later; the frontend currently uses list data for reprints.

---

## 6. `POST /api/orders/:id/refund`

Authorize a **refund** using **any active employee’s passcode** (not necessarily the logged-in session user).

**Body:**

```json
{ "employeePasscode": "1234" }
```

**Behavior:**

1. Resolve employee by passcode (same validation as login / bcrypt).
2. If invalid → `401` or `403`.
3. Mark order refunded (e.g. `status: "REFUNDED"`) and persist payment reversal per your rules.
4. **Audit log (required):** record at least `orderId`, `action: "REFUND"`, **`actorEmployeeId`** / name of the employee whose passcode was verified, and timestamp.
5. Return updated **order** JSON.

---

## 7. `POST /api/orders/:id/payment-method`

Change payment method after the sale, again with **any** employee passcode.

**Body:**

```json
{
  "employeePasscode": "1234",
  "paymentMethod": "CARD",
  "paymentMethodDetail": "TNG"
}
```

(`paymentMethodDetail` is optional; include when `paymentMethod` is `OTHER` and the cashier chose a specific sub-method.)

**Behavior:**

1. Verify passcode → employee actor.
2. Reject if order is **`REFUNDED`** or **`CANCELLED`** (match frontend).
3. Update stored `paymentMethod` and, if provided, **`paymentMethodDetail`**.
4. **Audit log:** `orderId`, `action: "CHANGE_PAYMENT"`, **`actorEmployeeId`**, old/new method, timestamp.
5. Return updated **order** JSON.

---

## 8. Audit trail (recommended schema)

Example table `order_audit_events`:

- `id`, `order_id`, `action` (`REFUND` | `CHANGE_PAYMENT` | …)
- `actor_employee_id` (who passed passcode verification)
- `payload` (JSON: optional details)
- `created_at`

Optional **`GET /api/orders/:id/audit`** for admin UI later.

---

## 9. Printing

Still **client-only** (`window.print()`). No print API required.

---

## 10. Optional: `GET/PUT /api/payment-methods`

If payment methods should be server-driven instead of localStorage-only, expose CRUD for Super Admin; codes must match `paymentMethod` validation on orders.

---

## 11. Performance — `GET /api/orders` date range & indexing

The frontend passes **`from`** and **`to`** on **`GET /api/orders`** (ISO-8601) for the **Reports** screen. The server should filter by **`createdAt`** so responses stay small and fast. Until that is implemented, APIs that ignore extra query params may still return the full list — the client **also** filters by the selected range so numbers stay correct.

### Query parameters

| Param | Type | Meaning |
|-------|------|--------|
| `from` | ISO-8601 string (optional) | Include orders with **`createdAt` ≥ `from`** (inclusive). |
| `to` | ISO-8601 string (optional) | Include orders with **`createdAt` ≤ `to`** (inclusive). |

**Semantics:**

- If both are omitted, behavior is unchanged (full list, subject to your own pagination rules if any).
- If only `from` is set, return orders from that instant onward (up to your max window or pagination).
- If only `to` is set, return orders up to that instant.
- Use a single, consistent timezone story in the DB (UTC storage + comparison is recommended); the client sends ISO strings with offset or `Z`.

### Database

- Add an **index on `created_at`** (or equivalent) on the orders table so range filters use an index scan instead of full table scans.
- If you filter by `status` or `employee_id` together with dates, consider a **composite index** that matches your most common query pattern (e.g. `(created_at, status)`).

### Response shape

- **Do not drop `lines` / `items`** when `from`/`to` are present — reports and reprints need line-level data for the returned orders.

### Optional: pagination / caps

If a date range can still return a huge number of rows:

- Add **`limit`** + **`cursor`** / **`offset`** (or keyset pagination on `createdAt` + `id`) and document max rows per request.
- Coordinate with the frontend to request reports in chunks or enforce a maximum range (e.g. one month per call).

### Frontend alignment

The **Reports** view calls `fetchOrders` with the current range (`from` / `to` as ISO strings). Implementing server-side filtering in §11 avoids downloading unrelated orders and reduces memory use on the device.

---

## 12. Time entries — employee vs all-staff (timesheet)

The **Timesheet** tab loads clock in/out rows for reporting and CSV/print export.

| Request | Who | Behaviour |
|---------|-----|-----------|
| **`GET /api/time/entries?employeeId=<uuid>`** | Any authenticated user | Return that employee’s entries (used for top-bar clock state and **non-admin** timesheet). |
| **`GET /api/time/entries`** with **no** `employeeId` query | **Super Admin only** | Return **all** staff entries (newest first) for the **admin timesheet** view. Non–Super Admin should receive **`403`**. |

**Row shape:** `id`, `employeeId`, `clockInAt`, `clockOutAt` (nullable if still clocked in). Optional **`employeeName`** (string) on each row so the UI can show names without a separate lookup. Together with **`GET /api/employees`** (**§4a**), the app resolves display names for CSV/print.
