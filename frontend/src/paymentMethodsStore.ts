import type { PaymentMethodConfig } from './types'

const KEY = 'clock-system.payment-methods.v1'

export const DEFAULT_PAYMENT_METHODS: PaymentMethodConfig[] = [
  { id: 'pm-default-cash', label: 'Cash', code: 'CASH' },
  { id: 'pm-default-card', label: 'Card', code: 'CARD' },
]

export function loadPaymentMethods(): PaymentMethodConfig[] {
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return [...DEFAULT_PAYMENT_METHODS]
    const parsed = JSON.parse(raw) as PaymentMethodConfig[]
    if (!Array.isArray(parsed) || parsed.length === 0) return [...DEFAULT_PAYMENT_METHODS]
    return parsed.map((p) => ({
      id: typeof p.id === 'string' ? p.id : crypto.randomUUID(),
      label: String(p.label ?? '').trim() || 'Unnamed',
      code: String(p.code ?? '')
        .trim()
        .toUpperCase()
        .replace(/\s+/g, '_') || 'CUSTOM',
    }))
  } catch {
    return [...DEFAULT_PAYMENT_METHODS]
  }
}

export function savePaymentMethods(methods: PaymentMethodConfig[]) {
  window.localStorage.setItem(KEY, JSON.stringify(methods))
}
