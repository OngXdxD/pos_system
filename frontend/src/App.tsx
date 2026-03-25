import './App.css'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  changeEmployeePasscode,
  clockIn,
  clockOut,
  createEmployee,
  fetchCompanyInfo,
  fetchTimeEntries,
  loginWithPasscode,
  updateCompanyInfo,
} from './api'
import { MenuManagementView, loadMenu, saveMenu } from './MenuManagement'
import { loadPaymentMethods, savePaymentMethods } from './paymentMethodsStore'
import { OrderHistoryView } from './OrderHistoryView'
import { TakeOrderView } from './TakeOrder'
import type { AuthSession, CompanyInfo, Employee, MenuItem, PaymentMethodConfig, TimeEntry, UserRole } from './types'

const SESSION_KEY = 'clock-system.session.v1'
const THEME_KEY = 'clock-system.theme.v1'
const COMPANY_KEY = 'clock-system.company.v1'
const DEFAULT_MAJOR = '#628fe8'
const DEFAULT_SUB = '#fffdc5'

const EMPTY_COMPANY: CompanyInfo = {
  companyName: '',
  registerNumber: '',
  contactNumber: '',
  address: '',
  email: '',
}

type ActiveView =
  | 'records'
  | 'order'
  | 'orderHistory'
  | 'menu'
  | 'employees'
  | 'company'
  | 'settings'

interface ThemeSettings {
  majorColor: string
  subColor: string
}

function loadSession(): AuthSession | null {
  try {
    const raw = window.sessionStorage.getItem(SESSION_KEY)
    if (!raw) return null
    return JSON.parse(raw) as AuthSession
  } catch {
    return null
  }
}

function loadTheme(): ThemeSettings {
  try {
    const raw = window.localStorage.getItem(THEME_KEY)
    if (!raw) return { majorColor: DEFAULT_MAJOR, subColor: DEFAULT_SUB }
    const p = JSON.parse(raw) as ThemeSettings
    if (!p.majorColor || !p.subColor) return { majorColor: DEFAULT_MAJOR, subColor: DEFAULT_SUB }
    return p
  } catch {
    return { majorColor: DEFAULT_MAJOR, subColor: DEFAULT_SUB }
  }
}

function loadCompanyInfoLocal(): CompanyInfo {
  try {
    const raw = window.localStorage.getItem(COMPANY_KEY)
    if (!raw) return { ...EMPTY_COMPANY }
    return { ...EMPTY_COMPANY, ...(JSON.parse(raw) as Partial<CompanyInfo>) }
  } catch {
    return { ...EMPTY_COMPANY }
  }
}

function applyTheme(t: ThemeSettings) {
  const r = document.documentElement
  r.style.setProperty('--major-color', t.majorColor)
  r.style.setProperty('--sub-color', t.subColor)
}

function fmt(v: string | null): string {
  if (!v) return '—'
  return new Date(v).toLocaleString()
}

function alertClass(msg: string): string {
  const low = msg.toLowerCase()
  if (low.includes('success') || low.includes('created') || low.includes('changed') || low.includes('updated'))
    return 'alert alert-success'
  if (low.includes('skip') || low.includes('fail') || low.includes('error') || low.includes('invalid') || low.includes('incorrect'))
    return 'alert alert-error'
  return 'alert alert-info'
}

export default function App() {
  /* ── Session / theme ────────────────────── */
  const [session, setSession] = useState<AuthSession | null>(() => loadSession())
  const [theme, setTheme] = useState<ThemeSettings>(() => loadTheme())

  /* ── Navigation ─────────────────────────── */
  const [activeView, setActiveView] = useState<ActiveView>('order')

  /* ── Time entries ────────────────────────── */
  const [entries, setEntries] = useState<TimeEntry[]>([])
  const [entriesError, setEntriesError] = useState<string | null>(null)
  const [isEntriesLoading, setIsEntriesLoading] = useState(false)
  const [clockMsg, setClockMsg] = useState<string | null>(null)
  const [isClockBusy, setIsClockBusy] = useState(false)

  /* ── Login ───────────────────────────────── */
  const [pin, setPin] = useState('')
  const [loginError, setLoginError] = useState<string | null>(null)
  const [isLoggingIn, setIsLoggingIn] = useState(false)
  const triedPin = useRef<string | null>(null)

  /* ── Create employee ─────────────────────── */
  const [createdList, setCreatedList] = useState<Employee[]>([])
  const [empName, setEmpName] = useState('')
  const [empPin, setEmpPin] = useState('')
  const [empRole, setEmpRole] = useState<UserRole>('EMPLOYEE')
  const [isCreating, setIsCreating] = useState(false)
  const [empMsg, setEmpMsg] = useState<string | null>(null)

  /* ── Change passcode ─────────────────────── */
  const [pcEmpId, setPcEmpId] = useState('')
  const [pcNew, setPcNew] = useState('')
  const [pcAdmin, setPcAdmin] = useState('')
  const [isChangingPc, setIsChangingPc] = useState(false)
  const [pcMsg, setPcMsg] = useState<string | null>(null)

  /* ── Theme editor ────────────────────────── */
  const [themeEdit, setThemeEdit] = useState<ThemeSettings>(() => loadTheme())
  const [themeMsg, setThemeMsg] = useState<string | null>(null)

  /* ── Company info ────────────────────────── */
  const [companyInfo, setCompanyInfo] = useState<CompanyInfo>(() => loadCompanyInfoLocal())
  const [companyEdit, setCompanyEdit] = useState<CompanyInfo>(() => loadCompanyInfoLocal())
  const [companyMsg, setCompanyMsg] = useState<string | null>(null)
  const [isSavingCompany, setIsSavingCompany] = useState(false)
  const hasLoadedCompany = useRef(false)

  /* ── Menu ────────────────────────────────── */
  const [menu, setMenu] = useState<MenuItem[]>(() => loadMenu())

  /* ── Payment methods (Super Admin → synced to Take Order) ── */
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodConfig[]>(() => loadPaymentMethods())
  const [newPayLabel, setNewPayLabel] = useState('')
  const [newPayCode, setNewPayCode] = useState('')

  const currentUser = session?.user ?? null
  const isAdmin = currentUser?.role === 'SUPER_ADMIN'

  const activeEntry = useMemo(
    () => entries.find((e) => e.clockOutAt === null) ?? null,
    [entries],
  )

  /* ── Effects ─────────────────────────────── */

  useEffect(() => {
    applyTheme(theme)
    window.localStorage.setItem(THEME_KEY, JSON.stringify(theme))
  }, [theme])

  useEffect(() => {
    if (session) window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(session))
  }, [session])

  useEffect(() => {
    if (!session) { setEntries([]); return }
    void loadEntries(session)
  }, [session])

  useEffect(() => {
    if (!clockMsg) return
    const t = window.setTimeout(() => setClockMsg(null), 5000)
    return () => window.clearTimeout(t)
  }, [clockMsg])

  useEffect(() => { saveMenu(menu) }, [menu])

  useEffect(() => {
    window.localStorage.setItem(COMPANY_KEY, JSON.stringify(companyInfo))
  }, [companyInfo])

  useEffect(() => {
    savePaymentMethods(paymentMethods)
  }, [paymentMethods])

  // Fetch company info from backend the first time the company tab is opened
  useEffect(() => {
    if (activeView !== 'company' || !session || hasLoadedCompany.current) return
    hasLoadedCompany.current = true
    void fetchCompanyInfo(session.token).then((data) => {
      if (data) {
        setCompanyInfo(data)
        setCompanyEdit(data)
      }
    })
  }, [activeView, session])

  // Auto-trigger login when 4 digits typed
  useEffect(() => {
    if (pin.length !== 4 || isLoggingIn) return
    if (triedPin.current === pin) return
    triedPin.current = pin
    void doLogin(pin)
  }, [pin, isLoggingIn])

  /* ── Handlers ────────────────────────────── */

  async function doLogin(passcode: string) {
    try {
      setIsLoggingIn(true)
      setLoginError(null)
      const s = await loginWithPasscode(passcode)
      setSession(s)
      setClockMsg(null)
      setCreatedList((prev) =>
        prev.some((e) => e.id === s.user.id) ? prev : [...prev, { id: s.user.id, name: s.user.name, role: s.user.role }],
      )
      
      setPin('')
    } catch (err) {
      setPin('')
      triedPin.current = null
      setLoginError(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setIsLoggingIn(false)
    }
  }

  function handlePinInput(val: string) {
    const d = val.replace(/\D/g, '').slice(0, 4)
    setPin(d)
    if (d.length < 4) triedPin.current = null
    if (loginError) setLoginError(null)
  }

  function handleLogout() {
    setSession(null)
    setEntries([])
    setEntriesError(null)
    setClockMsg(null)
    setCreatedList([])
    window.sessionStorage.removeItem(SESSION_KEY)
    setPin('')
    setLoginError(null)
    setActiveView('order')
  }

  async function loadEntries(src = session) {
    if (!src) return
    try {
      setIsEntriesLoading(true)
      setEntriesError(null)
      setEntries(await fetchTimeEntries(src.user.id, src.token))
    } catch (err) {
      setEntriesError(err instanceof Error ? err.message : 'Failed to load records')
    } finally {
      setIsEntriesLoading(false)
    }
  }

  async function handleClockAction() {
    if (!currentUser || !session) return
    try {
      setIsClockBusy(true)
      setClockMsg(null)
      if (activeEntry) {
        await clockOut(activeEntry.id, session.token)
        setClockMsg('Clock out successful')
      } else {
        await clockIn(currentUser.id, session.token)
        setClockMsg('Clock in successful')
      }
      await loadEntries()
    } catch (err) {
      setClockMsg(err instanceof Error ? err.message : 'Clock action failed')
    } finally {
      setIsClockBusy(false)
    }
  }

  async function handleCreateEmployee(e: React.FormEvent) {
    e.preventDefault()
    if (!session) return
    setEmpMsg(null)
    const name = empName.trim()
    if (!name) { setEmpMsg('Name is required'); return }
    const code = empPin.replace(/\D/g, '')
    if (code.length !== 4) { setEmpMsg('Passcode must be 4 digits'); return }
    try {
      setIsCreating(true)
      const emp = await createEmployee({ name, passcode: code, role: empRole }, session.token)
      setCreatedList((prev) => (prev.some((x) => x.id === emp.id) ? prev : [...prev, emp]))
      setPcEmpId(emp.id)
      setEmpName('')
      setEmpPin('')
      setEmpRole('EMPLOYEE')
      setEmpMsg(`Employee created successfully`)
    } catch (err) {
      setEmpMsg(err instanceof Error ? err.message : 'Failed to create employee')
    } finally {
      setIsCreating(false)
    }
  }

  async function handleChangePasscode(e: React.FormEvent) {
    e.preventDefault()
    if (!session) return
    setPcMsg(null)
    if (!pcEmpId.trim()) { setPcMsg('Employee ID is required'); return }
    const np = pcNew.replace(/\D/g, '')
    if (np.length !== 4) { setPcMsg('New passcode must be 4 digits'); return }
    const ap = pcAdmin.replace(/\D/g, '')
    if (ap.length !== 4) { setPcMsg('Super admin password must be 4 digits'); return }
    try {
      setIsChangingPc(true)
      await changeEmployeePasscode({ employeeId: pcEmpId.trim(), newPasscode: np, superAdminPasscode: ap }, session.token)
      setPcNew('')
      setPcAdmin('')
      setPcMsg('Passcode changed successfully')
    } catch (err) {
      setPcMsg(err instanceof Error ? err.message : 'Failed to change passcode')
    } finally {
      setIsChangingPc(false)
    }
  }

  function handleSaveTheme(e: React.FormEvent) {
    e.preventDefault()
    setTheme(themeEdit)
    setThemeMsg('Theme colors saved')
  }

  async function handleSaveCompany(e: React.FormEvent) {
    e.preventDefault()
    if (!session) return
    if (!companyEdit.companyName.trim()) {
      setCompanyMsg('Company name is required')
      return
    }
    try {
      setIsSavingCompany(true)
      setCompanyMsg(null)
      const saved = await updateCompanyInfo(companyEdit, session.token)
      setCompanyInfo(saved)
      setCompanyEdit(saved)
      setCompanyMsg('Company info updated successfully')
    } catch (err) {
      setCompanyMsg(err instanceof Error ? err.message : 'Failed to save company info')
    } finally {
      setIsSavingCompany(false)
    }
  }

  /* ── Login screen ───────────────────────── */

  if (!currentUser) {
    return (
      <div className="login-shell">
        <div className="login-card">
          <div className="login-icon">⏱</div>
          <h1 className="login-title">Staff Clock</h1>
          <p className="login-subtitle">Enter your 4-digit passcode to sign in</p>
          <div className="pin-display">
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className={`pin-dot${i < pin.length ? ' filled' : ''}`} />
            ))}
          </div>
          <input
            className="pin-input"
            id="login-pin"
            type="password"
            inputMode="numeric"
            maxLength={4}
            value={pin}
            onChange={(e) => handlePinInput(e.target.value)}
            autoFocus
            placeholder="····"
          />
          {isLoggingIn && <p className="alert alert-info">Signing in…</p>}
          {loginError && <p className="alert alert-error">{loginError}</p>}
          <p className="login-hint">Default super admin passcode: 8888</p>
        </div>
      </div>
    )
  }

  /* ── Tab definitions ────────────────────── */

  const tabs: Array<{ id: ActiveView; label: string }> = [
    { id: 'records', label: 'Records' },
    { id: 'order', label: 'Take Order' },
    { id: 'orderHistory', label: 'Orders' },
    ...(isAdmin
      ? ([
          { id: 'menu', label: 'Menu' },
          { id: 'employees', label: 'Employees' },
          { id: 'company', label: 'Company' },
          { id: 'settings', label: 'Settings' },
        ] as Array<{ id: ActiveView; label: string }>)
      : []),
  ]

  /* ── Main app ───────────────────────────── */

  return (
    <div className="shell">
      {/* ── Top bar ── */}
      <header className="topbar">
        <span className="topbar-brand">⏱ Staff Clock</span>
        <div className="topbar-spacer" aria-hidden />
        <div className="topbar-clock">
          <span className={`status-badge topbar-status ${activeEntry ? 'status-in' : 'status-out'}`}>
            <span className="clock-dot" />
            {activeEntry ? 'Clocked in' : 'Clocked out'}
          </span>
          {activeEntry && (
            <span className="topbar-since" title={fmt(activeEntry.clockInAt)}>
              Since {fmt(activeEntry.clockInAt)}
            </span>
          )}
          <button
            className="btn btn-topbar"
            type="button"
            onClick={() => void handleClockAction()}
            disabled={isClockBusy}
          >
            {isClockBusy ? '…' : activeEntry ? 'Clock out' : 'Clock in'}
          </button>
          {clockMsg && (
            <span className={`topbar-clock-msg ${alertClass(clockMsg)}`} role="status">
              {clockMsg}
            </span>
          )}
        </div>
        <div className="topbar-right">
          <span className="user-chip">
            {currentUser.name} · {currentUser.role}
          </span>
          <button className="btn btn-topbar" type="button" onClick={handleLogout}>
            Logout
          </button>
        </div>
      </header>

      {/* ── Tab bar ── */}
      <nav className="tabbar">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`tabbar-btn${activeView === t.id ? ' active' : ''}`}
            onClick={() => setActiveView(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {/* ── Page content ── */}
      <main className="page">

        {/* ─── RECORDS VIEW ─── */}
        {activeView === 'records' && (
          <div className="card">
            <div className="section-header">
              <h2 className="section-title">Time Records</h2>
              <button
                className="btn btn-outline"
                type="button"
                onClick={() => void loadEntries()}
                disabled={isEntriesLoading}
              >
                {isEntriesLoading ? 'Loading…' : 'Refresh'}
              </button>
            </div>
            {entriesError && <p className="alert alert-error">{entriesError}</p>}
            {!entriesError && !isEntriesLoading && entries.length === 0 && (
              <p className="empty-state">No records yet.</p>
            )}
            {entries.length > 0 && (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Clock In</th>
                    <th>Clock Out</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => (
                    <tr key={entry.id}>
                      <td>{fmt(entry.clockInAt)}</td>
                      <td>{fmt(entry.clockOutAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* ─── TAKE ORDER VIEW ─── */}
        {activeView === 'order' && session && (
          <TakeOrderView
            menu={menu}
            onMenuRefresh={setMenu}
            employeeId={currentUser.id}
            token={session.token}
            companyInfo={companyInfo}
            paymentMethods={paymentMethods}
          />
        )}

        {activeView === 'orderHistory' && session && (
          <OrderHistoryView
            token={session.token}
            companyInfo={companyInfo}
            paymentMethods={paymentMethods}
          />
        )}

        {/* ─── MENU VIEW (admin) ─── */}
        {activeView === 'menu' && isAdmin && session && (
          <MenuManagementView menu={menu} onMenuChange={setMenu} token={session.token} />
        )}

        {/* ─── EMPLOYEES VIEW (admin) ─── */}
        {activeView === 'employees' && isAdmin && (
          <div className="view-grid">
            <div className="card">
              <div className="section-header">
                <h2 className="section-title">Create Employee</h2>
              </div>
              <form onSubmit={handleCreateEmployee}>
                <div className="form-group">
                  <label className="form-label" htmlFor="emp-name">Full Name</label>
                  <input
                    className="form-input"
                    id="emp-name"
                    type="text"
                    placeholder="e.g. Alice Wong"
                    value={empName}
                    onChange={(e) => setEmpName(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="emp-pin">Passcode (4 digits)</label>
                  <input
                    className="form-input"
                    id="emp-pin"
                    type="password"
                    inputMode="numeric"
                    maxLength={4}
                    placeholder="····"
                    value={empPin}
                    onChange={(e) => setEmpPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="emp-role">Role</label>
                  <select
                    className="form-input form-select"
                    id="emp-role"
                    value={empRole}
                    onChange={(e) => setEmpRole(e.target.value as UserRole)}
                  >
                    <option value="EMPLOYEE">Employee</option>
                    <option value="SUPER_ADMIN">Super Admin</option>
                  </select>
                </div>
                <div className="btn-row">
                  <button className="btn btn-primary" type="submit" disabled={isCreating}>
                    {isCreating ? 'Creating…' : 'Create Employee'}
                  </button>
                </div>
                {empMsg && <p className={alertClass(empMsg)}>{empMsg}</p>}
              </form>
            </div>

            {createdList.length > 0 && (
              <div className="card">
                <div className="section-header">
                  <h2 className="section-title">Created This Session</h2>
                </div>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Role</th>
                      <th>ID</th>
                    </tr>
                  </thead>
                  <tbody>
                    {createdList.map((emp) => (
                      <tr key={emp.id}>
                        <td>{emp.name}</td>
                        <td>{emp.role}</td>
                        <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{emp.id}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ─── COMPANY VIEW (admin) ─── */}
        {activeView === 'company' && isAdmin && (
          <div className="view-grid">
            <div className="card span-full">
              <div className="section-header">
                <h2 className="section-title">Company Information</h2>
              </div>
              <p style={{ opacity: 0.6, marginBottom: 20, fontSize: 14 }}>
                This information is used on receipts and reports. Only Super Admin can edit it.
              </p>
              <form onSubmit={handleSaveCompany}>
                <div className="view-grid" style={{ gap: 0 }}>
                  <div className="form-group">
                    <label className="form-label" htmlFor="co-name">Company Name <span style={{ color: 'var(--danger)' }}>*</span></label>
                    <input
                      className="form-input"
                      id="co-name"
                      type="text"
                      placeholder="e.g. Delicious Cafe Sdn Bhd"
                      value={companyEdit.companyName}
                      onChange={(e) => setCompanyEdit((p) => ({ ...p, companyName: e.target.value }))}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="co-reg">Company Register Number</label>
                    <input
                      className="form-input"
                      id="co-reg"
                      type="text"
                      placeholder="e.g. 202301012345 (12 0)"
                      value={companyEdit.registerNumber}
                      onChange={(e) => setCompanyEdit((p) => ({ ...p, registerNumber: e.target.value }))}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="co-phone">Contact Number</label>
                    <input
                      className="form-input"
                      id="co-phone"
                      type="tel"
                      placeholder="e.g. 012-345 6789"
                      value={companyEdit.contactNumber}
                      onChange={(e) => setCompanyEdit((p) => ({ ...p, contactNumber: e.target.value }))}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="co-email">Email Address</label>
                    <input
                      className="form-input"
                      id="co-email"
                      type="email"
                      placeholder="e.g. hello@deliciouscafe.com"
                      value={companyEdit.email}
                      onChange={(e) => setCompanyEdit((p) => ({ ...p, email: e.target.value }))}
                    />
                  </div>
                  <div className="form-group span-full">
                    <label className="form-label" htmlFor="co-addr">Address</label>
                    <textarea
                      className="form-input"
                      id="co-addr"
                      rows={3}
                      placeholder="e.g. No. 12, Jalan Maju, 50000 Kuala Lumpur"
                      value={companyEdit.address}
                      onChange={(e) => setCompanyEdit((p) => ({ ...p, address: e.target.value }))}
                      style={{ resize: 'vertical' }}
                    />
                  </div>
                </div>

                <div className="btn-row" style={{ marginTop: 8 }}>
                  <button className="btn btn-primary" type="submit" disabled={isSavingCompany}>
                    {isSavingCompany ? 'Saving…' : 'Save Company Info'}
                  </button>
                  <button
                    className="btn btn-outline"
                    type="button"
                    onClick={() => { setCompanyEdit(companyInfo); setCompanyMsg(null) }}
                  >
                    Discard Changes
                  </button>
                </div>
                {companyMsg && <p className={alertClass(companyMsg)} style={{ marginTop: 12 }}>{companyMsg}</p>}
              </form>
            </div>
          </div>
        )}

        {/* ─── SETTINGS VIEW (admin) ─── */}
        {activeView === 'settings' && isAdmin && (
          <div className="view-grid">
            {/* Theme colors */}
            <div className="card">
              <div className="section-header">
                <h2 className="section-title">Theme Colors</h2>
              </div>
              <form onSubmit={handleSaveTheme}>
                <div className="form-group">
                  <label className="form-label" htmlFor="major-color">Major Color</label>
                  <input
                    className="color-input"
                    id="major-color"
                    type="color"
                    value={themeEdit.majorColor}
                    onChange={(e) => setThemeEdit((p) => ({ ...p, majorColor: e.target.value }))}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="sub-color">Sub Color</label>
                  <input
                    className="color-input"
                    id="sub-color"
                    type="color"
                    value={themeEdit.subColor}
                    onChange={(e) => setThemeEdit((p) => ({ ...p, subColor: e.target.value }))}
                  />
                </div>
                <div className="color-preview">
                  <div className="color-swatch">
                    <div className="swatch-dot" style={{ background: themeEdit.majorColor }} />
                    Major: {themeEdit.majorColor}
                  </div>
                  <div className="color-swatch">
                    <div className="swatch-dot" style={{ background: themeEdit.subColor }} />
                    Sub: {themeEdit.subColor}
                  </div>
                </div>
                <div className="btn-row">
                  <button className="btn btn-primary" type="submit">Save Colors</button>
                  <button
                    className="btn btn-outline"
                    type="button"
                    onClick={() => {
                      const d = { majorColor: DEFAULT_MAJOR, subColor: DEFAULT_SUB }
                      setThemeEdit(d)
                      setTheme(d)
                      setThemeMsg('Reset to default')
                    }}
                  >
                    Reset Default
                  </button>
                </div>
                {themeMsg && <p className={alertClass(themeMsg)}>{themeMsg}</p>}
              </form>
            </div>

            {/* Payment methods (cashier checkout) */}
            <div className="card span-full">
              <div className="section-header">
                <h2 className="section-title">Payment methods</h2>
              </div>
              <p style={{ fontSize: 13, opacity: 0.65, marginBottom: 14 }}>
                These options appear on <strong>Take Order</strong> so cashiers can record how the customer paid.
                The <strong>Code</strong> is sent to the server (e.g. <code>CASH</code>, <code>CARD</code>) — match your
                backend enum.
              </p>
              <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 16px' }}>
                {paymentMethods.map((p) => (
                  <li
                    key={p.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '8px 0',
                      borderBottom: '1px solid rgba(0,0,0,0.06)',
                    }}
                  >
                    <span style={{ flex: 1, fontWeight: 600 }}>{p.label}</span>
                    <code style={{ fontSize: 12, opacity: 0.75 }}>{p.code}</code>
                    <button
                      type="button"
                      className="btn btn-danger"
                      style={{ padding: '4px 10px', fontSize: 12 }}
                      onClick={() => setPaymentMethods((prev) => prev.filter((x) => x.id !== p.id))}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
              <div className="menu-add-row" style={{ border: 'none', margin: 0, padding: 0 }}>
                <div className="form-group" style={{ flex: 1, minWidth: 140 }}>
                  <label className="form-label" htmlFor="pm-label">Display name</label>
                  <input
                    id="pm-label"
                    className="form-input"
                    placeholder="e.g. Touch n Go"
                    value={newPayLabel}
                    onChange={(e) => setNewPayLabel(e.target.value)}
                  />
                </div>
                <div className="form-group" style={{ flex: 1, minWidth: 120 }}>
                  <label className="form-label" htmlFor="pm-code">Code (API)</label>
                  <input
                    id="pm-code"
                    className="form-input"
                    placeholder="e.g. TNG"
                    value={newPayCode}
                    onChange={(e) => setNewPayCode(e.target.value.toUpperCase().replace(/\s+/g, '_'))}
                  />
                </div>
                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ alignSelf: 'flex-end' }}
                  onClick={() => {
                    const label = newPayLabel.trim()
                    const code = newPayCode.trim()
                    if (!label || !code) return
                    setPaymentMethods((prev) => [...prev, { id: crypto.randomUUID(), label, code }])
                    setNewPayLabel('')
                    setNewPayCode('')
                  }}
                >
                  Add method
                </button>
              </div>
            </div>

            {/* Change passcode */}
            <div className="card">
              <div className="section-header">
                <h2 className="section-title">Change Employee Passcode</h2>
              </div>
              <form onSubmit={handleChangePasscode}>
                <div className="form-group">
                  <label className="form-label" htmlFor="pc-emp-id">Employee ID</label>
                  <input
                    className="form-input"
                    id="pc-emp-id"
                    type="text"
                    placeholder="Paste ID from Employees tab"
                    value={pcEmpId}
                    onChange={(e) => setPcEmpId(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="pc-new">New Passcode (4 digits)</label>
                  <input
                    className="form-input"
                    id="pc-new"
                    type="password"
                    inputMode="numeric"
                    maxLength={4}
                    placeholder="····"
                    value={pcNew}
                    onChange={(e) => setPcNew(e.target.value.replace(/\D/g, '').slice(0, 4))}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="pc-admin">Super Admin Password</label>
                  <input
                    className="form-input"
                    id="pc-admin"
                    type="password"
                    inputMode="numeric"
                    maxLength={4}
                    placeholder="····"
                    value={pcAdmin}
                    onChange={(e) => setPcAdmin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                  />
                </div>
                <div className="btn-row">
                  <button className="btn btn-primary" type="submit" disabled={isChangingPc}>
                    {isChangingPc ? 'Updating…' : 'Change Passcode'}
                  </button>
                </div>
                {pcMsg && <p className={alertClass(pcMsg)}>{pcMsg}</p>}
              </form>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
