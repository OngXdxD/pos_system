import type { Order, OrderLineAddOn } from './types'

/** Collapse duplicate add-ons for display, e.g. "Tomato ×2, Cheese". */
export function formatLineAddOnsSummary(addOns: OrderLineAddOn[]): string {
  const map = new Map<string, { name: string; count: number }>()
  for (const a of addOns) {
    const key = a.optionId || a.optionName
    const cur = map.get(key)
    if (cur) cur.count += 1
    else map.set(key, { name: a.optionName, count: 1 })
  }
  return [...map.values()]
    .map(({ name, count }) => (count > 1 ? `${name} ×${count}` : name))
    .join(', ')
}

/**
 * Human-friendly order reference for customers and kitchen.
 * Prefer `orderNumber` from API (e.g. "C001"); else `sequence`; else short code (not full GUID).
 */
export function formatOrderDisplay(order: Order): string {
  const n = order.orderNumber?.trim()
  if (n) return n
  if (order.sequence != null && Number.isFinite(order.sequence)) {
    const s = Math.max(0, Math.floor(order.sequence))
    return `C${String(s).padStart(3, '0')}`
  }
  const compact = order.id.replace(/-/g, '').slice(0, 6).toUpperCase()
  return `C-${compact}`
}
