import { placeOrder, refundOrder } from '../api'
import {
  deletePendingPlace,
  deletePendingRefund,
  getAllPendingPlaces,
  getAllPendingRefunds,
  mergeOrdersIntoDaySnapshot,
  upsertServerOrderInSnapshot,
} from './db'
import { orderCreatedDayKey } from './dayKey'
import type { Order } from '../types'

/** Prefer the label shown offline (`OFF-…`) so history matches paper; fall back to server. */
function withReplayOrderNumber(server: Order, local: Order): Order {
  const orderNumber =
    local.orderNumber?.trim() ||
    server.orderNumber?.trim() ||
    undefined
  return orderNumber ? { ...server, orderNumber } : server
}

export type SyncOutboxResult = {
  placed: number
  refunded: number
  errors: string[]
}

/** Replay pending places (FIFO) then pending refunds. Does not print on server for replay. */
export async function syncOutboxToServer(token: string): Promise<SyncOutboxResult> {
  const errors: string[] = []
  let placed = 0
  let refunded = 0

  const pendingPlaces = await getAllPendingPlaces()
  pendingPlaces.sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  )

  for (const p of pendingPlaces) {
    try {
      const { refundPasscode, payload, localId, order: localOrder } = p
      const serverOrder = await placeOrder(
        {
          ...payload,
          printThermal: false,
        },
        token,
      )
      placed++
      const mergedOrder = withReplayOrderNumber(serverOrder, localOrder)
      const dayKey = orderCreatedDayKey(serverOrder.createdAt)
      await mergeOrdersIntoDaySnapshot(dayKey, [mergedOrder])

      if (localOrder.status === 'REFUNDED' && refundPasscode) {
        try {
          const updated = await refundOrder(serverOrder.id, refundPasscode, token)
          refunded++
          await upsertServerOrderInSnapshot(dayKey, withReplayOrderNumber(updated, localOrder))
        } catch (e) {
          errors.push(
            `Refund after sync for ${localId}: ${e instanceof Error ? e.message : String(e)}`,
          )
        }
      }

      await deletePendingPlace(localId)
    } catch (e) {
      errors.push(
        `Place ${p.localId}: ${e instanceof Error ? e.message : String(e)}`,
      )
    }
  }

  const pendingRefunds = await getAllPendingRefunds()
  pendingRefunds.sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  )

  for (const r of pendingRefunds) {
    try {
      const updated = await refundOrder(r.orderId, r.employeePasscode, token)
      refunded++
      const dayKey = orderCreatedDayKey(updated.createdAt)
      await upsertServerOrderInSnapshot(dayKey, updated)
      await deletePendingRefund(r.id)
    } catch (e) {
      errors.push(
        `Refund ${r.orderId}: ${e instanceof Error ? e.message : String(e)}`,
      )
    }
  }

  return { placed, refunded, errors }
}
