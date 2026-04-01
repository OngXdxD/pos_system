import type { Order } from '../types'
import { fetchOrdersPage } from '../api'
import { getAllPendingPlaces, getDaySnapshot, mergeOrdersIntoDaySnapshot } from './db'

const PREFETCH_CHUNK = 100

/** Download all pages for the day and merge into the local server snapshot (online only). */
export async function prefetchDayFromServer(
  token: string,
  dayKey: string,
  fromIso: string,
  toIso: string,
): Promise<void> {
  let offset = 0
  for (let guard = 0; guard < 200; guard++) {
    const { orders } = await fetchOrdersPage(token, {
      from: fromIso,
      to: toIso,
      limit: PREFETCH_CHUNK,
      offset,
    })
    await mergeOrdersIntoDaySnapshot(dayKey, orders)
    if (orders.length < PREFETCH_CHUNK) break
    offset += PREFETCH_CHUNK
  }
}

/** Snapshot (server-cached) + unsynced places for this calendar day, sorted newest first, paginated. */
/** All merged orders for a day (CSV / offline export). */
export async function getMergedOrdersForExport(dayKey: string): Promise<Order[]> {
  const snap = await getDaySnapshot(dayKey)
  const base = snap?.orders ?? []
  const pending = await getAllPendingPlaces()
  const pendingForDay = pending.filter((p) => p.dayKey === dayKey).map((p) => p.order)
  const map = new Map<string, Order>()
  for (const o of base) map.set(o.id, o)
  for (const o of pendingForDay) map.set(o.id, o)
  return [...map.values()].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  )
}

export async function getMergedOrdersPage(
  dayKey: string,
  page: number,
  pageSize: number,
): Promise<{ orders: Order[]; total: number }> {
  const snap = await getDaySnapshot(dayKey)
  const base = snap?.orders ?? []
  const pending = await getAllPendingPlaces()
  const pendingForDay = pending.filter((p) => p.dayKey === dayKey).map((p) => p.order)

  const map = new Map<string, Order>()
  for (const o of base) {
    map.set(o.id, o)
  }
  for (const o of pendingForDay) {
    map.set(o.id, o)
  }

  const list = [...map.values()].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  )
  const total = list.length
  const orders = list.slice(page * pageSize, (page + 1) * pageSize)
  return { orders, total }
}
