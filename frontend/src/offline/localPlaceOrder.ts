import type { PlaceOrderPayload } from '../api'
import type { Order, OrderLine } from '../types'
import { orderCreatedDayKey } from './dayKey'
import type { PendingPlaceRecord } from './types'

function linesForOrder(lines: PlaceOrderPayload['lines']): OrderLine[] {
  return lines.map((l) => ({
    id: crypto.randomUUID(),
    menuItemId: l.menuItemId,
    menuItemName: l.menuItemName,
    basePrice: l.basePrice,
    addOns: l.addOns,
    quantity: l.quantity,
  }))
}

function computeTotalCents(lines: OrderLine[], discountCents: number): number {
  const sub = lines.reduce(
    (s, line) =>
      s + (line.basePrice + line.addOns.reduce((a, x) => a + x.price, 0)) * line.quantity,
    0,
  )
  return Math.max(0, sub - discountCents)
}

export function buildOfflineOrderRecord(
  employeeId: string,
  payload: PlaceOrderPayload,
): PendingPlaceRecord {
  const localId = crypto.randomUUID()
  const lines = linesForOrder(payload.lines)
  const discount = payload.discountCents ?? 0
  const totalCents = computeTotalCents(lines, discount)
  const tender = payload.tenderCents
  const changeDueCents =
    tender != null ? Math.max(0, tender - totalCents) : undefined

  const createdAt = new Date().toISOString()
  const orderNumber = `OFF-${localId.replace(/-/g, '').slice(0, 4).toUpperCase()}`
  const order: Order = {
    id: `local:${localId}`,
    employeeId,
    lines,
    totalCents,
    status: payload.autoCompleteNewOrders === false ? 'PENDING' : 'COMPLETED',
    createdAt,
    paymentMethod: payload.paymentMethod,
    paymentMethodDetail: payload.paymentMethodDetail,
    discountCents: discount > 0 ? discount : undefined,
    orderNumber,
    tenderCents: tender,
    changeDueCents,
  }

  const dayKey = orderCreatedDayKey(createdAt)

  return {
    localId,
    dayKey,
    createdAt,
    payload: { ...payload, orderNumber },
    order,
  }
}

export function parseLocalIdFromOrderId(orderId: string): string | null {
  if (!orderId.startsWith('local:')) return null
  return orderId.slice('local:'.length)
}
