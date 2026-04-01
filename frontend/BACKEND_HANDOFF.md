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
- Optional **`orderNumber`** (string): Sent when replaying an offline checkout (e.g. **`OFF-AB12`**). If non-empty after trim, **store and return** this value on the created order (and on **`GET /api/orders`**) so receipts, history, and other devices match the label staff already printed. If omitted, keep your existing auto-numbering.
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

The **POS browser does not use `window.print()`** for slips during normal online checkout (offline POS uses browser print). **Server thermal output** is the backend’s responsibility:

- **`POST /api/orders`** is sent with **`printThermal: false`** so checkout **returns as soon as the order is saved**. The client then calls **`POST /api/orders/:id/print`** with **`variant: "both"`** (receipt then kitchen). The client uses a **generous timeout** (~35–45s) because the server may not respond until receipt/kitchen jobs finish on USB; too short a timeout caused false “printer not responding” even when print succeeded. If the request still fails or times out, the client opens **browser print** as fallback. Checkout stays fast because **`POST /orders` does not wait on print**.
- If you support **`printThermal: true`** on create, **do not block** the HTTP response on printing for more than a second or two — prefer the same “save then async print” pattern.
- **Reprint last order** (Take Order) and **Receipt** / **Kitchen** (Order history) also use **`POST /api/orders/:id/print`** with `{ "variant": "both" | "receipt" | "kitchen" }` (with the same timeout on the client).

**Reports / timesheets:** the UI only offers **CSV export** today. If you need printable PDFs, add server endpoints later.

See **§9b** (hardware/API), **§9c** (templates), **§9a** (company fields + Settings save).

---

## 9b. Backend + USB thermal printer — automatic printing

### Can it print automatically?

**Yes**, if the component that talks to the printer runs on the **same computer** where the thermal printer is plugged in **USB** (e.g. your POS laptop). There is no browser print dialog; the OS or driver receives raw or spooled data and the printer fires immediately.

**No** (not directly), if your API only runs on a **remote** server (VPS, cloud): that server cannot see the shop laptop’s USB bus. In that case you need one of:

- Run the **API + print worker on the shop laptop** (local Node/Go/.NET service), or  
- A **small local agent** on the laptop (listens on `localhost`, receives print jobs from cloud via WebSocket/HTTPS long-poll), or  
- **Network-attached** printer (Ethernet/Wi‑Fi) reachable from the server (less common for cheap USB-only rolls).

### Recommended architecture (USB on laptop)

1. **POS browser** → `POST /api/orders` (existing) → server **persists order**.  
2. Same backend process (or a sidecar worker on the **same machine**) **builds receipt + kitchen text** (or **ESC/POS** bytes) and **writes to the printer** before or right after responding.  
3. Optional: `print: false` in the request to skip print (mis-feed / reprint flow).

Alternatively: return **`201`** from `POST /orders`, then frontend calls **`POST /api/orders/:id/print`**; the print handler loads the order from DB and prints. Easier to retry on failure.

### How to talk to a USB thermal printer (backend)

Typical cheap rolls speak **ESC/POS** over a USB virtual serial port or USB printer class.

| Platform | Approaches |
|----------|------------|
| **Windows** | Open the printer by name via **Win32 spooler** and send **RAW** data; or use a library that targets **ESC/POS** and the driver’s raw queue. Some devices appear as **COM port** — write bytes to COM. |
| **Linux** | **CUPS** raw queue, or write to **`/dev/usb/lp0`** (permissions / udev), or `usblp` device. |
| **Cross-platform** | Libraries (e.g. Node `escpos` / `node-thermal-printer`, Go/Python equivalents) that output ESC/POS, then send buffer to the driver or device. |

**58mm vs 80mm:** set line width and font commands in ESC/POS to match roll (often **32/42 chars @ 58mm** and **48/56 @ 80mm** depending on font — tune per model).

**Receipt + kitchen:** two separate print jobs (cut between) = send buffer, **GS V** partial/full cut (per printer manual), then second buffer.

### API contract (required for the current frontend)

**A — print with order create**

```http
POST /api/orders
Content-Type: application/json
Authorization: Bearer …

{
  "employeeId": "…",
  "lines": [ … ],
  "paymentMethod": "CASH",
  "printThermal": false
}
```

- The POS sends **`printThermal: false`** on checkout so **`POST /orders` responds quickly** after the order is persisted. Printing is triggered separately via **`POST /orders/:id/print`**. If you still honor **`printThermal: true`**, never hold the create response waiting on the physical printer.

**B — explicit print / reprint endpoint**

```http
POST /api/orders/:id/print
Authorization: Bearer …
Content-Type: application/json

{ "variant": "receipt" | "kitchen" | "both" }
```

- Loads order by id, renders ESC/POS or text, sends to USB printer.  
- **`200`** if spooled OK; **`409`** if printer offline (optional).

**Auth:** same as other staff endpoints; only **employees** who can place orders should print.

### Server configuration

- **Per shop (recommended):** read **`thermalPrinterQueueName`** from **`GET/PUT /api/company`** (see **§9a**). If set, use it as the Windows queue name (or map to your driver). If empty, fall back to env.
- Env fallback: **`THERMAL_PRINTER_NAME`** (Windows queue name) or **`THERMAL_DEVICE_PATH`** (`COM3`, `/dev/usb/lp0`), **`THERMAL_WIDTH_MM`** (`58` | `80`).  
- **Default printer** on Windows must match if using the spooler by name.

### Settings → backend flow

Super Admin opens **Settings → POS printer and payment (server)**, taps **Edit**, changes fields, then **Save to server** — that issues **`PUT /api/company`** with **`thermalPaperWidth`**, **`thermalPrinterQueueName`**, and **`defaultPaymentMethodCode`**. The print worker should resolve queue name: `company.thermalPrinterQueueName ?? process.env.THERMAL_PRINTER_NAME`. The browser never talks to USB.

### Frontend (summary)

- **`POST /api/orders`:** includes **`printThermal: false`** on place-order so saving the sale is not delayed by USB/queue issues.
- **`POST /api/orders/:id/print`:** called after create (**both** slips), reprint, and history **Receipt** / **Kitchen**; the client waits up to tens of seconds for a response (printing can be slow), then falls back to **browser print** if needed. Prefer returning as soon as jobs are **queued** to the OS spooler (fast HTTP response) instead of waiting for the physical printer to finish every byte — that keeps one connection from staying open unnecessarily.

---

## 9c. Print templates (thermal) — spec for backend parity

**Source of truth in the repo:** `frontend/src/orderDisplay.ts` (`formatOrderDisplay`, `formatLineAddOnsSummary`), `frontend/src/paymentMethodApi.ts` (`resolvePaymentMethodLabel`). **Company header** fields come from **`GET /api/company`**. **Paper width** for layout: **`thermalPaperWidth`** `"58"` \| `"80"` on the same resource.

Use this section to implement **ESC/POS** or plain-text rendering. There is no browser preview; the backend output is what staff and customers get.

### Money and dates

- All monetary amounts in API/models are **integer cents**.
- Display: prefix **`RM `** + **`(cents / 100).toFixed(2)`** (two decimal places).
- **Order date** on slips: `new Date(order.createdAt).toLocaleString()` in the browser (locale-dependent). For parity, use a fixed timezone (e.g. shop local) or ISO in a single line if you prefer consistency over exact match.

### Order reference (`formatOrderDisplay`)

Shown as **Order:** on both slips. Resolve in order:

1. If **`orderNumber`** is non-empty after trim → use it as-is (e.g. `C001`).
2. Else if **`sequence`** is a finite number → **`C`** + zero-padded 3 digits, e.g. `sequence` 25 → **`C025`**.
3. Else → take **`order.id`**, remove hyphens, take first **6** characters, uppercase, show as **`C-`** + that suffix (fallback when API omits public number).

### Payment line on the receipt (`paymentLabel`)

The receipt shows **Payment:** with a human label, not only the raw enum. The frontend builds it with **`resolvePaymentMethodLabel(paymentMethods, { paymentMethod, paymentMethodDetail, cashierCode? })`**:

- Prefer **`paymentMethodDetail`** (e.g. cashier code **TNG**): match **Settings** payment method by **code** (case-insensitive) → use **label**; else show the detail string.
- Else use **`paymentMethod`** the same way; else **`cashierCode`** if passed (right after checkout).

**Backend recommendation:** Either persist a **`paymentMethodLabel`** (or equivalent) on the order at checkout, or replicate the above once server-side payment methods exist. Otherwise the printed receipt may not match the POS without the local Settings list.

### Customer receipt (thermal) — block order

| Block | Content |
|-------|--------|
| **Header** | Main title: **`companyName`**, or literal **`Receipt`** if empty. |
| | Optional: **`Registration No: {registerNumber}`** |
| | Optional: **`address`** (may span multiple lines) |
| | Optional: **`contactNumber`** and **`email`** — each on its own line if present |
| **Rule** | Horizontal rule / divider (equivalent: dashed line or ESC/POS separator). |
| **Meta** | **Order:** `{formatOrderDisplay(order)}` |
| | **Order date:** `{localized createdAt}` |
| | **Payment:** `{paymentLabel}` |
| **Rule** | Divider |
| **Lines** | For each **`order.lines`**: show **quantity** + **`×`** + **`menuItemName`**. If **`addOns.length > 0`**, append **` + `** + add-on summary (see below). |
| | Line amount (right or next row): **`RM {line total}`** where line total cents = **`(basePrice + sum(addOn.price)) * quantity`**. |
| **Rule** | Divider |
| **Totals** | **Subtotal** — **`RM`** + subtotal from lines before order-level discount (frontend passes **`subtotalCents`** on the print job; recompute from lines + discounts on server). |
| | **Discount** — only if **`discountCents > 0`**: label **Discount**, value **`−RM {discount}`**. |
| | **Total** — **`RM`** + **`order.totalCents`**. |
| | **Cash received** — if **`tenderCents != null` and `tenderCents > 0`**: **Cash received** / **`RM {tenderCents}`**. |
| | **Change due** — if **`changeCents`** (or API **`changeDueCents`**) is present: **Change due** / **`RM {max(0, change)}`**. |
| **Footer** | **`Thank you!`** |

### Add-on summary on receipt (one line per cart line)

**`formatLineAddOnsSummary(addOns)`:** group add-ons by **`optionId`**, or by **`optionName`** if id missing. For each group, show **`optionName`**; if the group count is greater than one, append **` ×{count}`**. Join groups with **`, `** (comma + space).  
Example: two tomato add-ons → **`Tomato ×2`**.

### Kitchen slip (thermal) — block order

| Block | Content |
|-------|--------|
| **Title** | **`KITCHEN ORDER`** (all caps as in UI). |
| **Meta** | **Order:** same reference as receipt. **Order date:** same as receipt. |
| **Rule** | Divider |
| **Lines** | For each line: **`{quantity}x {menuItemName}`** (lowercase **`x`**). |
| | For **each** add-on (no collapsing): new row **`- {optionName}`** (leading hyphen + space). |

Kitchen slip **does not** show prices, subtotal, payment, or tender/change.

### Print variants (API `POST .../print` body)

| `variant` | Behaviour |
|-----------|-----------|
| **`receipt`** | Customer receipt only. |
| **`kitchen`** | Kitchen slip only. |
| **`both`** | Receipt then kitchen. On USB, prefer **two jobs** with a **cut** between (see §9b). |

**After `POST /orders/:id/print` with `variant: "both"`** (or after create if you still print inline when `printThermal: true`): print **receipt** first, then **cut** (or pause ~2s if hardware needs it), then **kitchen**, same as the old split browser flow.

### Data shapes (from `frontend/src/types.ts`)

**`Order` (relevant fields):** `id`, `createdAt`, `lines`, `totalCents`, `discountCents`, `orderNumber`, `sequence`, `paymentMethod`, `paymentMethodDetail`, `tenderCents`, `changeDueCents` (map to receipt **change** as needed).

**`OrderLine`:** `menuItemId`, `menuItemName`, `basePrice` (cents), `quantity`, `addOns[]`.

**`OrderLineAddOn`:** `optionId`, `optionName`, `price` (cents).

**`CompanyInfo` (header):** `companyName`, `registerNumber`, `address`, `contactNumber`, `email`.

---

## 9a. `GET/PUT /api/company` — optional POS fields

The client sends and expects these **optional** fields on the company resource (camelCase in JSON; snake_case accepted on read):

| Field | Type | Notes |
|-------|------|--------|
| `thermalPaperWidth` | `"58"` \| `"80"` | Receipt/kitchen slip layout width. Persist in DB; returned on `GET /company`. |
| `defaultPaymentMethodCode` | string | Must match a configured payment method **`code`** (same as cashier codes). Pre-selects that method on **Take Order**. Omit or empty = no default. |
| `thermalPrinterQueueName` | string | Optional. OS print queue name for server-side thermal printing (e.g. Windows printer display name). Persist in DB; used by print worker when implementing §9b. |

**Behaviour**

- **`GET /api/company`:** Include these fields when set so all devices stay in sync after login.
- **`PUT /api/company`:** Accept partial or full company payloads; merge unknown fields with existing row. Persist `thermalPaperWidth`, `defaultPaymentMethodCode`, and `thermalPrinterQueueName` when present.
- **Settings UI:** Super Admin must tap **Edit**, then **Save to server** to persist these three fields (no auto-save on every control change).
- Authenticated **non–super-admin** users may call **`GET /company`** if you want shared POS prefs (printer width, default payment) on shared tills; otherwise only admins receive POS fields and others rely on local device cache.

### `defaultPaymentMethodCode` vs “got TNG” errors

The POS **Super Admin** configures payment methods (Cash, Card, TNG, …) in **Settings** and stores them in **browser `localStorage`** — they are **not** automatically sent to the server unless you implement **§10**.

If **`PUT /api/company`** rejects the body with a message like **`defaultPaymentMethodCode must match a configured payment method code (got "TNG")`**, the backend is checking the code against a **server-side** list (often empty or only seeded with `CASH` / `CARD`). **`TNG` exists on the till, not in that list**, so validation fails.

**Fix on the backend (pick one):**

1. **Relax validation** for company: accept any non-empty string for `default_payment_method_code` / `defaultPaymentMethodCode`, or only enforce the FK check **after** payment methods are server-driven and synced.  
2. **Seed or CRUD** payment methods on the server so **`TNG`** (and every code the cashier uses) exists in the same table the validator reads.  
3. **Implement §10** and have the client sync methods before relying on strict checks.

**Workaround on the till:** In Settings → **Default payment method**, choose **“First in list (no default)”** before saving company / POS settings, so the client omits or clears the field and **`PUT /company`** succeeds — Take Order will still list TNG from local methods; only the server-stored default is skipped.

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
| `limit` | positive integer (optional) | Max rows to return. **Order history** sends **`10`** per page. |
| `offset` | non-negative integer (optional) | Skip this many rows after sort/filter (SQL `OFFSET`). Used with **`limit`**. |

**Semantics:**

- If both are omitted, behavior is unchanged (full list, subject to your own pagination rules if any).
- If only `from` is set, return orders from that instant onward (up to your max window or pagination).
- If only `to` is set, return orders up to that instant.
- Use a single, consistent timezone story in the DB (UTC storage + comparison is recommended); the client sends ISO strings with offset or `Z`.
- **`limit` + `offset`:** Apply after filtering by `from`/`to` (and `status` / `employeeId` if present). Sort by **`createdAt` descending** (newest first) so pages are stable.

### Database

- Add an **index on `created_at`** (or equivalent) on the orders table so range filters use an index scan instead of full table scans.
- If you filter by `status` or `employee_id` together with dates, consider a **composite index** that matches your most common query pattern (e.g. `(created_at, status)`).

### Response shape

- **Do not drop `lines` / `items`** when `from`/`to` are present — reports and reprints need line-level data for the returned orders.

### Paginated JSON (recommended when `limit` is sent)

When **`limit`** (and optionally **`offset`**) are present, prefer returning an object so the UI can show “Showing 1–10 of 142”:

```json
{
  "orders": [ … ],
  "total": 142
}
```

Also accept **`items`** instead of **`orders`**, and **`totalCount`** / **`total_count`** instead of **`total`**. The **Order history** screen uses this; **Sales report** may still call without `limit` and expect a plain array (until updated).

If you still return a **plain array** for paginated requests, the client will **slice** by `offset`/`limit` only when the array is longer than `limit` (legacy); otherwise the **Next** button may stay enabled until an empty page — implement **`limit`/`offset` in SQL** and **`total`** for best UX.

### Frontend alignment

- **Order history:** `fetchOrdersPage` sends **`from`**, **`to`**, **`limit=10`**, **`offset=page×10`**. CSV export pages through with **`limit=300`** until a short page.
- **Reports:** `fetchOrders` with range only (no pagination yet) — consider a cap or pagination if ranges are large.

---

## 12. Time entries — employee vs all-staff (timesheet)

The **Timesheet** tab loads clock in/out rows for reporting and CSV/print export.

| Request | Who | Behaviour |
|---------|-----|-----------|
| **`GET /api/time/entries?employeeId=<uuid>`** | Any authenticated user | Return that employee’s entries (used for top-bar clock state and **non-admin** timesheet). |
| **`GET /api/time/entries`** with **no** `employeeId` query | **Super Admin only** | Return **all** staff entries (newest first) for the **admin timesheet** view. Non–Super Admin should receive **`403`**. |

**Row shape:** `id`, `employeeId`, `clockInAt`, `clockOutAt` (nullable if still clocked in). Optional **`employeeName`** (string) on each row so the UI can show names without a separate lookup. Together with **`GET /api/employees`** (**§4a**), the app resolves display names for CSV/print.
