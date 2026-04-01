import type { Order } from '../types'
import type { DaySnapshot, PendingPlaceRecord, PendingRefundRecord } from './types'

const DB_NAME = 'pos-offline-v1'
const DB_VERSION = 1

const STORE_SNAPSHOTS = 'snapshots'
const STORE_PENDING_PLACES = 'pending_places'
const STORE_PENDING_REFUNDS = 'pending_refunds'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'))
    req.onsuccess = () => resolve(req.result)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_SNAPSHOTS)) {
        db.createObjectStore(STORE_SNAPSHOTS, { keyPath: 'dayKey' })
      }
      if (!db.objectStoreNames.contains(STORE_PENDING_PLACES)) {
        db.createObjectStore(STORE_PENDING_PLACES, { keyPath: 'localId' })
      }
      if (!db.objectStoreNames.contains(STORE_PENDING_REFUNDS)) {
        db.createObjectStore(STORE_PENDING_REFUNDS, { keyPath: 'id' })
      }
    }
  })
}

export async function getDaySnapshot(dayKey: string): Promise<DaySnapshot | null> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE_SNAPSHOTS, 'readonly')
    const req = t.objectStore(STORE_SNAPSHOTS).get(dayKey)
    req.onsuccess = () => resolve((req.result as DaySnapshot) ?? null)
    req.onerror = () => reject(req.error)
  })
}

/** Upsert server orders into the day cache by `order.id`. */
export async function mergeOrdersIntoDaySnapshot(dayKey: string, orders: Order[]): Promise<void> {
  const prev = (await getDaySnapshot(dayKey))?.orders ?? []
  const map = new Map<string, Order>()
  for (const o of prev) {
    if (!o.id.startsWith('local:')) map.set(o.id, o)
  }
  for (const o of orders) {
    if (!o.id.startsWith('local:')) map.set(o.id, o)
  }
  const snap: DaySnapshot = {
    dayKey,
    orders: [...map.values()],
    updatedAt: Date.now(),
  }
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE_SNAPSHOTS, 'readwrite')
    t.objectStore(STORE_SNAPSHOTS).put(snap)
    t.oncomplete = () => resolve()
    t.onerror = () => reject(t.error)
  })
}

export async function upsertServerOrderInSnapshot(dayKey: string, order: Order): Promise<void> {
  if (order.id.startsWith('local:')) return
  await mergeOrdersIntoDaySnapshot(dayKey, [order])
}

export async function addPendingPlace(record: PendingPlaceRecord): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE_PENDING_PLACES, 'readwrite')
    t.objectStore(STORE_PENDING_PLACES).put(record)
    t.oncomplete = () => resolve()
    t.onerror = () => reject(t.error)
  })
}

export async function getAllPendingPlaces(): Promise<PendingPlaceRecord[]> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE_PENDING_PLACES, 'readonly')
    const req = t.objectStore(STORE_PENDING_PLACES).getAll()
    req.onsuccess = () => resolve((req.result as PendingPlaceRecord[]) ?? [])
    req.onerror = () => reject(req.error)
  })
}

export async function deletePendingPlace(localId: string): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE_PENDING_PLACES, 'readwrite')
    t.objectStore(STORE_PENDING_PLACES).delete(localId)
    t.oncomplete = () => resolve()
    t.onerror = () => reject(t.error)
  })
}

export async function updatePendingPlaceRefund(localId: string, passcode: string): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE_PENDING_PLACES, 'readwrite')
    const store = t.objectStore(STORE_PENDING_PLACES)
    const getReq = store.get(localId)
    getReq.onsuccess = () => {
      const rec = getReq.result as PendingPlaceRecord | undefined
      if (!rec) {
        t.abort()
        reject(new Error('Pending order not found'))
        return
      }
      const putReq = store.put({
        ...rec,
        refundPasscode: passcode,
        order: { ...rec.order, status: 'REFUNDED' as const },
      })
      putReq.onerror = () => reject(putReq.error)
    }
    getReq.onerror = () => reject(getReq.error)
    t.oncomplete = () => resolve()
    t.onerror = () => reject(t.error)
  })
}

export async function addPendingRefund(record: PendingRefundRecord): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE_PENDING_REFUNDS, 'readwrite')
    t.objectStore(STORE_PENDING_REFUNDS).put(record)
    t.oncomplete = () => resolve()
    t.onerror = () => reject(t.error)
  })
}

export async function getAllPendingRefunds(): Promise<PendingRefundRecord[]> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE_PENDING_REFUNDS, 'readonly')
    const req = t.objectStore(STORE_PENDING_REFUNDS).getAll()
    req.onsuccess = () => resolve((req.result as PendingRefundRecord[]) ?? [])
    req.onerror = () => reject(req.error)
  })
}

export async function deletePendingRefund(id: string): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE_PENDING_REFUNDS, 'readwrite')
    t.objectStore(STORE_PENDING_REFUNDS).delete(id)
    t.oncomplete = () => resolve()
    t.onerror = () => reject(t.error)
  })
}

export async function countPendingOutbox(): Promise<number> {
  const [p, r] = await Promise.all([getAllPendingPlaces(), getAllPendingRefunds()])
  return p.length + r.length
}
