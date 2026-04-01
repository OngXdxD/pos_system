import { useEffect, useRef, useState } from 'react'
import { formatLineAddOnsSummary, formatOrderDisplay } from './orderDisplay'
import type { ThermalPaperWidth } from './thermalReceiptStore'
import type { CompanyInfo, Order } from './types'

export type PrintVariant = 'both' | 'both-split' | 'receipt' | 'kitchen'

export const KITCHEN_AFTER_RECEIPT_MS = 2000

export interface PrintJob {
  order: Order
  company: CompanyInfo
  paymentLabel: string
  subtotalCents: number
  discountCents: number
  variant?: PrintVariant
  tenderCents?: number
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

/** Browser print for offline POS (receipt + kitchen split). */
export function OrderPrintSlips({
  job,
  onAfterPrint,
  paperWidth,
}: {
  job: PrintJob | null
  onAfterPrint: () => void
  paperWidth: ThermalPaperWidth
}) {
  const [splitPhase, setSplitPhase] = useState<'receipt' | 'kitchen'>('receipt')
  const kitchenDelayRef = useRef<number | null>(null)

  useEffect(() => {
    if (job?.variant === 'both-split') setSplitPhase('receipt')
  }, [job?.order.id, job?.variant])

  useEffect(() => {
    return () => {
      if (kitchenDelayRef.current != null) {
        window.clearTimeout(kitchenDelayRef.current)
        kitchenDelayRef.current = null
      }
    }
  }, [job?.order.id])

  useEffect(() => {
    if (!job) return

    const variant = job.variant ?? 'both'
    const isSplit = variant === 'both-split'

    let cleaned = false
    let fallbackHandle: number | undefined
    let done = false

    const finish = () => {
      if (cleaned || done) return
      done = true
      window.removeEventListener('afterprint', afterPrintHandler)
      if (fallbackHandle !== undefined) window.clearTimeout(fallbackHandle)

      if (isSplit && splitPhase === 'receipt') {
        kitchenDelayRef.current = window.setTimeout(() => {
          kitchenDelayRef.current = null
          setSplitPhase('kitchen')
        }, KITCHEN_AFTER_RECEIPT_MS)
        return
      }

      onAfterPrint()
    }

    function afterPrintHandler() {
      finish()
    }

    const printScheduled = window.setTimeout(() => {
      if (cleaned) return
      window.addEventListener('afterprint', afterPrintHandler)
      window.print()
      fallbackHandle = window.setTimeout(finish, 120_000)
    }, 300)

    return () => {
      cleaned = true
      window.clearTimeout(printScheduled)
      if (fallbackHandle !== undefined) window.clearTimeout(fallbackHandle)
      window.removeEventListener('afterprint', afterPrintHandler)
    }
  }, [job, splitPhase, onAfterPrint])

  if (!job) return null

  const { order, company, paymentLabel, subtotalCents, discountCents, tenderCents, changeCents } =
    job
  const variant = job.variant ?? 'both'
  const isSplit = variant === 'both-split'
  const co = company
  const ref = formatOrderDisplay(order)
  const showReceipt = isSplit ? splitPhase === 'receipt' : variant === 'both' || variant === 'receipt'
  const showKitchen = isSplit ? splitPhase === 'kitchen' : variant === 'both' || variant === 'kitchen'

  const paperClass = paperWidth === '80' ? 'print-paper-80' : 'print-paper-58'

  return (
    <div className={`print-slip-root ${paperClass}`} aria-hidden>
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
          <p className="print-meta print-meta-inline">
            <strong className="print-meta-k">Order:</strong>{' '}
            <span className="print-meta-v">{ref}</span>
          </p>
          <p className="print-meta print-meta-inline">
            <strong className="print-meta-k">Order date:</strong>{' '}
            <span className="print-meta-v">{fmtWhen(order.createdAt)}</span>
          </p>
          <p className="print-meta print-meta-inline">
            <strong className="print-meta-k">Payment:</strong>{' '}
            <span className="print-meta-v">{paymentLabel}</span>
          </p>
          <div className="print-divider" />
          <ul className="print-lines">
            {order.lines.map((line, i) => (
              <li key={line.id ?? i} className="print-line-item">
                <div className="print-line-main">
                  <span className="print-line-qty">{line.quantity}×</span>
                  <span className="print-line-body">
                    <span className="print-line-name">{line.menuItemName}</span>
                    {line.addOns.length > 0 && (
                      <span className="print-line-addons">
                        {' '}
                        + {formatLineAddOnsSummary(line.addOns)}
                      </span>
                    )}
                  </span>
                </div>
                <div className="print-line-price">
                  RM{' '}
                  {centsToRM(
                    (line.basePrice + line.addOns.reduce((s, a) => s + a.price, 0)) * line.quantity,
                  )}
                </div>
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
          className={`print-kitchen${variant === 'both' ? ' print-kitchen-after-receipt' : ''}${isSplit ? ' print-kitchen-split' : ''}`}
        >
          <h1 className="print-kitchen-title">KITCHEN ORDER</h1>
          <p className="print-kitchen-meta print-meta-inline">
            <strong className="print-meta-k">Order:</strong>{' '}
            <span className="print-meta-v">{ref}</span>
          </p>
          <p className="print-kitchen-meta print-meta-inline">
            <strong className="print-meta-k">Order date:</strong>{' '}
            <span className="print-meta-v">{fmtWhen(order.createdAt)}</span>
          </p>
          <div className="print-divider" />
          <ul className="print-kitchen-list">
            {order.lines.map((line, i) => (
              <li key={`k-${line.id ?? i}`} className="print-kitchen-item">
                <div className="print-kitchen-product">
                  {line.quantity}x {line.menuItemName}
                </div>
                {line.addOns.map((a, idx) => (
                  <div key={`${a.optionId}-${idx}`} className="print-kitchen-addon">
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
