import { useCallback, useEffect, useMemo, useState } from 'react'
import { defaultCustomRangeStrings, parseLocalDateInput } from './reportUtils'
import {
  changeOrderPaymentMethod,
  fetchOrdersPage,
  refundOrder,
  requestOrderThermalPrint,
} from './api'
import { formatOrderDisplay } from './orderDisplay'
import { downloadCsv, toCsvRow } from './csvExport'
import {
  paymentMethodDetailForApi,
  resolvePaymentMethodLabel,
  toApiPaymentMethod,
} from './paymentMethodApi'
import { useToast } from './Toast'
import type { Order, OrderStatus, PaymentMethodConfig } from './types'

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

const PAGE_SIZE = 10
const EXPORT_PAGE_SIZE = 300

export function OrderHistoryView({
  token,
  paymentMethods,
}: {
  token: string
  paymentMethods: PaymentMethodConfig[]
}) {
  const showToast = useToast()
  const [orders, setOrders] = useState<Order[]>([])
  const [historyDay, setHistoryDay] = useState(() => defaultCustomRangeStrings().from)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [actionKind, setActionKind] = useState<ActionKind>(null)
  const [actionOrder, setActionOrder] = useState<Order | null>(null)
  const [newPaymentCode, setNewPaymentCode] = useState('')
  const [passcode, setPasscode] = useState('')
  const [actionBusy, setActionBusy] = useState(false)
  const [actionFeedback, setActionFeedback] = useState<{ ok: boolean; text: string } | null>(null)
  const [thermalSlipBusy, setThermalSlipBusy] = useState(false)
  const [page, setPage] = useState(0)
  const [totalCount, setTotalCount] = useState<number | null>(null)
  const [exportBusy, setExportBusy] = useState(false)

  const handleThermalSlipPrint = useCallback(
    async (o: Order, variant: 'receipt' | 'kitchen') => {
      try {
        setThermalSlipBusy(true)
        await requestOrderThermalPrint(o.id, token, variant)
        showToast('Server print requested.', 'success')
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'Server print failed', 'error')
      } finally {
        setThermalSlipBusy(false)
      }
    },
    [showToast, token],
  )

  const load = useCallback(async () => {
    const fromD = parseLocalDateInput(historyDay, false)
    const toD = parseLocalDateInput(historyDay, true)
    try {
      setLoading(true)
      setErr(null)
      const { orders: list, total } = await fetchOrdersPage(token, {
        from: fromD.toISOString(),
        to: toD.toISOString(),
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      })
      setOrders(list)
      setTotalCount(total)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load orders')
    } finally {
      setLoading(false)
    }
  }, [token, historyDay, page])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    setPage(0)
  }, [historyDay])

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

  const hasPrev = page > 0
  const hasNext =
    totalCount != null ? (page + 1) * PAGE_SIZE < totalCount : sorted.length === PAGE_SIZE
  const rangeLabel = (() => {
    if (sorted.length > 0) {
      if (totalCount != null) {
        return `Showing ${page * PAGE_SIZE + 1}–${page * PAGE_SIZE + sorted.length} of ${totalCount}`
      }
      const more = sorted.length === PAGE_SIZE ? ' · more may exist' : ''
      return `Page ${page + 1} · ${sorted.length} order${sorted.length === 1 ? '' : 's'}${more}`
    }
    if (page > 0) return `Page ${page + 1} (empty)`
    return ''
  })()

  async function exportOrdersCsv() {
    const fromD = parseLocalDateInput(historyDay, false)
    const toD = parseLocalDateInput(historyDay, true)
    const from = fromD.toISOString()
    const to = toD.toISOString()
    try {
      setExportBusy(true)
      const all: Order[] = []
      let offset = 0
      for (let guard = 0; guard < 500; guard++) {
        const { orders: chunk } = await fetchOrdersPage(token, {
          from,
          to,
          limit: EXPORT_PAGE_SIZE,
          offset,
        })
        all.push(...chunk)
        if (chunk.length < EXPORT_PAGE_SIZE) break
        offset += EXPORT_PAGE_SIZE
      }
      const sortedExport = [...all].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      )
      const lines = [
        toCsvRow(['Order', 'Created (ISO)', 'Total (RM)', 'Status', 'Payment', 'Order ID']),
      ]
      for (const o of sortedExport) {
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
      showToast(`Exported ${sortedExport.length} order(s).`, 'success')
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Export failed', 'error')
    } finally {
      setExportBusy(false)
    }
  }

  return (
    <div className="card span-full">
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
          <button
            type="button"
            className="btn btn-outline"
            disabled={loading || exportBusy}
            onClick={() => void exportOrdersCsv()}
          >
            {exportBusy ? 'Exporting…' : 'Export CSV'}
          </button>
        </div>
      </div>

      {!err && !loading && sorted.length === 0 && page === 0 && (
        <p className="empty-state">No orders on {historyDayLabel}.</p>
      )}

      {!err && !loading && sorted.length === 0 && page > 0 && (
        <p className="empty-state">No orders on this page. Try the previous page.</p>
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
                          disabled={thermalSlipBusy}
                          onClick={() => void handleThermalSlipPrint(o, 'receipt')}
                        >
                          Receipt
                        </button>
                        <button
                          type="button"
                          className="btn btn-outline"
                          style={{ padding: '4px 8px', fontSize: 12 }}
                          disabled={thermalSlipBusy}
                          onClick={() => void handleThermalSlipPrint(o, 'kitchen')}
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

      {(sorted.length > 0 || page > 0) && (
        <div className="order-history-pagination" aria-label="Order list pages">
          <button
            type="button"
            className="btn btn-outline btn-sm"
            disabled={loading || !hasPrev}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            Previous
          </button>
          <span className="order-history-page-meta">{rangeLabel}</span>
          <button
            type="button"
            className="btn btn-outline btn-sm"
            disabled={loading || !hasNext}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </button>
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
