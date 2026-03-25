import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  changeOrderPaymentMethod,
  fetchOrders,
  refundOrder,
} from './api'
import { formatOrderDisplay } from './orderDisplay'
import { OrderPrintSlips, type PrintJob } from './OrderPrintSlips'
import {
  paymentMethodDetailForApi,
  resolvePaymentMethodLabel,
  toApiPaymentMethod,
} from './paymentMethodApi'
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
  const [orders, setOrders] = useState<Order[]>([])
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

  async function load() {
    try {
      setLoading(true)
      setErr(null)
      const list = await fetchOrders(token)
      setOrders(list)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load orders')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [token])

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
      setActionFeedback({ ok: false, text: 'Enter a valid 4-digit passcode' })
      return
    }
    try {
      setActionBusy(true)
      setActionFeedback(null)
      if (actionKind === 'refund') {
        const updated = await refundOrder(actionOrder.id, pc, token)
        setOrders((prev) => prev.map((x) => (x.id === updated.id ? updated : x)))
        setActionFeedback({
          ok: true,
          text: 'Refund recorded. Verifier identity should be stored on the server.',
        })
      } else {
        if (!newPaymentCode) {
          setActionFeedback({ ok: false, text: 'Choose a payment method' })
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
        setActionFeedback({
          ok: true,
          text: 'Payment method updated. Verifier identity should be stored on the server.',
        })
      }
      setTimeout(closeAction, 1600)
    } catch (e) {
      setActionFeedback({ ok: false, text: e instanceof Error ? e.message : 'Request failed' })
    } finally {
      setActionBusy(false)
    }
  }

  const sorted = useMemo(
    () => [...orders].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [orders],
  )

  return (
    <div className="card span-full">
      <OrderPrintSlips job={printJob} onAfterPrint={finishPrint} />

      <div className="section-header">
        <h2 className="section-title">Order history</h2>
        <button type="button" className="btn btn-outline" disabled={loading} onClick={() => void load()}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      <p style={{ fontSize: 13, opacity: 0.65, marginBottom: 14 }}>
        Reprint receipts or kitchen tickets. <strong>Refund</strong> and <strong>change payment</strong> require{' '}
        <strong>any active employee&apos;s 4-digit passcode</strong> (not only the logged-in user) — the backend
        should record who verified each action.
      </p>

      {err && <p className="alert alert-error">{err}</p>}
      {!err && !loading && sorted.length === 0 && (
        <p className="empty-state">No orders yet.</p>
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
                              Change pay
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
            {actionKind === 'refund' && (
              <p style={{ fontSize: 13 }}>
                Refunds cannot be undone. Enter the passcode of the employee authorizing this refund (can be
                different from who is logged in).
              </p>
            )}
            {actionKind === 'payment' && (
              <>
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
                <p style={{ fontSize: 13 }}>
                  Enter the passcode of the employee authorizing this change (can be different from who is logged
                  in).
                </p>
              </>
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
            {actionFeedback && (
              <p className={actionFeedback.ok ? 'alert alert-success' : 'alert alert-error'}>
                {actionFeedback.text}
              </p>
            )}
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
