import type {
  AuthSession,
  CompanyInfo,
  Employee,
  MenuItem,
  Order,
  OrderLine,
  OrderStatus,
  TimeEntry,
  UserRole,
} from './types';

const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? '/api').replace(/\/$/, '');

function getErrorMessage(payload: unknown, fallback: string): string {
  if (typeof payload === 'object' && payload !== null && 'message' in payload) {
    const maybeMessage = (payload as { message: unknown }).message;
    if (typeof maybeMessage === 'string' && maybeMessage.trim().length > 0) {
      return maybeMessage;
    }
    if (Array.isArray(maybeMessage) && maybeMessage.length > 0) {
      const parts = maybeMessage.filter((m): m is string => typeof m === 'string' && m.trim().length > 0);
      if (parts.length > 0) return parts.join(' ');
    }
  }
  return fallback;
}

async function requestJson<T>(
  path: string,
  options: RequestInit = {},
  token?: string,
): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set('Content-Type', 'application/json');
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  const payload = (await res.json().catch(() => null)) as unknown;

  if (!res.ok) {
    throw new Error(getErrorMessage(payload, `${res.status} ${res.statusText}`.trim()));
  }

  return payload as T;
}

export async function loginWithPasscode(passcode: string): Promise<AuthSession> {
  return requestJson<AuthSession>('/auth/passcode-login', {
    method: 'POST',
    body: JSON.stringify({ passcode }),
  });
}

export async function clockIn(employeeId: string, token: string): Promise<TimeEntry> {
  return requestJson<TimeEntry>(
    '/time/clock-in',
    {
      method: 'POST',
      body: JSON.stringify({ employeeId }),
    },
    token,
  );
}

export async function clockOut(entryId: string, token: string): Promise<TimeEntry> {
  return requestJson<TimeEntry>(
    '/time/clock-out',
    {
      method: 'POST',
      body: JSON.stringify({ entryId }),
    },
    token,
  );
}

export async function fetchTimeEntries(employeeId: string, token: string): Promise<TimeEntry[]> {
  const query = new URLSearchParams({ employeeId }).toString();
  return requestJson<TimeEntry[]>(`/time/entries?${query}`, {}, token);
}

/** Super Admin: all staff clock entries. Backend should omit `employeeId` query or use role check. */
export async function fetchAllTimeEntries(token: string): Promise<TimeEntry[]> {
  return requestJson<TimeEntry[]>('/time/entries', {}, token);
}

export async function createEmployee(
  input: { name: string; passcode: string; role: UserRole },
  token: string,
): Promise<Employee> {
  return requestJson<Employee>(
    '/employees',
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
    token,
  );
}

export async function changeEmployeePasscode(
  input: { employeeId: string; newPasscode: string; superAdminPasscode: string },
  token: string,
): Promise<void> {
  await requestJson<unknown>(
    '/employees/change-passcode',
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
    token,
  );
}

/** Staff directory for resolving names on orders / timesheet. Fails soft if route missing or forbidden. */
export async function fetchEmployees(token: string): Promise<Employee[]> {
  try {
    return await requestJson<Employee[]>('/employees', {}, token)
  } catch {
    return []
  }
}

// ─── Menu ─────────────────────────────────────────────────────────────────────

/** Ensures add-on groups include minSelectable (older API/local data may omit it). */
export function normalizeMenuItems(items: MenuItem[]): MenuItem[] {
  return items.map((item) => ({
    ...item,
    addOnGroups: item.addOnGroups.map((g) => ({
      ...g,
      minSelectable: g.minSelectable ?? 0,
    })),
  }));
}

export async function fetchMenuItems(token: string): Promise<MenuItem[]> {
  const items = await requestJson<MenuItem[]>('/menu', {}, token);
  return normalizeMenuItems(items);
}

export async function createMenuItem(
  data: Omit<MenuItem, 'id'>,
  token: string,
): Promise<MenuItem> {
  const item = await requestJson<MenuItem>('/menu', { method: 'POST', body: JSON.stringify(data) }, token);
  return normalizeMenuItems([item])[0];
}

export async function updateMenuItem(
  id: string,
  data: MenuItem,
  token: string,
): Promise<MenuItem> {
  const item = await requestJson<MenuItem>(`/menu/${id}`, { method: 'PUT', body: JSON.stringify(data) }, token);
  return normalizeMenuItems([item])[0];
}

export async function deleteMenuItem(id: string, token: string): Promise<void> {
  await requestJson<unknown>(`/menu/${id}`, { method: 'DELETE' }, token);
}

// ─── Company ──────────────────────────────────────────────────────────────────

/** Normalizes `/company` JSON (camelCase or snake_case) for optional POS fields. */
export function normalizeCompanyInfo(raw: unknown): CompanyInfo {
  const empty: CompanyInfo = {
    companyName: '',
    registerNumber: '',
    contactNumber: '',
    address: '',
    email: '',
  }
  if (!raw || typeof raw !== 'object') return empty
  const r = raw as Record<string, unknown>
  const str = (a: string, b?: string): string => {
    const v = r[a] ?? (b ? r[b] : undefined)
    return typeof v === 'string' ? v : ''
  }
  const tw = r.thermalPaperWidth ?? r.thermal_paper_width
  const dpm = r.defaultPaymentMethodCode ?? r.default_payment_method_code
  const tpq = r.thermalPrinterQueueName ?? r.thermal_printer_queue_name
  return {
    companyName: str('companyName', 'company_name'),
    registerNumber: str('registerNumber', 'register_number'),
    contactNumber: str('contactNumber', 'contact_number'),
    address: str('address'),
    email: str('email'),
    thermalPaperWidth: tw === '80' ? '80' : tw === '58' ? '58' : undefined,
    defaultPaymentMethodCode:
      typeof dpm === 'string' && dpm.trim() ? dpm.trim() : undefined,
    thermalPrinterQueueName:
      typeof tpq === 'string' && tpq.trim() ? tpq.trim() : undefined,
  }
}

export async function fetchCompanyInfo(token: string): Promise<CompanyInfo | null> {
  try {
    const data = await requestJson<unknown>('/company', {}, token)
    return normalizeCompanyInfo(data)
  } catch {
    return null
  }
}

export async function updateCompanyInfo(data: CompanyInfo, token: string): Promise<CompanyInfo> {
  const saved = await requestJson<unknown>('/company', { method: 'PUT', body: JSON.stringify(data) }, token)
  return normalizeCompanyInfo(saved)
}

// ─── Orders ──────────────────────────────────────────────────────────────────

/** Raw shape from API (primary field is `lines`; some APIs may use `items`) */
type OrderApiRow = {
  id: string;
  employeeId: string;
  totalCents: number;
  status: OrderStatus;
  createdAt: string;
  paymentMethod?: string;
  paymentMethodDetail?: string;
  discountCents?: number;
  orderNumber?: string;
  sequence?: number;
  tenderCents?: number;
  changeDueCents?: number;
  items?: OrderLine[];
  lines?: OrderLine[];
};

/** Sub-type / custom method from API (camelCase or snake_case). Usually the cashier code, e.g. TNG. */
function extractPaymentMethodDetail(raw: OrderApiRow): string | undefined {
  const r = raw as OrderApiRow & Record<string, unknown>;
  const keys = [
    'paymentMethodDetail',
    'payment_method_detail',
    'paymentMethodCode',
    'payment_method_code',
    'paymentMethodLabel',
    'payment_method_label',
    'paymentSubType',
    'payment_sub_type',
  ] as const;
  for (const k of keys) {
    const v = r[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return undefined;
}

function extractEmployeeName(raw: OrderApiRow): string | undefined {
  const r = raw as OrderApiRow & Record<string, unknown>;
  const keys = [
    'employeeName',
    'employee_name',
    'cashierName',
    'cashier_name',
    'createdByName',
    'created_by_name',
  ] as const;
  for (const k of keys) {
    const v = r[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return undefined;
}

function normalizeOrderResponse(raw: OrderApiRow): Order {
  const lines = raw.items ?? raw.lines ?? [];
  return {
    id: raw.id,
    employeeId: raw.employeeId,
    employeeName: extractEmployeeName(raw),
    totalCents: raw.totalCents,
    status: raw.status,
    createdAt: raw.createdAt,
    paymentMethod: raw.paymentMethod,
    paymentMethodDetail: extractPaymentMethodDetail(raw),
    discountCents: raw.discountCents,
    orderNumber: raw.orderNumber,
    sequence: raw.sequence,
    tenderCents: raw.tenderCents,
    changeDueCents: raw.changeDueCents,
    lines,
  };
}

/** Payload for POST /api/orders — matches backend: `employeeId` + `lines` (no client `id` on lines) */
export type PlaceOrderLineInput = {
  menuItemId: string;
  menuItemName: string;
  basePrice: number;
  addOns: OrderLine['addOns'];
  quantity: number;
};

export type PlaceOrderPayload = {
  employeeId: string;
  lines: PlaceOrderLineInput[];
  /** Backend enum: CASH | CARD | OTHER (custom cashier codes map to OTHER). */
  paymentMethod: string;
  /** Optional cashier method code when `paymentMethod` is OTHER (e.g. TNG). Backend should persist and echo. */
  paymentMethodDetail?: string;
  /** Whole-order discount in cents; backend should validate and recompute totalCents */
  discountCents?: number;
  /** When payment is cash: amount customer paid (cents). Backend stores and may echo changeDueCents. */
  tenderCents?: number;
  /**
   * When true, backend should create the order as **COMPLETED** (paid at counter).
   * When false, backend should create as **PENDING** (e.g. await kitchen / fulfillment).
   */
  autoCompleteNewOrders?: boolean;
  /** When true (always sent by the POS client), backend prints receipt + kitchen per BACKEND_HANDOFF §9b/§9c. */
  printThermal?: boolean;
};

export async function placeOrder(payload: PlaceOrderPayload, token: string): Promise<Order> {
  const raw = await requestJson<OrderApiRow>(
    '/orders',
    { method: 'POST', body: JSON.stringify(payload) },
    token,
  );
  return normalizeOrderResponse(raw);
}

export type OrderThermalPrintVariant = 'receipt' | 'kitchen' | 'both';

/** Backend thermal print (USB/agent). See BACKEND_HANDOFF §9b. */
export async function requestOrderThermalPrint(
  orderId: string,
  token: string,
  variant: OrderThermalPrintVariant = 'both',
): Promise<void> {
  await requestJson<unknown>(
    `/orders/${orderId}/print`,
    { method: 'POST', body: JSON.stringify({ variant }) },
    token,
  );
}

export async function fetchOrders(
  token: string,
  filters?: { status?: OrderStatus; employeeId?: string; from?: string; to?: string },
): Promise<Order[]> {
  const qs = new URLSearchParams();
  if (filters?.status) qs.set('status', filters.status);
  if (filters?.employeeId) qs.set('employeeId', filters.employeeId);
  if (filters?.from) qs.set('from', filters.from);
  if (filters?.to) qs.set('to', filters.to);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  const rows = await requestJson<OrderApiRow[]>(`/orders${suffix}`, {}, token);
  return rows.map(normalizeOrderResponse);
}

export type OrdersPageResult = {
  orders: Order[];
  /**
   * Total rows matching the query (all pages). Null when the API returned a plain array and the
   * page is “full” — treat as “may have more” (see Order history Next button).
   */
  total: number | null;
};

function parseOrdersPagePayload(raw: unknown, limit: number, offset: number): OrdersPageResult {
  if (Array.isArray(raw)) {
    const mapped = raw.map((row) => normalizeOrderResponse(row as OrderApiRow));
    // Legacy: server ignores limit/offset and returns the full day — slice client-side.
    if (mapped.length > limit) {
      return {
        orders: mapped.slice(offset, offset + limit),
        total: mapped.length,
      };
    }
    // One page from server (or last short page).
    if (mapped.length === limit) {
      return { orders: mapped, total: null };
    }
    return { orders: mapped, total: mapped.length };
  }
  if (!raw || typeof raw !== 'object') {
    return { orders: [], total: 0 };
  }
  const o = raw as Record<string, unknown>;
  const listRaw = o.orders ?? o.items ?? o.data;
  if (!Array.isArray(listRaw)) {
    return { orders: [], total: 0 };
  }
  const orders = listRaw.map((row) => normalizeOrderResponse(row as OrderApiRow));
  const t = o.total ?? o.totalCount ?? o.total_count;
  let total: number | null = null;
  if (typeof t === 'number' && Number.isFinite(t)) {
    total = t;
  } else if (typeof t === 'string' && /^\d+$/.test(t)) {
    total = parseInt(t, 10);
  }
  return { orders, total };
}

/** Paginated list for Order history. Sends `limit` + `offset`; see BACKEND_HANDOFF §11. */
export async function fetchOrdersPage(
  token: string,
  filters: {
    from?: string;
    to?: string;
    status?: OrderStatus;
    employeeId?: string;
    limit: number;
    offset: number;
  },
): Promise<OrdersPageResult> {
  const qs = new URLSearchParams();
  if (filters.status) qs.set('status', filters.status);
  if (filters.employeeId) qs.set('employeeId', filters.employeeId);
  if (filters.from) qs.set('from', filters.from);
  if (filters.to) qs.set('to', filters.to);
  qs.set('limit', String(filters.limit));
  qs.set('offset', String(filters.offset));
  const raw = await requestJson<unknown>(`/orders?${qs.toString()}`, {}, token);
  return parseOrdersPagePayload(raw, filters.limit, filters.offset);
}

export async function fetchOrderById(orderId: string, token: string): Promise<Order> {
  const raw = await requestJson<OrderApiRow>(`/orders/${orderId}`, {}, token);
  return normalizeOrderResponse(raw);
}

/** Any active employee may authorize; backend verifies passcode and logs actor. */
export async function refundOrder(
  orderId: string,
  employeePasscode: string,
  token: string,
): Promise<Order> {
  const raw = await requestJson<OrderApiRow>(
    `/orders/${orderId}/refund`,
    { method: 'POST', body: JSON.stringify({ employeePasscode }) },
    token,
  );
  return normalizeOrderResponse(raw);
}

export async function changeOrderPaymentMethod(
  orderId: string,
  body: { employeePasscode: string; paymentMethod: string; paymentMethodDetail?: string },
  token: string,
): Promise<Order> {
  const raw = await requestJson<OrderApiRow>(
    `/orders/${orderId}/payment-method`,
    { method: 'POST', body: JSON.stringify(body) },
    token,
  );
  return normalizeOrderResponse(raw);
}

