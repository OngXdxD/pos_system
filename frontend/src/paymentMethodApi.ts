import type { PaymentMethodConfig } from './types'

/** Values the backend enum allows on orders (see API validation). */
export type ApiPaymentMethod = 'CASH' | 'CARD' | 'OTHER'

export function toApiPaymentMethod(code: string): ApiPaymentMethod {
  const u = code.trim().toUpperCase()
  if (u === 'CASH' || u === 'CARD' || u === 'OTHER') return u
  return 'OTHER'
}

/**
 * When the cashier picks a custom code (e.g. TNG), we send `OTHER` plus this **code** for the API/DB.
 * The UI resolves the display name from Settings via `paymentMethodDetail` (or shows the string if unknown).
 */
export function paymentMethodDetailForApi(
  cashierCode: string,
  apiMethod: ApiPaymentMethod,
): string | undefined {
  if (apiMethod !== 'OTHER') return undefined
  const c = cashierCode.trim()
  if (!c || c.toUpperCase() === 'OTHER') return undefined
  return c
}

/**
 * Show how the customer paid: match `paymentMethodDetail` (usually cashier code like TNG) to Settings,
 * else match `paymentMethod`, else raw strings. `cashierCode` helps right after checkout if the API omits detail.
 */
export function resolvePaymentMethodLabel(
  methods: PaymentMethodConfig[],
  opts: {
    paymentMethod?: string
    paymentMethodDetail?: string
    cashierCode?: string
  },
): string {
  const detail = opts.paymentMethodDetail?.trim()
  if (detail) {
    const byCode = methods.find((p) => p.code.toUpperCase() === detail.toUpperCase())
    if (byCode) return byCode.label
    return detail
  }
  const code = opts.paymentMethod?.trim()
  if (code) {
    const byCode = methods.find((p) => p.code === code)
    if (byCode) return byCode.label
    return code
  }
  const fb = opts.cashierCode?.trim()
  if (fb) return methods.find((p) => p.code === fb)?.label ?? fb
  return '—'
}
