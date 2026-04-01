import type { Order } from '../types'
import type { PlaceOrderPayload } from '../api'

export type PendingPlaceRecord = {
  localId: string
  dayKey: string
  createdAt: string
  payload: PlaceOrderPayload
  order: Order
  /** Set when user refunds before sync — server will place then refund. */
  refundPasscode?: string
}

export type PendingRefundRecord = {
  id: string
  orderId: string
  employeePasscode: string
  createdAt: string
}

export type DaySnapshot = {
  dayKey: string
  orders: Order[]
  updatedAt: number
}
