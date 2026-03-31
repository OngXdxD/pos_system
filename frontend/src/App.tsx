import './App.css'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  changeEmployeePasscode,
  clockIn,
  clockOut,
  createEmployee,
  fetchCompanyInfo,
  fetchEmployees,
  fetchTimeEntries,
  loginWithPasscode,
  normalizeCompanyInfo,
  updateCompanyInfo,
} from './api'
import { MenuManagementView, loadMenu, saveMenu } from './MenuManagement'
import { loadAutoCompleteNewOrders, saveAutoCompleteNewOrders } from './autoCompleteOrdersStore'
import {
  loadDefaultPaymentMethodCode,
  saveDefaultPaymentMethodCode,
} from './defaultPaymentMethodStore'
import { loadThermalPaperWidth, saveThermalPaperWidth } from './thermalReceiptStore'
import type { ThermalPaperWidth } from './thermalReceiptStore'
import { loadPaymentMethods, savePaymentMethods } from './paymentMethodsStore'
import { OrderHistoryView } from './OrderHistoryView'
import { SalesReportView } from './SalesReportView'
import { TakeOrderView } from './TakeOrder'
import { TimesheetView } from './TimesheetView'
import { mergeEmployeeDirectory } from './employeeDisplay'
import { useToast } from './Toast'
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
  | 'timesheet'
  | 'order'
  | 'orderHistory'
  | 'reports'
  | 'menu'
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
    return normalizeCompanyInfo({ ...EMPTY_COMPANY, ...(JSON.parse(raw) as Record<string, unknown>) })
  } catch {
    return { ...EMPTY_COMPANY }
  }
}

function mergeCompanyFromServer(prev: CompanyInfo, server: CompanyInfo): CompanyInfo {
  return {
    companyName: server.companyName.trim() ? server.companyName : prev.companyName,
    registerNumber: server.registerNumber.trim() ? server.registerNumber : prev.registerNumber,
    contactNumber: server.contactNumber.trim() ? server.contactNumber : prev.contactNumber,
    address: server.address.trim() ? server.address : prev.address,
    email: server.email.trim() ? server.email : prev.email,
    thermalPaperWidth: server.thermalPaperWidth ?? prev.thermalPaperWidth,
    defaultPaymentMethodCode: server.defaultPaymentMethodCode ?? prev.defaultPaymentMethodCode,
    thermalPrinterQueueName:
      server.thermalPrinterQueueName !== undefined
        ? server.thermalPrinterQueueName?.trim() || undefined
        : prev.thermalPrinterQueueName,
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
  const showToast = useToast()

  /* ── Session / theme ────────────────────── */
  const [session, setSession] = useState<AuthSession | null>(() => loadSession())
  const [theme, setTheme] = useState<ThemeSettings>(() => loadTheme())

  /* ── Navigation ─────────────────────────── */
  const [activeView, setActiveView] = useState<ActiveView>(() => {
    const s = loadSession()
    if (!s) return 'order'
    return s.user.role === 'SUPER_ADMIN' ? 'reports' : 'order'
  })

  /* ── Time entries ────────────────────────── */
  const [entries, setEntries] = useState<TimeEntry[]>([])
  const [clockMsg, setClockMsg] = useState<string | null>(null)
  const [isClockBusy, setIsClockBusy] = useState(false)

  /* ── Login ───────────────────────────────── */
  const [pin, setPin] = useState('')
  const [isLoggingIn, setIsLoggingIn] = useState(false)
  const triedPin = useRef<string | null>(null)

  /* ── Create employee ─────────────────────── */
  const [createdList, setCreatedList] = useState<Employee[]>([])
  const [employeeRoster, setEmployeeRoster] = useState<Employee[]>([])
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
  const [companyUiMode, setCompanyUiMode] = useState<'summary' | 'edit'>('summary')
  const hasLoadedCompany = useRef(false)
  const prevActiveView = useRef<ActiveView>(activeView)

  /* ── Menu ────────────────────────────────── */
  const [menu, setMenu] = useState<MenuItem[]>(() => loadMenu())

  /* ── Payment methods (Super Admin → synced to Take Order) ── */
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodConfig[]>(() => loadPaymentMethods())
  const [autoCompleteNewOrders, setAutoCompleteNewOrders] = useState(() => loadAutoCompleteNewOrders())
  const [thermalPaperWidth, setThermalPaperWidth] = useState(() => loadThermalPaperWidth())
  const [defaultPaymentMethodCode, setDefaultPaymentMethodCode] = useState(() =>
    loadDefaultPaymentMethodCode(),
  )
  const [thermalPrinterQueueName, setThermalPrinterQueueName] = useState(
    () => loadCompanyInfoLocal().thermalPrinterQueueName ?? '',
  )
  const [newPayLabel, setNewPayLabel] = useState('')
  const [newPayCode, setNewPayCode] = useState('')
  const [addPaymentMethodOpen, setAddPaymentMethodOpen] = useState(false)

  /** Draft for Settings → POS server fields; non-null only while editing. */
  const [posSettingsDraft, setPosSettingsDraft] = useState<{
    thermal: ThermalPaperWidth
    pay: string
    queue: string
  } | null>(null)
  const [isSavingPosSettings, setIsSavingPosSettings] = useState(false)

  const currentUser = session?.user ?? null
  const isAdmin = currentUser?.role === 'SUPER_ADMIN'

  const employeeDirectory = useMemo(() => {
    if (!currentUser) return []
    return mergeEmployeeDirectory(employeeRoster, createdList, currentUser)
  }, [employeeRoster, createdList, currentUser])

  const staffRowsSorted = useMemo(
    () => [...employeeDirectory].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })),
    [employeeDirectory],
  )

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
    if (!session) {
      setEmployeeRoster([])
      return
    }
    void fetchEmployees(session.token).then(setEmployeeRoster)
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

  useEffect(() => {
    saveAutoCompleteNewOrders(autoCompleteNewOrders)
  }, [autoCompleteNewOrders])

  useEffect(() => {
    saveThermalPaperWidth(thermalPaperWidth)
  }, [thermalPaperWidth])

  useEffect(() => {
    if (activeView === 'settings') return
    setPosSettingsDraft(null)
  }, [activeView])

  // Fetch company (including POS prefs) once per login — merges with local cache
  useEffect(() => {
    if (!session) {
      hasLoadedCompany.current = false
      return
    }
    if (hasLoadedCompany.current) return
    hasLoadedCompany.current = true
    void fetchCompanyInfo(session.token).then((data) => {
      if (!data) return
      setCompanyInfo((prev) => mergeCompanyFromServer(prev, data))
      setCompanyEdit((prev) => mergeCompanyFromServer(prev, data))
      if (data.thermalPaperWidth) {
        saveThermalPaperWidth(data.thermalPaperWidth)
        setThermalPaperWidth(data.thermalPaperWidth)
      }
      if (data.defaultPaymentMethodCode !== undefined) {
        saveDefaultPaymentMethodCode(data.defaultPaymentMethodCode)
        setDefaultPaymentMethodCode(data.defaultPaymentMethodCode)
      }
      if (data.thermalPrinterQueueName !== undefined) {
        setThermalPrinterQueueName(data.thermalPrinterQueueName ?? '')
      }
    })
  }, [session])

  useEffect(() => {
    const prev = prevActiveView.current
    prevActiveView.current = activeView
    if (activeView !== 'company' || prev === 'company') return
    setCompanyUiMode('summary')
    setCompanyMsg(null)
    setCompanyEdit(companyInfo)
    // Intentionally only when the active tab changes — `companyInfo` is read from this render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeView])

  useEffect(() => {
    if (activeView !== 'company' || !session || !isAdmin) return
    void fetchEmployees(session.token).then(setEmployeeRoster)
  }, [activeView, session, isAdmin])

  useEffect(() => {
    if (activeView === 'settings') return
    setAddPaymentMethodOpen(false)
    setNewPayLabel('')
    setNewPayCode('')
  }, [activeView])

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
      const s = await loginWithPasscode(passcode)
      setSession(s)
      setClockMsg(null)
      setActiveView(s.user.role === 'SUPER_ADMIN' ? 'reports' : 'order')
      setCreatedList((prev) =>
        prev.some((e) => e.id === s.user.id) ? prev : [...prev, { id: s.user.id, name: s.user.name, role: s.user.role }],
      )
      
      setPin('')
    } catch (err) {
      setPin('')
      triedPin.current = null
      showToast(err instanceof Error ? err.message : 'Login failed', 'error')
    } finally {
      setIsLoggingIn(false)
    }
  }

  function handlePinInput(val: string) {
    const d = val.replace(/\D/g, '').slice(0, 4)
    setPin(d)
    if (d.length < 4) triedPin.current = null
  }

  function handleLogout() {
    setSession(null)
    setEntries([])
    setClockMsg(null)
    setCreatedList([])
    setEmployeeRoster([])
    hasLoadedCompany.current = false
    window.sessionStorage.removeItem(SESSION_KEY)
    setPin('')
    setActiveView('order')
  }

  async function loadEntries(src = session) {
    if (!src) return
    try {
      setEntries(await fetchTimeEntries(src.user.id, src.token))
    } catch {
      setEntries([])
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
      showToast(err instanceof Error ? err.message : 'Clock action failed', 'error')
    } finally {
      setIsClockBusy(false)
    }
  }

  async function handleCreateEmployee(e: React.FormEvent) {
    e.preventDefault()
    if (!session) return
    setEmpMsg(null)
    const name = empName.trim()
    if (!name) {
      showToast('Name is required', 'error')
      return
    }
    const code = empPin.replace(/\D/g, '')
    if (code.length !== 4) {
      showToast('Passcode must be 4 digits', 'error')
      return
    }
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
      showToast(err instanceof Error ? err.message : 'Failed to create employee', 'error')
    } finally {
      setIsCreating(false)
    }
  }

  async function handleChangePasscode(e: React.FormEvent) {
    e.preventDefault()
    if (!session) return
    setPcMsg(null)
    if (!pcEmpId.trim()) {
      showToast('Employee ID is required', 'error')
      return
    }
    const np = pcNew.replace(/\D/g, '')
    if (np.length !== 4) {
      showToast('New passcode must be 4 digits', 'error')
      return
    }
    const ap = pcAdmin.replace(/\D/g, '')
    if (ap.length !== 4) {
      showToast('Super admin PIN must be 4 digits', 'error')
      return
    }
    try {
      setIsChangingPc(true)
      await changeEmployeePasscode({ employeeId: pcEmpId.trim(), newPasscode: np, superAdminPasscode: ap }, session.token)
      setPcNew('')
      setPcAdmin('')
      setPcMsg('Passcode changed successfully')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to change passcode', 'error')
    } finally {
      setIsChangingPc(false)
    }
  }

  function handleSaveTheme(e: React.FormEvent) {
    e.preventDefault()
    setTheme(themeEdit)
    setThemeMsg('Theme colors saved')
  }

  function beginEditPosSettings() {
    setPosSettingsDraft({
      thermal: thermalPaperWidth,
      pay: defaultPaymentMethodCode,
      queue: thermalPrinterQueueName,
    })
  }

  function cancelEditPosSettings() {
    setPosSettingsDraft(null)
  }

  async function savePosSettingsToServer(e?: React.FormEvent) {
    e?.preventDefault()
    if (!session || !isAdmin || !posSettingsDraft) return
    const pay = posSettingsDraft.pay.trim() || undefined
    const queue = posSettingsDraft.queue.trim() || undefined
    try {
      setIsSavingPosSettings(true)
      const saved = await updateCompanyInfo(
        {
          ...companyInfo,
          thermalPaperWidth: posSettingsDraft.thermal,
          defaultPaymentMethodCode: pay,
          thermalPrinterQueueName: queue,
        },
        session.token,
      )
      setCompanyInfo(saved)
      setCompanyEdit((prev) => ({ ...prev, ...saved }))
      const tw = saved.thermalPaperWidth ?? posSettingsDraft.thermal
      setThermalPaperWidth(tw)
      saveThermalPaperWidth(tw)
      const dpm = saved.defaultPaymentMethodCode ?? posSettingsDraft.pay
      setDefaultPaymentMethodCode(dpm)
      saveDefaultPaymentMethodCode(dpm)
      setThermalPrinterQueueName(saved.thermalPrinterQueueName ?? posSettingsDraft.queue)
      setPosSettingsDraft(null)
      showToast('POS printer and payment settings saved to the server.', 'success')
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : 'Could not save POS settings to the server',
        'error',
      )
    } finally {
      setIsSavingPosSettings(false)
    }
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
      const saved = await updateCompanyInfo(
        {
          ...companyEdit,
          thermalPaperWidth,
          defaultPaymentMethodCode: defaultPaymentMethodCode.trim() || undefined,
          thermalPrinterQueueName: thermalPrinterQueueName.trim() || undefined,
        },
        session.token,
      )
      setCompanyInfo(saved)
      setCompanyEdit(saved)
      setCompanyUiMode('summary')
      setCompanyMsg('Company info updated successfully')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to save company info', 'error')
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
        </div>
      </div>
    )
  }

  /* ── Tab definitions ────────────────────── */

  const tabs: Array<{ id: ActiveView; label: string }> = [
    { id: 'order', label: 'Take Order' },
    { id: 'orderHistory', label: 'Orders' },
    { id: 'reports', label: 'Reports' },
    { id: 'timesheet', label: 'Timesheet' },
    ...(isAdmin
      ? ([
          { id: 'menu', label: 'Menu' },
          { id: 'company', label: 'Staff & company' },
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

        {/* ─── TAKE ORDER VIEW ─── */}
        {activeView === 'order' && session && (
          <TakeOrderView
            menu={menu}
            onMenuRefresh={setMenu}
            employeeId={currentUser.id}
            token={session.token}
            paymentMethods={paymentMethods}
            autoCompleteNewOrders={autoCompleteNewOrders}
            defaultPaymentMethodCode={defaultPaymentMethodCode}
          />
        )}

        {activeView === 'orderHistory' && session && (
          <OrderHistoryView token={session.token} paymentMethods={paymentMethods} />
        )}

        {activeView === 'reports' && session && (
          <SalesReportView
            token={session.token}
            paymentMethods={paymentMethods}
            companyName={companyInfo.companyName}
          />
        )}

        {/* ─── MENU VIEW (admin) ─── */}
        {activeView === 'menu' && isAdmin && session && (
          <MenuManagementView menu={menu} onMenuChange={setMenu} token={session.token} />
        )}

        {/* ─── TIMESHEET (before Staff & company in tab order) ─── */}
        {activeView === 'timesheet' && session && (
          <TimesheetView
            token={session.token}
            isAdmin={isAdmin}
            employeeId={currentUser.id}
            employees={employeeDirectory}
          />
        )}

        {/* ─── STAFF & COMPANY (admin) ─── */}
        {activeView === 'company' && isAdmin && (
          <div className="staff-company-page">
            <div className="staff-company-top">
            <div className="card">
              <div className="section-header">
                <h2 className="section-title">Create employee</h2>
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

            <div className="card">
              <div className="section-header">
                <h2 className="section-title">Company information</h2>
                {companyUiMode === 'summary' && (
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => {
                      setCompanyEdit(companyInfo)
                      setCompanyMsg(null)
                      setCompanyUiMode('edit')
                    }}
                  >
                    Edit info
                  </button>
                )}
              </div>

              {companyUiMode === 'summary' && (
                <>
                  <dl className="company-summary-dl">
                    <div>
                      <dt>Company name</dt>
                      <dd>{companyInfo.companyName?.trim() || '—'}</dd>
                    </div>
                    <div>
                      <dt>Register number</dt>
                      <dd>{companyInfo.registerNumber?.trim() || '—'}</dd>
                    </div>
                    <div>
                      <dt>Contact number</dt>
                      <dd>{companyInfo.contactNumber?.trim() || '—'}</dd>
                    </div>
                    <div>
                      <dt>Email</dt>
                      <dd>{companyInfo.email?.trim() || '—'}</dd>
                    </div>
                    <div className="span-full">
                      <dt>Address</dt>
                      <dd style={{ whiteSpace: 'pre-wrap' }}>{companyInfo.address?.trim() || '—'}</dd>
                    </div>
                  </dl>
                  {companyMsg && <p className={alertClass(companyMsg)} style={{ marginTop: 12 }}>{companyMsg}</p>}
                </>
              )}

              {companyUiMode === 'edit' && (
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
                      disabled={isSavingCompany}
                      onClick={() => {
                        setCompanyEdit(companyInfo)
                        setCompanyMsg(null)
                        setCompanyUiMode('summary')
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                  {companyMsg && <p className={alertClass(companyMsg)} style={{ marginTop: 12 }}>{companyMsg}</p>}
                </form>
              )}
            </div>
            </div>

            <div className="card staff-company-table">
              <div className="section-header">
                <h2 className="section-title">All staff</h2>
                {session && (
                  <button
                    type="button"
                    className="btn btn-outline"
                    onClick={() => void fetchEmployees(session.token).then(setEmployeeRoster)}
                  >
                    Refresh list
                  </button>
                )}
              </div>
              {staffRowsSorted.length === 0 ? (
                <p className="empty-state">No employees loaded. Use Refresh or create staff above.</p>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Role</th>
                        <th>ID</th>
                      </tr>
                    </thead>
                    <tbody>
                      {staffRowsSorted.map((emp) => (
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
          </div>
        )}

        {/* ─── SETTINGS (admin) — three columns (~33% each), payment full row below ─── */}
        {activeView === 'settings' && isAdmin && (
          <div className="settings-three-col">
            <div className="card">
              <div className="section-header">
                <h2 className="section-title">Appearance</h2>
              </div>
              <form onSubmit={handleSaveTheme}>
                <div className="settings-theme-pickers">
                  <div className="form-group settings-theme-picker">
                    <label className="form-label" htmlFor="major-color">Major</label>
                    <input
                      className="color-input"
                      id="major-color"
                      type="color"
                      value={themeEdit.majorColor}
                      onChange={(e) => setThemeEdit((p) => ({ ...p, majorColor: e.target.value }))}
                      aria-label="Major theme color"
                    />
                  </div>
                  <div className="form-group settings-theme-picker">
                    <label className="form-label" htmlFor="sub-color">Sub</label>
                    <input
                      className="color-input"
                      id="sub-color"
                      type="color"
                      value={themeEdit.subColor}
                      onChange={(e) => setThemeEdit((p) => ({ ...p, subColor: e.target.value }))}
                      aria-label="Sub theme color"
                    />
                  </div>
                </div>
                <div className="color-preview settings-color-preview">
                  <div className="color-swatch">
                    <div className="swatch-dot" style={{ background: themeEdit.majorColor }} />
                    <span className="settings-hex">{themeEdit.majorColor}</span>
                  </div>
                  <div className="color-swatch">
                    <div className="swatch-dot" style={{ background: themeEdit.subColor }} />
                    <span className="settings-hex">{themeEdit.subColor}</span>
                  </div>
                </div>
                <div className="btn-row" style={{ marginTop: 8 }}>
                  <button className="btn btn-primary" type="submit">Save colors</button>
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
                    Reset to default
                  </button>
                </div>
                {themeMsg && <p className={alertClass(themeMsg)} style={{ marginTop: 12 }}>{themeMsg}</p>}
              </form>
            </div>

            <div className="card">
              <div className="section-header">
                <h2 className="section-title">Employee passcode</h2>
              </div>
              <form onSubmit={handleChangePasscode}>
                <div className="form-group">
                  <label className="form-label" htmlFor="pc-emp-id">Employee ID</label>
                  <input
                    className="form-input"
                    id="pc-emp-id"
                    type="text"
                    placeholder="From staff table"
                    value={pcEmpId}
                    onChange={(e) => setPcEmpId(e.target.value)}
                    autoComplete="off"
                  />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="pc-new">New passcode</label>
                  <input
                    className="form-input settings-pin-input"
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
                  <label className="form-label" htmlFor="pc-admin">Super admin PIN</label>
                  <input
                    className="form-input settings-pin-input"
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
                    {isChangingPc ? 'Updating…' : 'Update passcode'}
                  </button>
                </div>
                {pcMsg && <p className={alertClass(pcMsg)} style={{ marginTop: 12 }}>{pcMsg}</p>}
              </form>
            </div>

            <div className="card">
              <div className="section-header">
                <h2 className="section-title">New orders</h2>
              </div>
              <div className="settings-option-panel">
                <div className="settings-option-main">
                  <span className="settings-option-title">Auto-complete new orders</span>
                </div>
                <label className="settings-switch" title={autoCompleteNewOrders ? 'Completed by default' : 'Pending by default'}>
                  <input
                    type="checkbox"
                    className="settings-switch-input"
                    checked={autoCompleteNewOrders}
                    onChange={(e) => setAutoCompleteNewOrders(e.target.checked)}
                  />
                  <span className="settings-switch-slider" aria-hidden />
                  <span className="visually-hidden">Auto-complete new orders</span>
                </label>
              </div>
              <div className="settings-thermal-panel">
                <p className="settings-option-title">POS printer and Payment</p>

                {!posSettingsDraft ? (
                  <>
                    <div className="settings-pos-readonly">
                      <p>
                        <span className="settings-pos-label">Paper width</span>
                        <span className="settings-pos-value">{thermalPaperWidth} mm</span>
                      </p>
                      <p>
                        <span className="settings-pos-label">Printer queue</span>
                        <span className="settings-pos-value">
                          {thermalPrinterQueueName.trim() || '— (server env default)'}
                        </span>
                      </p>
                      <p>
                        <span className="settings-pos-label">Default payment on Take Order</span>
                        <span className="settings-pos-value">
                          {!defaultPaymentMethodCode.trim()
                            ? 'First in list (no default)'
                            : (() => {
                                const p = paymentMethods.find(
                                  (x) => x.code === defaultPaymentMethodCode.trim(),
                                )
                                return p ? `${p.label} (${p.code})` : defaultPaymentMethodCode
                              })()}
                        </span>
                      </p>
                    </div>
                    <div className="btn-row settings-pos-actions">
                      <button type="button" className="btn btn-outline" onClick={beginEditPosSettings}>
                        Edit
                      </button>
                    </div>
                  </>
                ) : (
                  <form
                    id="pos-settings-server-form"
                    onSubmit={(e) => {
                      void savePosSettingsToServer(e)
                    }}
                  >
                    <p className="settings-option-title" style={{ marginBottom: 8 }}>
                      Thermal receipt paper
                    </p>
                    <p className="settings-option-desc" style={{ marginBottom: 10 }}>
                      Used by the server for receipt and kitchen slip layout (58 mm vs 80 mm).
                    </p>
                    <div className="settings-thermal-radios" role="group" aria-label="Thermal paper width">
                      <label className="settings-thermal-radio">
                        <input
                          type="radio"
                          name="thermal-paper"
                          checked={posSettingsDraft.thermal === '58'}
                          onChange={() =>
                            setPosSettingsDraft((d) => (d ? { ...d, thermal: '58' } : d))
                          }
                        />
                        <span>58 mm</span>
                      </label>
                      <label className="settings-thermal-radio">
                        <input
                          type="radio"
                          name="thermal-paper"
                          checked={posSettingsDraft.thermal === '80'}
                          onChange={() =>
                            setPosSettingsDraft((d) => (d ? { ...d, thermal: '80' } : d))
                          }
                        />
                        <span>80 mm</span>
                      </label>
                    </div>
                    <p className="settings-option-title" style={{ margin: '18px 0 6px' }}>
                      Thermal printer queue
                    </p>
                    <p className="settings-option-desc" style={{ marginBottom: 8 }}>
                      Windows queue name (Printers and scanners), or leave empty for server env only.
                    </p>
                    <div className="form-group" style={{ marginBottom: 12 }}>
                      <label className="form-label" htmlFor="thermal-printer-queue">
                        Printer queue name
                      </label>
                      <input
                        id="thermal-printer-queue"
                        type="text"
                        className="form-input"
                        value={posSettingsDraft.queue}
                        onChange={(e) =>
                          setPosSettingsDraft((d) => (d ? { ...d, queue: e.target.value } : d))
                        }
                        placeholder="e.g. EPSON TM-T82 Receipt"
                        autoComplete="off"
                      />
                    </div>
                    <p className="settings-option-title" style={{ margin: '18px 0 6px' }}>
                      Default payment method
                    </p>
                    <p className="settings-option-desc" style={{ marginBottom: 8 }}>
                      Pre-selected on Take Order when staff opens the screen.
                    </p>
                    <div className="form-group" style={{ marginBottom: 12 }}>
                      <label className="form-label" htmlFor="default-pay-method">
                        Method
                      </label>
                      <select
                        id="default-pay-method"
                        className="form-input form-select"
                        value={posSettingsDraft.pay}
                        onChange={(e) =>
                          setPosSettingsDraft((d) => (d ? { ...d, pay: e.target.value } : d))
                        }
                        disabled={paymentMethods.length === 0}
                      >
                        <option value="">First in list (no default)</option>
                        {paymentMethods.map((p) => (
                          <option key={p.id} value={p.code}>
                            {p.label} ({p.code})
                          </option>
                        ))}
                      </select>
                      {paymentMethods.length === 0 && (
                        <p className="settings-empty-hint" style={{ marginTop: 8 }}>
                          Add payment methods below first.
                        </p>
                      )}
                    </div>
                    <div className="btn-row settings-pos-actions">
                      <button type="button" className="btn btn-outline" onClick={cancelEditPosSettings}>
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="btn btn-primary"
                        disabled={isSavingPosSettings}
                      >
                        {isSavingPosSettings ? 'Saving…' : 'Save to server'}
                      </button>
                    </div>
                  </form>
                )}
              </div>
            </div>

            <div className="card settings-three-col-span">
              <div className="section-header">
                <h2 className="section-title">Payment methods</h2>
              </div>
              {paymentMethods.length === 0 ? (
                <p className="empty-state">No payment methods yet.</p>
              ) : (
                <div className="settings-pm-table-wrap">
                  <table className="settings-pm-table data-table">
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Code</th>
                        <th className="settings-pm-col-action" />
                      </tr>
                    </thead>
                    <tbody>
                      {paymentMethods.map((p) => (
                        <tr key={p.id}>
                          <td className="settings-pm-name">{p.label}</td>
                          <td>
                            <code className="settings-pm-code">{p.code}</code>
                          </td>
                          <td className="settings-pm-col-action">
                            <button
                              type="button"
                              className="btn btn-danger btn-sm"
                              onClick={() => setPaymentMethods((prev) => prev.filter((x) => x.id !== p.id))}
                            >
                              Remove
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {!addPaymentMethodOpen ? (
                <div className="btn-row" style={{ marginTop: 12 }}>
                  <button
                    type="button"
                    className="btn btn-outline"
                    onClick={() => setAddPaymentMethodOpen(true)}
                  >
                    New payment method
                  </button>
                </div>
              ) : (
                <div className="settings-pm-add" style={{ marginTop: 12 }}>
                  <div className="settings-pm-add-row">
                    <div className="form-group settings-pm-field">
                      <label className="form-label" htmlFor="pm-label">Name</label>
                      <input
                        id="pm-label"
                        className="form-input"
                        placeholder="e.g. Touch n Go"
                        value={newPayLabel}
                        onChange={(e) => setNewPayLabel(e.target.value)}
                      />
                    </div>
                    <div className="form-group settings-pm-field">
                      <label className="form-label" htmlFor="pm-code">Code</label>
                      <input
                        id="pm-code"
                        className="form-input settings-pm-code-input"
                        placeholder="e.g. TNG"
                        value={newPayCode}
                        onChange={(e) => setNewPayCode(e.target.value.toUpperCase().replace(/\s+/g, '_'))}
                      />
                    </div>
                    <button
                      type="button"
                      className="btn btn-primary settings-pm-add-btn"
                      onClick={() => {
                        const label = newPayLabel.trim()
                        const code = newPayCode.trim()
                        if (!label || !code) return
                        setPaymentMethods((prev) => [...prev, { id: crypto.randomUUID(), label, code }])
                        setNewPayLabel('')
                        setNewPayCode('')
                        setAddPaymentMethodOpen(false)
                      }}
                    >
                      Add
                    </button>
                    <button
                      type="button"
                      className="btn btn-outline settings-pm-add-btn"
                      onClick={() => {
                        setNewPayLabel('')
                        setNewPayCode('')
                        setAddPaymentMethodOpen(false)
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
