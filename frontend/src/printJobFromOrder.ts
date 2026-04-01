import { resolvePaymentMethodLabel } from './paymentMethodApi'
import type { PrintJob, PrintVariant } from './OrderPrintSlips'
import type { CompanyInfo, Order, PaymentMethodConfig } from './types'

function orderLinesSubtotal(o: Order): number {
  return o.lines.reduce((s, line) => {
    const addOnTotal = line.addOns.reduce((a, x) => a + x.price, 0)
    return s + (line.basePrice + addOnTotal) * line.quantity
  }, 0)
}

/** Browser `window.print()` job when thermal / server print is unavailable. */
export function buildBrowserPrintJob(
  order: Order,
  company: CompanyInfo,
  paymentMethods: PaymentMethodConfig[],
  variant: PrintVariant,
): PrintJob {
  return {
    order,
    company,
    paymentLabel: resolvePaymentMethodLabel(paymentMethods, {
      paymentMethod: order.paymentMethod,
      paymentMethodDetail: order.paymentMethodDetail,
    }),
    subtotalCents: orderLinesSubtotal(order),
    discountCents: order.discountCents ?? 0,
    variant,
    tenderCents: order.tenderCents,
    changeCents:
      order.changeDueCents ??
      (order.tenderCents != null ? Math.max(0, order.tenderCents - order.totalCents) : undefined),
  }
}
