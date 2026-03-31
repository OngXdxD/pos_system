const KEY = 'clock-system.default-payment-method.v1'

/** Last default payment method code (mirrors server when synced). */
export function loadDefaultPaymentMethodCode(): string {
  try {
    const raw = window.localStorage.getItem(KEY)
    return typeof raw === 'string' ? raw : ''
  } catch {
    return ''
  }
}

export function saveDefaultPaymentMethodCode(code: string): void {
  try {
    if (!code.trim()) window.localStorage.removeItem(KEY)
    else window.localStorage.setItem(KEY, code.trim())
  } catch {
    /* ignore */
  }
}
