const KEY = 'clock-system.auto-complete-new-orders.v1'

/** When true, POST /orders should result in COMPLETED; when false, PENDING (backend decides). */
export function loadAutoCompleteNewOrders(): boolean {
  try {
    const raw = window.localStorage.getItem(KEY)
    if (raw === null) return true
    return raw === '1' || raw === 'true'
  } catch {
    return true
  }
}

export function saveAutoCompleteNewOrders(value: boolean): void {
  try {
    window.localStorage.setItem(KEY, value ? '1' : '0')
  } catch {
    /* ignore */
  }
}
