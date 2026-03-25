export type UserRole = 'SUPER_ADMIN' | 'EMPLOYEE';

export interface AuthUser {
  id: string;
  name: string;
  role: UserRole;
}

export interface AuthSession {
  token: string;
  user: AuthUser;
}

export interface Employee {
  id: string;
  name: string;
  role: UserRole;
}

export interface TimeEntry {
  id: string;
  employeeId: string;
  /** When API includes staff name (e.g. GET /time/entries for all employees). */
  employeeName?: string;
  clockInAt: string;
  clockOutAt: string | null;
}

export interface AddOnOption {
  id: string;
  name: string;
  price: number; // extra charge in cents
}

export interface AddOnGroup {
  id: string;
  name: string; // e.g. "Extras"
  /** Minimum choices required from this group when maxSelectable > 0 (0 = optional) */
  minSelectable: number;
  /** 0 = none (group off), 1 = pick 1, 2 = pick up to 2, etc. */
  maxSelectable: number;
  options: AddOnOption[];
}

export interface MenuItem {
  id: string;
  name: string;
  basePrice: number; // in cents
  addOnGroups: AddOnGroup[];
}

export interface CompanyInfo {
  companyName: string;
  registerNumber: string;
  contactNumber: string;
  address: string;
  email: string;
}

/** Super-admin configured payment options; `code` is sent to POST /api/orders */
export interface PaymentMethodConfig {
  id: string;
  label: string;
  code: string;
}

// ─── Orders ───────────────────────────────────────────────────────────────────

export interface OrderLineAddOn {
  optionId: string;
  optionName: string;
  price: number; // cents
}

export interface OrderLine {
  /** Present in cart (client); server lines may omit */
  id?: string;
  menuItemId: string;
  menuItemName: string;
  basePrice: number; // cents
  addOns: OrderLineAddOn[];
  quantity: number;
}

export type OrderStatus = 'PENDING' | 'COMPLETED' | 'CANCELLED' | 'REFUNDED';

export interface Order {
  id: string;
  employeeId: string;
  /** When API echoes cashier / creator display name */
  employeeName?: string;
  /** Normalized from API `items` or `lines` */
  lines: OrderLine[];
  totalCents: number;
  status: OrderStatus;
  createdAt: string;
  paymentMethod?: string;
  /** Sub-type from API: usually cashier method code (e.g. TNG) when enum is OTHER; may be a label if API stored that */
  paymentMethodDetail?: string;
  /** If backend returns order-level discount (cents) */
  discountCents?: number;
  /** Public-facing code e.g. "C001" (backend-assigned; avoid showing raw UUID) */
  orderNumber?: string;
  /** If backend only sends incrementing integer, UI formats as C001 */
  sequence?: number;
  /** Cash tender amount (cents), if paid by cash */
  tenderCents?: number;
  /** Change given to customer (cents) */
  changeDueCents?: number;
}

