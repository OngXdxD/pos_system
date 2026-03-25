import type { Order } from './types'

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
