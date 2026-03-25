import { useCallback, useEffect, useMemo, useState } from 'react'
import { fetchAllTimeEntries, fetchTimeEntries } from './api'
import { downloadCsv, toCsvRow } from './csvExport'
import { buildIdToNameMap, timesheetEmployeeDisplayName } from './employeeDisplay'
import { escapeHtml, printHtmlDocument } from './printHtml'
import { useToast } from './Toast'
import type { Employee, TimeEntry } from './types'

function fmt(iso: string | null): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

function durationLabel(clockInAt: string, clockOutAt: string | null): string {
  if (!clockOutAt) return 'Open'
  const a = new Date(clockInAt).getTime()
  const b = new Date(clockOutAt).getTime()
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return '—'
  const m = Math.floor((b - a) / 60000)
  const h = Math.floor(m / 60)
  const mm = m % 60
  if (h > 0) return `${h}h ${mm}m`
  return `${mm}m`
}

export function TimesheetView({
  token,
  isAdmin,
  employeeId,
  employees,
}: {
  token: string
  isAdmin: boolean
  /** Logged-in user (for fetching own rows when not admin). */
  employeeId: string
  /** Roster from GET /employees + session merges — used to show names instead of UUIDs. */
  employees: Employee[]
}) {
  const showToast = useToast()
  const [rows, setRows] = useState<TimeEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  const idToName = useMemo(() => buildIdToNameMap(employees), [employees])

  function rowName(e: TimeEntry): string {
    return timesheetEmployeeDisplayName(e.employeeId, e.employeeName, idToName)
  }

  const load = useCallback(async () => {
    try {
      setLoading(true)
      setErr(null)
      if (isAdmin) {
        try {
          setRows(await fetchAllTimeEntries(token))
        } catch (e) {
          const msg = e instanceof Error ? e.message : 'Failed to load all entries'
          setErr(
            `${msg} If your API only supports per-employee queries, add GET /time/entries (no employeeId) for Super Admin — see BACKEND_HANDOFF.`,
          )
          setRows([])
        }
      } else {
        setRows(await fetchTimeEntries(employeeId, token))
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load timesheet')
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [token, isAdmin, employeeId])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (err) showToast(err, 'error')
  }, [err, showToast])

  const sorted = useMemo(
    () => [...rows].sort((a, b) => new Date(b.clockInAt).getTime() - new Date(a.clockInAt).getTime()),
    [rows],
  )

  function exportCsv() {
    const stamp = new Date().toISOString().slice(0, 10)
    const lines: string[] = []
    if (isAdmin) {
      lines.push(toCsvRow(['Employee', 'Employee ID', 'Clock in', 'Clock out', 'Duration']))
      for (const e of sorted) {
        lines.push(
          toCsvRow([
            rowName(e),
            e.employeeId,
            e.clockInAt,
            e.clockOutAt ?? '',
            durationLabel(e.clockInAt, e.clockOutAt),
          ]),
        )
      }
      downloadCsv(`timesheet-all-${stamp}.csv`, lines)
    } else {
      lines.push(toCsvRow(['Clock in', 'Clock out', 'Duration']))
      for (const e of sorted) {
        lines.push(
          toCsvRow([e.clockInAt, e.clockOutAt ?? '', durationLabel(e.clockInAt, e.clockOutAt)]),
        )
      }
      downloadCsv(`timesheet-${stamp}.csv`, lines)
    }
  }

  function printList() {
    const title = isAdmin ? 'TIMESHEET (ALL)' : 'MY TIMESHEET'
    const sub = isAdmin ? `${sorted.length} entries` : `${sorted.length} entries`
    const blocks = sorted
      .map((e) => {
        if (isAdmin) {
          return `<div class="receipt-block">
<div class="receipt-line"><span>Staff</span><span>${escapeHtml(rowName(e))}</span></div>
<div class="receipt-line"><span>In</span><span>${escapeHtml(fmt(e.clockInAt))}</span></div>
<div class="receipt-line"><span>Out</span><span>${escapeHtml(fmt(e.clockOutAt))}</span></div>
<div class="receipt-line"><span>Duration</span><span>${escapeHtml(durationLabel(e.clockInAt, e.clockOutAt))}</span></div>
</div><div class="receipt-dash"></div>`
        }
        return `<div class="receipt-block">
<div class="receipt-line"><span>In</span><span>${escapeHtml(fmt(e.clockInAt))}</span></div>
<div class="receipt-line"><span>Out</span><span>${escapeHtml(fmt(e.clockOutAt))}</span></div>
<div class="receipt-line"><span>Duration</span><span>${escapeHtml(durationLabel(e.clockInAt, e.clockOutAt))}</span></div>
</div><div class="receipt-dash"></div>`
      })
      .join('')
    const html = `<div class="receipt-title">${escapeHtml(title)}</div>
<div class="receipt-sub">${escapeHtml(sub)}</div>
<div class="receipt-dash"></div>
${blocks || '<p class="receipt-muted">No entries</p>'}`
    printHtmlDocument(title, html)
  }

  return (
    <div className="card span-full timesheet-page">
      <div className="section-header">
        <h2 className="section-title">{isAdmin ? 'Timesheet (all staff)' : 'Timesheet'}</h2>
        <div className="btn-row" style={{ margin: 0 }}>
          <button type="button" className="btn btn-outline" disabled={loading} onClick={() => void load()}>
            {loading ? 'Loading…' : 'Refresh'}
          </button>
          <button type="button" className="btn btn-outline" disabled={loading || sorted.length === 0} onClick={printList}>
            Print
          </button>
          <button type="button" className="btn btn-outline" disabled={loading || sorted.length === 0} onClick={exportCsv}>
            Export CSV
          </button>
        </div>
      </div>

      {!err && !loading && sorted.length === 0 && <p className="empty-state">No timesheet rows yet.</p>}
      {sorted.length > 0 && (
        <div className="timesheet-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                {isAdmin && <th>Employee</th>}
                <th>Clock in</th>
                <th>Clock out</th>
                <th>Duration</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((e) => (
                <tr key={e.id}>
                  {isAdmin && <td>{rowName(e)}</td>}
                  <td>{fmt(e.clockInAt)}</td>
                  <td>{fmt(e.clockOutAt)}</td>
                  <td>{durationLabel(e.clockInAt, e.clockOutAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
