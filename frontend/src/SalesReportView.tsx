import { useCallback, useEffect, useMemo, useState } from 'react'
import { fetchOrders } from './api'
import { downloadCsv, toCsvRow } from './csvExport'
import { escapeHtml, printHtmlDocument } from './printHtml'
import type { Order, PaymentMethodConfig } from './types'
import type { SalesReportSummary } from './reportUtils'
import {
  type DateRangePreset,
  computeSalesReport,
  defaultCustomRangeStrings,
  filterOrdersInRange,
  presetToRange,
} from './reportUtils'
import { useToast } from './Toast'

function centsToRM(cents: number): string {
  return (cents / 100).toFixed(2)
}

function fmtRange(from: Date, to: Date): string {
  const o: Intl.DateTimeFormatOptions = { dateStyle: 'medium' }
  return `${from.toLocaleDateString(undefined, o)} – ${to.toLocaleDateString(undefined, o)}`
}

const PRESETS: Array<{ id: DateRangePreset; label: string }> = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'this_week', label: 'This week' },
  { id: 'last_week', label: 'Last week' },
  { id: 'this_month', label: 'This month' },
  { id: 'last_month', label: 'Last month' },
  { id: 'custom', label: 'Custom range' },
]

function exportSalesReportCsv(
  companyName: string,
  periodLabel: string,
  from: Date,
  to: Date,
  summary: SalesReportSummary,
): void {
  const tag = `${from.toISOString().slice(0, 10)}_${to.toISOString().slice(0, 10)}`
  const lines: string[] = []
  lines.push(toCsvRow(['Sales report', companyName || '—']))
  lines.push(toCsvRow(['Period', periodLabel]))
  lines.push(toCsvRow(['Total sales (RM)', (summary.totalSalesCents / 100).toFixed(2)]))
  lines.push(toCsvRow(['Sale orders', String(summary.saleOrderCount)]))
  lines.push(toCsvRow(['Total discounts (RM)', (summary.totalDiscountCents / 100).toFixed(2)]))
  lines.push(toCsvRow(['Total refunds (RM)', (summary.refundTotalCents / 100).toFixed(2)]))
  lines.push(toCsvRow(['Refund orders', String(summary.refundOrderCount)]))
  lines.push(toCsvRow(['—', '—', '—']))
  lines.push(toCsvRow(['Payment method', 'Orders', 'Total (RM)']))
  for (const r of summary.byPayment) {
    lines.push(toCsvRow([r.label, String(r.orderCount), (r.cents / 100).toFixed(2)]))
  }
  lines.push(toCsvRow(['—', '—', '—']))
  lines.push(toCsvRow(['Product', 'Qty', 'Revenue (RM)']))
  for (const r of summary.products) {
    lines.push(toCsvRow([r.name, String(r.quantity), (r.cents / 100).toFixed(2)]))
  }
  lines.push(toCsvRow(['—', '—', '—']))
  lines.push(toCsvRow(['Add-on', 'Qty', 'Revenue (RM)']))
  for (const r of summary.addOns) {
    lines.push(toCsvRow([r.name, String(r.quantity), (r.cents / 100).toFixed(2)]))
  }
  downloadCsv(`sales-report-${tag}.csv`, lines)
}

function printSalesReport(
  companyName: string,
  periodLabel: string,
  summary: SalesReportSummary,
  centsToRM: (c: number) => string,
): void {
  const payBlocks = summary.byPayment
    .map(
      (r) =>
        `<div class="receipt-block"><div class="receipt-item-name">${escapeHtml(r.label)}</div>
<div class="receipt-line"><span>Orders</span><span>${r.orderCount}</span></div>
<div class="receipt-line"><span>Total</span><span>RM ${escapeHtml(centsToRM(r.cents))}</span></div></div>`,
    )
    .join('<div class="receipt-dash"></div>')
  const prodBlocks = summary.products
    .map(
      (r) =>
        `<div class="receipt-block"><div class="receipt-item-name">${escapeHtml(r.name)}</div>
<div class="receipt-line"><span>Qty</span><span>${r.quantity}</span></div>
<div class="receipt-line"><span>RM</span><span>${escapeHtml(centsToRM(r.cents))}</span></div></div>`,
    )
    .join('<div class="receipt-dash"></div>')
  const addBlocks = summary.addOns
    .map(
      (r) =>
        `<div class="receipt-block"><div class="receipt-item-name">${escapeHtml(r.name)}</div>
<div class="receipt-line"><span>Qty</span><span>${r.quantity}</span></div>
<div class="receipt-line"><span>RM</span><span>${escapeHtml(centsToRM(r.cents))}</span></div></div>`,
    )
    .join('<div class="receipt-dash"></div>')
  const html = `<div class="receipt-title">${escapeHtml(companyName || 'SALES REPORT')}</div>
<div class="receipt-sub">${escapeHtml(periodLabel)}</div>
<div class="receipt-dash"></div>
<div class="receipt-line"><span>Sales total</span><span>RM ${escapeHtml(centsToRM(summary.totalSalesCents))}</span></div>
<div class="receipt-line"><span>Sale orders</span><span>${summary.saleOrderCount}</span></div>
<div class="receipt-line"><span>Discounts</span><span>RM ${escapeHtml(centsToRM(summary.totalDiscountCents))}</span></div>
<div class="receipt-line"><span>Refunds</span><span>RM ${escapeHtml(centsToRM(summary.refundTotalCents))}</span></div>
<div class="receipt-line"><span>Refund orders</span><span>${summary.refundOrderCount}</span></div>
<div class="receipt-dash"></div>
<div class="receipt-section">BY PAYMENT</div>
${payBlocks || '<p class="receipt-muted">None</p>'}
<div class="receipt-dash"></div>
<div class="receipt-section">PRODUCTS</div>
${prodBlocks || '<p class="receipt-muted">None</p>'}
<div class="receipt-dash"></div>
<div class="receipt-section">ADD-ONS</div>
${addBlocks || '<p class="receipt-muted">None</p>'}`
  printHtmlDocument('Sales report', html)
}

export function SalesReportView({
  token,
  paymentMethods,
  companyName = '',
}: {
  token: string
  paymentMethods: PaymentMethodConfig[]
  companyName?: string
}) {
  const showToast = useToast()
  const [preset, setPreset] = useState<DateRangePreset>('today')
  const [customFrom, setCustomFrom] = useState(() => defaultCustomRangeStrings().from)
  const [customTo, setCustomTo] = useState(() => defaultCustomRangeStrings().to)
  const [allOrders, setAllOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  const { from, to } = useMemo(
    () => presetToRange(preset, customFrom, customTo),
    [preset, customFrom, customTo],
  )

  const inRange = useMemo(() => filterOrdersInRange(allOrders, from, to), [allOrders, from, to])

  const summary = useMemo(() => computeSalesReport(inRange, paymentMethods), [inRange, paymentMethods])

  const load = useCallback(async () => {
    try {
      setLoading(true)
      setErr(null)
      const list = await fetchOrders(token, {
        from: from.toISOString(),
        to: to.toISOString(),
      })
      setAllOrders(list)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load orders')
    } finally {
      setLoading(false)
    }
  }, [token, from, to])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (err) showToast(err, 'error')
  }, [err, showToast])

  function selectPreset(id: DateRangePreset) {
    setPreset(id)
    if (id === 'custom') {
      const d = defaultCustomRangeStrings()
      setCustomFrom(d.from)
      setCustomTo(d.to)
    }
  }

  return (
    <div className="card span-full report-page">
      <div className="section-header">
        <h2 className="section-title">Sales report</h2>
        <div className="btn-row" style={{ margin: 0 }}>
          <button type="button" className="btn btn-outline" disabled={loading} onClick={() => void load()}>
            {loading ? 'Loading…' : 'Refresh'}
          </button>
          <button
            type="button"
            className="btn btn-outline"
            disabled={loading || err !== null}
            onClick={() => printSalesReport(companyName, fmtRange(from, to), summary, centsToRM)}
          >
            Print
          </button>
          <button
            type="button"
            className="btn btn-outline"
            disabled={loading || err !== null}
            onClick={() =>
              exportSalesReportCsv(companyName, fmtRange(from, to), from, to, summary)
            }
          >
            Export CSV
          </button>
        </div>
      </div>

      <div className="report-preset-row">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            className={`btn btn-outline report-preset-btn${preset === p.id ? ' report-preset-btn-active' : ''}`}
            onClick={() => selectPreset(p.id)}
          >
            {p.label}
          </button>
        ))}
      </div>

      {preset === 'custom' && (
        <div className="report-custom-dates">
          <div className="form-group" style={{ marginBottom: 0, minWidth: 160 }}>
            <label className="form-label" htmlFor="report-from">
              From
            </label>
            <input
              id="report-from"
              className="form-input"
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
            />
          </div>
          <div className="form-group" style={{ marginBottom: 0, minWidth: 160 }}>
            <label className="form-label" htmlFor="report-to">
              To
            </label>
            <input
              id="report-to"
              className="form-input"
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
            />
          </div>
        </div>
      )}

      <p className="report-range-line">
        <strong>Period:</strong> {fmtRange(from, to)}
      </p>

      {loading && !err && <p className="alert alert-info">Loading orders…</p>}

      {!err && !loading && (
        <>
          <div className="report-kpi-grid">
            <div className="report-kpi">
              <span className="report-kpi-label">Total sales</span>
              <span className="report-kpi-value">RM {centsToRM(summary.totalSalesCents)}</span>
              <span className="report-kpi-meta">{summary.saleOrderCount} orders</span>
            </div>
            <div className="report-kpi report-kpi-discount">
              <span className="report-kpi-label">Total discounts</span>
              <span className="report-kpi-value">RM {centsToRM(summary.totalDiscountCents)}</span>
              <span className="report-kpi-meta">
                {summary.ordersWithDiscountCount > 0
                  ? `${summary.ordersWithDiscountCount} order${summary.ordersWithDiscountCount === 1 ? '' : 's'} with discount`
                  : 'No order-level discounts'}
              </span>
            </div>
            <div className="report-kpi report-kpi-refund">
              <span className="report-kpi-label">Total refunds</span>
              <span className="report-kpi-value">RM {centsToRM(summary.refundTotalCents)}</span>
              <span className="report-kpi-meta">{summary.refundOrderCount} orders</span>
            </div>
          </div>

          <div className="report-tables-grid">
            <div className="report-table-panel">
              <h3 className="report-section-title">By payment method</h3>
              {summary.byPayment.length === 0 ? (
                <p className="empty-state">No sales in this period.</p>
              ) : (
                <div className="report-table-scroll">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Method</th>
                        <th>Orders</th>
                        <th>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.byPayment.map((row) => (
                        <tr key={row.key}>
                          <td>{row.label}</td>
                          <td>{row.orderCount}</td>
                          <td>RM {centsToRM(row.cents)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="report-table-panel">
              <h3 className="report-section-title">Products sold</h3>
              {summary.products.length === 0 ? (
                <p className="empty-state">No line items in this period.</p>
              ) : (
                <div className="report-table-scroll">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Product</th>
                        <th>Qty</th>
                        <th>Revenue</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.products.map((row) => (
                        <tr key={row.key}>
                          <td>{row.name}</td>
                          <td>{row.quantity}</td>
                          <td>RM {centsToRM(row.cents)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="report-table-panel report-table-panel-span">
              <h3 className="report-section-title">Add-ons sold</h3>
              {summary.addOns.length === 0 ? (
                <p className="empty-state">No add-ons in this period.</p>
              ) : (
                <div className="report-table-scroll">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Add-on</th>
                        <th>Qty (line servings)</th>
                        <th>Revenue</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.addOns.map((row) => (
                        <tr key={row.key}>
                          <td>{row.name}</td>
                          <td>{row.quantity}</td>
                          <td>RM {centsToRM(row.cents)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
