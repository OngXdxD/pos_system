import { useCallback, useEffect, useMemo, useState } from 'react'
import { defaultCustomRangeStrings, filterOrdersInRange, parseLocalDateInput } from './reportUtils'
import {
  changeOrderPaymentMethod,
  fetchOrders,
  refundOrder,
} from './api'
import { formatOrderDisplay } from './orderDisplay'
import { OrderPrintSlips, type PrintJob } from './OrderPrintSlips'
import { downloadCsv, toCsvRow } from './csvExport'
import {
  paymentMethodDetailForApi,
  resolvePaymentMethodLabel,
  toApiPaymentMethod,
} from './paymentMethodApi'
import { escapeHtml, printHtmlDocument } from './printHtml'
import { useToast } from './Toast'
import type { CompanyInfo, Order, OrderStatus, PaymentMethodConfig } from './types'

function centsToRM(cents: number): string {
  return (cents / 100).toFixed(2)
}

function fmt(iso: string): string {
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

function orderLinesSubtotal(order: Order): number {
  return order.lines.reduce(
    (s, l) => s + (l.basePrice + l.addOns.reduce((a, x) => a + x.price, 0)) * l.quantity,
    0,
  )
}

const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  COMPLETED: 'Completed',
  REFUNDED: 'Refunded',
  CANCELLED: 'Cancelled',
  PENDING: 'Pending',
}

function orderStatusLabel(s: OrderStatus): string {
  return ORDER_STATUS_LABEL[s]
}

/** `YYYY-MM-DD` for `<input type="date">` in the device local calendar. */
function localTodayYmd(): string {
  const t = new Date()
  const y = t.getFullYear()
  const m = String(t.getMonth() + 1).padStart(2, '0')
  const d = String(t.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function formatHistoryDayLabel(ymd: string): string {
  try {
    return parseLocalDateInput(ymd, false).toLocaleDateString(undefined, {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
  } catch {
    return ymd
  }
}

function resolvePaymentCodeForEdit(o: Order, methods: PaymentMethodConfig[]): string {
  const code = o.paymentMethod
  if (!code) return methods[0]?.code ?? ''
  if (methods.some((p) => p.code === code)) return code
  if (code === 'OTHER' && o.paymentMethodDetail?.trim()) {
    const d = o.paymentMethodDetail.trim()
    const byCode = methods.find((p) => p.code.toUpperCase() === d.toUpperCase())
    if (byCode) return byCode.code
    const byLabel = methods.find((p) => p.label.trim() === d)
    if (byLabel) return byLabel.code
  }
  return methods.find((p) => p.code.toUpperCase() === 'OTHER')?.code ?? methods[0]?.code ?? ''
}

type ActionKind = 'refund' | 'payment' | null

export function OrderHistoryView({
  token,
  companyInfo,
  paymentMethods,
}: {
  token: string
  companyInfo: CompanyInfo
  paymentMethods: PaymentMethodConfig[]
}) {
  const showToast = useToast()
  const [orders, setOrders] = useState<Order[]>([])
  const [historyDay, setHistoryDay] = useState(() => defaultCustomRangeStrings().from)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [printJob, setPrintJob] = useState<PrintJob | null>(null)

  const [actionKind, setActionKind] = useState<ActionKind>(null)
  const [actionOrder, setActionOrder] = useState<Order | null>(null)
  const [newPaymentCode, setNewPaymentCode] = useState('')
  const [passcode, setPasscode] = useState('')
  const [actionBusy, setActionBusy] = useState(false)
  const [actionFeedback, setActionFeedback] = useState<{ ok: boolean; text: string } | null>(null)

  const finishPrint = useCallback(() => setPrintJob(null), [])

  const load = useCallback(async () => {
    const fromD = parseLocalDateInput(historyDay, false)
    const toD = parseLocalDateInput(historyDay, true)
    try {
      setLoading(true)
      setErr(null)
      const list = await fetchOrders(token, {
        from: fromD.toISOString(),
        to: toD.toISOString(),
      })
      setOrders(filterOrdersInRange(list, fromD, toD))
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load orders')
    } finally {
      setLoading(false)
    }
  }, [token, historyDay])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (err) showToast(err, 'error')
  }, [err, showToast])

  function openRefund(o: Order) {
    setActionOrder(o)
    setActionKind('refund')
    setPasscode('')
    setActionFeedback(null)
  }

  function openChangePayment(o: Order) {
    setActionOrder(o)
    setActionKind('payment')
    setNewPaymentCode(resolvePaymentCodeForEdit(o, paymentMethods))
    setPasscode('')
    setActionFeedback(null)
  }

  function closeAction() {
    setActionKind(null)
    setActionOrder(null)
    setPasscode('')
    setActionFeedback(null)
  }

  function buildPrintJob(
    o: Order,
    variant: 'receipt' | 'kitchen',
  ): PrintJob {
    const sub = orderLinesSubtotal(o)
    const disc = o.discountCents ?? 0
    const tender = o.tenderCents
    const change =
      o.changeDueCents ??
      (tender != null ? Math.max(0, tender - o.totalCents) : undefined)
    return {
      order: o,
      company: companyInfo,
      paymentLabel: resolvePaymentMethodLabel(paymentMethods, {
        paymentMethod: o.paymentMethod,
        paymentMethodDetail: o.paymentMethodDetail,
      }),
      subtotalCents: sub,
      discountCents: disc,
      variant,
      tenderCents: tender,
      changeCents: change,
    }
  }

  async function submitAction() {
    if (!actionOrder || !actionKind) return
    const pc = passcode.replace(/\D/g, '').slice(0, 4)
    if (pc.length !== 4) {
      showToast('Enter a valid 4-digit passcode', 'error')
      return
    }
    try {
      setActionBusy(true)
      setActionFeedback(null)
      if (actionKind === 'refund') {
        const updated = await refundOrder(actionOrder.id, pc, token)
        setOrders((prev) => prev.map((x) => (x.id === updated.id ? updated : x)))
        setActionFeedback({ ok: true, text: 'Refund recorded.' })
      } else {
        if (!newPaymentCode) {
          showToast('Choose a payment method', 'error')
          setActionBusy(false)
          return
        }
        const apiPay = toApiPaymentMethod(newPaymentCode)
        const detail = paymentMethodDetailForApi(newPaymentCode, apiPay)
        const updated = await changeOrderPaymentMethod(
          actionOrder.id,
          { employeePasscode: pc, paymentMethod: apiPay, paymentMethodDetail: detail },
          token,
        )
        setOrders((prev) => prev.map((x) => (x.id === updated.id ? updated : x)))
        setActionFeedback({ ok: true, text: 'Payment updated.' })
      }
      setTimeout(closeAction, 1600)
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Request failed', 'error')
    } finally {
      setActionBusy(false)
    }
  }

  const sorted = useMemo(
    () => [...orders].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [orders],
  )

  const historyDayLabel = useMemo(() => formatHistoryDayLabel(historyDay), [historyDay])
  const isToday = historyDay === localTodayYmd()

  function exportOrdersCsv() {
    const lines = [
      toCsvRow(['Order', 'Created (ISO)', 'Total (RM)', 'Status', 'Payment', 'Order ID']),
    ]
    for (const o of sorted) {
      lines.push(
        toCsvRow([
          formatOrderDisplay(o),
          o.createdAt,
          centsToRM(o.totalCents),
          orderStatusLabel(o.status),
          resolvePaymentMethodLabel(paymentMethods, {
            paymentMethod: o.paymentMethod,
            paymentMethodDetail: o.paymentMethodDetail,
          }),
          o.id,
        ]),
      )
    }
    downloadCsv(`orders-${historyDay}.csv`, lines)
  }

  function printOrderList() {
    const co = companyInfo.companyName?.trim() || 'Order history'
    const blocks = sorted
      .map((o) => {
        const pay = resolvePaymentMethodLabel(paymentMethods, {
          paymentMethod: o.paymentMethod,
          paymentMethodDetail: o.paymentMethodDetail,
        })
        return `<div class="receipt-block">
<div class="receipt-line"><span>Order</span><span>${escapeHtml(formatOrderDisplay(o))}</span></div>
<div class="receipt-line"><span>Time</span><span>${escapeHtml(fmt(o.createdAt))}</span></div>
<div class="receipt-line"><span>Total</span><span>RM ${escapeHtml(centsToRM(o.totalCents))}</span></div>
<div class="receipt-line"><span>Status</span><span>${escapeHtml(orderStatusLabel(o.status))}</span></div>
<div class="receipt-line"><span>Pay</span><span>${escapeHtml(pay)}</span></div>
</div><div class="receipt-dash"></div>`
      })
      .join('')
    const html = `<div class="receipt-title">${escapeHtml(co)}</div>
<div class="receipt-sub">${escapeHtml(historyDayLabel)} · ${sorted.length} order(s)</div>
<div class="receipt-dash"></div>
${blocks || '<p class="receipt-muted">No orders</p>'}`
    printHtmlDocument('Order history', html)
  }

  return (
    <div className="card span-full">
      <OrderPrintSlips job={printJob} onAfterPrint={finishPrint} />

      <div className="section-header">
        <h2 className="section-title">Order history</h2>
        <div className="btn-row" style={{ margin: 0, flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
          <label className="form-label" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ whiteSpace: 'nowrap' }}>Day</span>
            <input
              className="form-input"
              type="date"
              value={historyDay}
              onChange={(e) => setHistoryDay(e.target.value)}
              disabled={loading}
              style={{ width: 'auto', minWidth: 140 }}
            />
          </label>
          <button
            type="button"
            className="btn btn-outline"
            disabled={loading || isToday}
            onClick={() => setHistoryDay(localTodayYmd())}
          >
            Today
          </button>
          <button type="button" className="btn btn-outline" disabled={loading} onClick={() => void load()}>
            {loading ? 'Loading…' : 'Refresh'}
          </button>
          <button type="button" className="btn btn-outline" disabled={loading || sorted.length === 0} onClick={printOrderList}>
            Print list
          </button>
          <button type="button" className="btn btn-outline" disabled={loading || sorted.length === 0} onClick={exportOrdersCsv}>
            Export CSV
          </button>
        </div>
      </div>

      {!err && !loading && sorted.length === 0 && (
        <p className="empty-state">No orders on {historyDayLabel}.</p>
      )}

      {sorted.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Order</th>
                <th>Date</th>
                <th>Total</th>
                <th>Status</th>
                <th>Payment</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((o) => {
                const canModify = o.status !== 'REFUNDED' && o.status !== 'CANCELLED'
                return (
                  <tr key={o.id}>
                    <td>
                      <strong>{formatOrderDisplay(o)}</strong>
                    </td>
                    <td>{fmt(o.createdAt)}</td>
                    <td>RM {centsToRM(o.totalCents)}</td>
                    <td>{orderStatusLabel(o.status)}</td>
                    <td>
                      {resolvePaymentMethodLabel(paymentMethods, {
                        paymentMethod: o.paymentMethod,
                        paymentMethodDetail: o.paymentMethodDetail,
                      })}
                    </td>
                    <td>
                      <div className="btn-row" style={{ margin: 0, flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          className="btn btn-outline"
                          style={{ padding: '4px 8px', fontSize: 12 }}
                          onClick={() => setPrintJob(buildPrintJob(o, 'receipt'))}
                        >
                          Receipt
                        </button>
                        <button
                          type="button"
                          className="btn btn-outline"
                          style={{ padding: '4px 8px', fontSize: 12 }}
                          onClick={() => setPrintJob(buildPrintJob(o, 'kitchen'))}
                        >
                          Kitchen
                        </button>
                        {canModify && (
                          <>
                            <button
                              type="button"
                              className="btn btn-outline"
                              style={{ padding: '4px 8px', fontSize: 12 }}
                              onClick={() => openChangePayment(o)}
                            >
                              Change Payment Method
                            </button>
                            <button
                              type="button"
                              className="btn btn-danger"
                              style={{ padding: '4px 8px', fontSize: 12 }}
                              onClick={() => openRefund(o)}
                            >
                              Refund
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {actionKind && actionOrder && (
        <div className="order-modal-backdrop" onClick={closeAction}>
          <div className="order-modal" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0, color: 'var(--major-color)' }}>
              {actionKind === 'refund' ? 'Refund order' : 'Change payment method'}
            </h3>
            <p style={{ fontSize: 14, opacity: 0.75 }}>
              Order <strong>{formatOrderDisplay(actionOrder)}</strong> · RM{' '}
              {centsToRM(actionOrder.totalCents)}
            </p>
            {actionKind === 'payment' && (
              <div className="form-group">
                <label className="form-label">New payment method</label>
                <select
                  className="form-input form-select"
                  value={newPaymentCode}
                  onChange={(e) => setNewPaymentCode(e.target.value)}
                >
                  {paymentMethods.map((p) => (
                    <option key={p.id} value={p.code}>
                      {p.label} ({p.code})
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="form-group">
              <label className="form-label">Employee passcode (4 digits)</label>
              <input
                className="form-input"
                type="password"
                inputMode="numeric"
                maxLength={4}
                placeholder="····"
                value={passcode}
                onChange={(e) => setPasscode(e.target.value.replace(/\D/g, '').slice(0, 4))}
                autoFocus
              />
            </div>
            {actionFeedback?.ok && <p className="alert alert-success">{actionFeedback.text}</p>}
            <div className="btn-row">
              <button type="button" className="btn btn-outline" onClick={closeAction} disabled={actionBusy}>
                Cancel
              </button>
              <button
                type="button"
                className={actionKind === 'refund' ? 'btn btn-danger' : 'btn btn-primary'}
                disabled={actionBusy}
                onClick={() => void submitAction()}
              >
                {actionBusy ? 'Please wait…' : actionKind === 'refund' ? 'Confirm refund' : 'Save payment'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
