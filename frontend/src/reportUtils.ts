import { resolvePaymentMethodLabel } from './paymentMethodApi'
import type { Order, PaymentMethodConfig } from './types'

export type DateRangePreset =
  | 'today'
  | 'yesterday'
  | 'this_week'
  | 'last_week'
  | 'this_month'
  | 'last_month'
  | 'custom'

export function startOfDay(d: Date): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

export function endOfDay(d: Date): Date {
  const x = new Date(d)
  x.setHours(23, 59, 59, 999)
  return x
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}

/** Monday 00:00 – Sunday 23:59:59.999 for the calendar week containing `ref` (local time). */
export function weekRangeContaining(ref: Date): { from: Date; to: Date } {
  const day = ref.getDay()
  const daysFromMonday = (day + 6) % 7
  const monday = startOfDay(addDays(ref, -daysFromMonday))
  const sunday = endOfDay(addDays(monday, 6))
  return { from: monday, to: sunday }
}

/** Parse `YYYY-MM-DD` from `<input type="date">` in local timezone. */
export function parseLocalDateInput(isoDate: string, end: boolean): Date {
  const parts = isoDate.split('-').map(Number)
  const y = parts[0]
  const m = parts[1]
  const d = parts[2]
  if (!y || !m || !d) return startOfDay(new Date())
  const base = new Date(y, m - 1, d)
  return end ? endOfDay(base) : startOfDay(base)
}

function toInputString(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function defaultCustomRangeStrings(): { from: string; to: string } {
  const t = new Date()
  const s = toInputString(t)
  return { from: s, to: s }
}

export function presetToRange(
  preset: DateRangePreset,
  customFrom: string,
  customTo: string,
): { from: Date; to: Date } {
  const now = new Date()

  if (preset === 'custom') {
    if (!customFrom?.trim() || !customTo?.trim()) {
      const { from, to } = defaultCustomRangeStrings()
      let a = parseLocalDateInput(from, false)
      let b = parseLocalDateInput(to, true)
      if (a.getTime() > b.getTime()) [a, b] = [b, a]
      return { from: a, to: b }
    }
    let from = parseLocalDateInput(customFrom.trim(), false)
    let to = parseLocalDateInput(customTo.trim(), true)
    if (from.getTime() > to.getTime()) [from, to] = [to, from]
    return { from, to }
  }

  if (preset === 'today') {
    return { from: startOfDay(now), to: endOfDay(now) }
  }
  if (preset === 'yesterday') {
    const y = addDays(now, -1)
    return { from: startOfDay(y), to: endOfDay(y) }
  }
  if (preset === 'this_week') {
    return weekRangeContaining(now)
  }
  if (preset === 'last_week') {
    const { from: m } = weekRangeContaining(now)
    const prevMonday = addDays(m, -7)
    return { from: startOfDay(prevMonday), to: endOfDay(addDays(prevMonday, 6)) }
  }
  if (preset === 'this_month') {
    const from = startOfDay(new Date(now.getFullYear(), now.getMonth(), 1))
    const to = endOfDay(new Date(now.getFullYear(), now.getMonth() + 1, 0))
    return { from, to }
  }
  if (preset === 'last_month') {
    const from = startOfDay(new Date(now.getFullYear(), now.getMonth() - 1, 1))
    const to = endOfDay(new Date(now.getFullYear(), now.getMonth(), 0))
    return { from, to }
  }
  return { from: startOfDay(now), to: endOfDay(now) }
}

export function filterOrdersInRange(orders: Order[], from: Date, to: Date): Order[] {
  const a = from.getTime()
  const b = to.getTime()
  return orders.filter((o) => {
    const t = new Date(o.createdAt).getTime()
    return t >= a && t <= b
  })
}

function isSaleOrder(o: Order): boolean {
  return o.status === 'COMPLETED' || o.status === 'PENDING'
}

function lineSubtotalCents(line: Order['lines'][number]): number {
  const add = line.addOns.reduce((s, x) => s + x.price, 0)
  return (line.basePrice + add) * line.quantity
}

export type PaymentBreakdownRow = { key: string; label: string; orderCount: number; cents: number }
export type ProductBreakdownRow = { key: string; name: string; quantity: number; cents: number }
export type AddOnBreakdownRow = { key: string; name: string; quantity: number; cents: number }

export interface SalesReportSummary {
  /** Orders counted in sales (completed / pending). */
  saleOrderCount: number
  /** Sum of order totals for sale orders. */
  totalSalesCents: number
  /** Sum of `discountCents` on sale orders (whole-order discounts). Requires API to persist and return `discountCents`. */
  totalDiscountCents: number
  /** Sale orders that had a positive discount. */
  ordersWithDiscountCount: number
  /** Refunded orders in range. */
  refundOrderCount: number
  /** Sum of order totals for refunded orders. */
  refundTotalCents: number
  byPayment: PaymentBreakdownRow[]
  products: ProductBreakdownRow[]
  addOns: AddOnBreakdownRow[]
}

export function computeSalesReport(
  ordersInRange: Order[],
  paymentMethods: PaymentMethodConfig[],
): SalesReportSummary {
  const saleOrders = ordersInRange.filter(isSaleOrder)
  const refundOrders = ordersInRange.filter((o) => o.status === 'REFUNDED')

  const totalSalesCents = saleOrders.reduce((s, o) => s + o.totalCents, 0)
  const totalDiscountCents = saleOrders.reduce((s, o) => s + (o.discountCents ?? 0), 0)
  const ordersWithDiscountCount = saleOrders.filter((o) => (o.discountCents ?? 0) > 0).length
  const refundTotalCents = refundOrders.reduce((s, o) => s + o.totalCents, 0)

  const payMap = new Map<string, { label: string; orderCount: number; cents: number }>()
  for (const o of saleOrders) {
    const key = `${o.paymentMethod ?? ''}\u0000${o.paymentMethodDetail ?? ''}`
    const label = resolvePaymentMethodLabel(paymentMethods, {
      paymentMethod: o.paymentMethod,
      paymentMethodDetail: o.paymentMethodDetail,
    })
    const cur = payMap.get(key) ?? { label, orderCount: 0, cents: 0 }
    cur.orderCount += 1
    cur.cents += o.totalCents
    cur.label = label
    payMap.set(key, cur)
  }

  const prodMap = new Map<string, { name: string; quantity: number; cents: number }>()
  const addMap = new Map<string, { name: string; quantity: number; cents: number }>()

  for (const o of saleOrders) {
    for (const line of o.lines) {
      const pk = line.menuItemId || line.menuItemName
      const lineCents = lineSubtotalCents(line)
      const p = prodMap.get(pk) ?? { name: line.menuItemName, quantity: 0, cents: 0 }
      p.quantity += line.quantity
      p.cents += lineCents
      p.name = line.menuItemName
      prodMap.set(pk, p)

      for (const a of line.addOns) {
        const ak = a.optionId || a.optionName
        const q = line.quantity
        const cents = a.price * q
        const row = addMap.get(ak) ?? { name: a.optionName, quantity: 0, cents: 0 }
        row.quantity += q
        row.cents += cents
        row.name = a.optionName
        addMap.set(ak, row)
      }
    }
  }

  const byPayment = [...payMap.entries()]
    .map(([key, v]) => ({ key, label: v.label, orderCount: v.orderCount, cents: v.cents }))
    .sort((a, b) => b.cents - a.cents)

  const products = [...prodMap.entries()]
    .map(([key, v]) => ({ key, name: v.name, quantity: v.quantity, cents: v.cents }))
    .sort((a, b) => b.cents - a.cents)

  const addOns = [...addMap.entries()]
    .map(([key, v]) => ({ key, name: v.name, quantity: v.quantity, cents: v.cents }))
    .sort((a, b) => b.cents - a.cents)

  return {
    saleOrderCount: saleOrders.length,
    totalSalesCents,
    totalDiscountCents,
    ordersWithDiscountCount,
    refundOrderCount: refundOrders.length,
    refundTotalCents,
    byPayment,
    products,
    addOns,
  }
}
