import { useEffect } from 'react'
import { formatOrderDisplay } from './orderDisplay'
import type { CompanyInfo, Order } from './types'

export type PrintVariant = 'both' | 'receipt' | 'kitchen'

export interface PrintJob {
  order: Order
  company: CompanyInfo
  paymentLabel: string
  subtotalCents: number
  discountCents: number
  variant?: PrintVariant
  /** Cash: amount received (for receipt) */
  tenderCents?: number
  /** Cash: change to return (for receipt) */
  changeCents?: number
}

function centsToRM(cents: number): string {
  return (cents / 100).toFixed(2)
}

function fmtWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

export function OrderPrintSlips({
  job,
  onAfterPrint,
}: {
  job: PrintJob | null
  onAfterPrint: () => void
}) {
  useEffect(() => {
    if (!job) return
    const t = window.setTimeout(() => {
      window.print()
      onAfterPrint()
    }, 300)
    return () => window.clearTimeout(t)
  }, [job, onAfterPrint])

  if (!job) return null

  const { order, company, paymentLabel, subtotalCents, discountCents, tenderCents, changeCents } =
    job
  const variant = job.variant ?? 'both'
  const co = company
  const ref = formatOrderDisplay(order)
  const showReceipt = variant === 'both' || variant === 'receipt'
  const showKitchen = variant === 'both' || variant === 'kitchen'

  return (
    <div className="print-slip-root" aria-hidden>
      {showReceipt && (
        <section className={`print-receipt${variant === 'receipt' ? ' print-single' : ''}`}>
          <div className="print-receipt-header">
            <h1 className="print-co-name">{co.companyName || 'Receipt'}</h1>
            {co.registerNumber && <p className="print-co-line">Registration No: {co.registerNumber}</p>}
            {co.address && <p className="print-co-line print-co-multiline">{co.address}</p>}
            {(co.contactNumber || co.email) && (
              <p className="print-co-line">
                {[co.contactNumber, co.email].filter(Boolean).map((item, i) => (
                <span key={i}>
                  {item}
                  <br />
                </span>
              ))}
              </p>
            )}
          </div>
          <div className="print-divider" />
          <p className="print-meta">
            <strong>Order</strong> {ref}
          </p>
          <p className="print-meta">
            <strong>Order Date</strong> {fmtWhen(order.createdAt)}
          </p>
          <p className="print-meta">
            <strong>Payment</strong> {paymentLabel}
          </p>
          <div className="print-divider" />
          <ul className="print-lines">
            {order.lines.map((line, i) => (
              <li key={line.id ?? i} className="print-line-item">
                <span className="print-line-qty">{line.quantity}×</span>
                <span className="print-line-body">
                  <span className="print-line-name">{line.menuItemName}</span>
                  {line.addOns.length > 0 && (
                    <span className="print-line-addons">
                      {' '}
                      + {line.addOns.map((a) => a.optionName).join(', ')}
                    </span>
                  )}
                </span>
                <span className="print-line-price">
                  RM{' '}
                  {centsToRM(
                    (line.basePrice + line.addOns.reduce((s, a) => s + a.price, 0)) * line.quantity,
                  )}
                </span>
              </li>
            ))}
          </ul>
          <div className="print-divider" />
          <div className="print-totals">
            <div className="print-total-row">
              <span>Subtotal</span>
              <span>RM {centsToRM(subtotalCents)}</span>
            </div>
            {discountCents > 0 && (
              <div className="print-total-row print-discount">
                <span>Discount</span>
                <span>−RM {centsToRM(discountCents)}</span>
              </div>
            )}
            <div className="print-total-row print-grand">
              <span>Total</span>
              <span>RM {centsToRM(order.totalCents)}</span>
            </div>
            {(tenderCents != null && tenderCents > 0) || (changeCents != null && changeCents >= 0) ? (
              <>
                {tenderCents != null && tenderCents > 0 && (
                  <div className="print-total-row">
                    <span>Cash received</span>
                    <span>RM {centsToRM(tenderCents)}</span>
                  </div>
                )}
                {changeCents != null && (
                  <div className="print-total-row print-change">
                    <span>Change due</span>
                    <span>RM {centsToRM(Math.max(0, changeCents))}</span>
                  </div>
                )}
              </>
            ) : null}
          </div>
          <p className="print-thanks">Thank you!</p>
        </section>
      )}

      {showKitchen && (
        <section
          className={`print-kitchen${variant === 'both' ? ' print-kitchen-after-receipt' : ''}`}
        >
          <h1 className="print-kitchen-title">KITCHEN ORDER</h1>
          <p className="print-kitchen-meta">
            <strong>Order</strong> {ref}
          </p>
          <p className="print-kitchen-meta">
            <strong>Order Date</strong> {fmtWhen(order.createdAt)}
          </p>
          <div className="print-divider" />
          <ul className="print-kitchen-list">
            {order.lines.map((line, i) => (
              <li key={`k-${line.id ?? i}`} className="print-kitchen-item">
                <div className="print-kitchen-product">
                  {line.quantity}x {line.menuItemName}
                </div>
                {line.addOns.map((a) => (
                  <div key={a.optionId} className="print-kitchen-addon">
                    - {a.optionName}
                  </div>
                ))}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
