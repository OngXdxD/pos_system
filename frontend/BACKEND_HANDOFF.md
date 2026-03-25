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

- `employeeId`, `lines[]`, `paymentMethod`, optional `discountCents`
- Validate lines, compute **`totalCents`** server-side (including discount)
- Return full order with **`orderNumber`** / **`sequence`**, **`status`**, lines, etc.

---

## 4. Order history & `GET /api/orders`

- List orders (newest first). Support `?status=` and `?employeeId=` if useful.
- Include **`orderNumber`** / **`sequence`**, **`paymentMethod`**, **`discountCents`**, **`tenderCents`**, **`changeDueCents`** when applicable.
- Add status **`REFUNDED`** when an order is refunded.

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
  "paymentMethod": "CARD"
}
```

**Behavior:**

1. Verify passcode → employee actor.
2. Reject if order is **`REFUNDED`** or **`CANCELLED`** (match frontend).
3. Update stored `paymentMethod`.
4. **Audit log:** `orderId`, `action: "CHANGE_PAYMENT"`, **`actorEmployeeId`**, old/new method, timestamp.
5. Return updated **order**.

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
