import './App.css'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  changeEmployeePasscode,
  clockIn,
  clockOut,
  createEmployee,
  fetchTimeEntries,
  loginWithPasscode,
} from './api'
import type { AuthSession, Employee, TimeEntry, UserRole } from './types'

const SESSION_KEY = 'clock-system.session.v1'

function loadSession(): AuthSession | null {
  try {
    const raw = window.sessionStorage.getItem(SESSION_KEY)
    if (!raw) {
      return null
    }
    return JSON.parse(raw) as AuthSession
  } catch {
    return null
  }
}

function formatDateTime(value: string | null): string {
  if (!value) {
    return '-'
  }
  return new Date(value).toLocaleString()
}

function App() {
  const [session, setSession] = useState<AuthSession | null>(() => loadSession())
  const [entries, setEntries] = useState<TimeEntry[]>([])
  const [entriesError, setEntriesError] = useState<string | null>(null)
  const [isEntriesLoading, setIsEntriesLoading] = useState(false)
  const [clockMessage, setClockMessage] = useState<string | null>(null)
  const [isClockSubmitting, setIsClockSubmitting] = useState(false)

  const [loginPasscode, setLoginPasscode] = useState('')
  const [loginError, setLoginError] = useState<string | null>(null)
  const [isLoggingIn, setIsLoggingIn] = useState(false)
  const attemptedPasscodeRef = useRef<string | null>(null)

  const [createdEmployees, setCreatedEmployees] = useState<Employee[]>([])
  const [newEmployeeName, setNewEmployeeName] = useState('')
  const [newEmployeePasscode, setNewEmployeePasscode] = useState('')
  const [newEmployeeRole, setNewEmployeeRole] = useState<UserRole>('EMPLOYEE')
  const [isCreatingEmployee, setIsCreatingEmployee] = useState(false)
  const [employeeMessage, setEmployeeMessage] = useState<string | null>(null)

  const [targetEmployeeId, setTargetEmployeeId] = useState('')
  const [newPasscode, setNewPasscode] = useState('')
  const [adminPasscode, setAdminPasscode] = useState('')
  const [isChangingPasscode, setIsChangingPasscode] = useState(false)
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null)

  const currentUser = session?.user ?? null

  const activeEntry = useMemo(() => {
    if (!currentUser) {
      return null
    }
    return entries.find((entry) => entry.clockOutAt === null) ?? null
  }, [currentUser, entries])

  useEffect(() => {
    if (loginPasscode.length !== 4 || isLoggingIn) {
      return
    }
    if (attemptedPasscodeRef.current === loginPasscode) {
      return
    }
    attemptedPasscodeRef.current = loginPasscode
    void handleLogin(loginPasscode)
  }, [isLoggingIn, loginPasscode])

  useEffect(() => {
    if (!session) {
      return
    }
    window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(session))
  }, [session])

  useEffect(() => {
    if (!session) {
      setEntries([])
      return
    }
    void refreshEntries(session)
  }, [session])

  async function handleLogin(passcode: string) {
    try {
      setIsLoggingIn(true)
      setLoginError(null)
      const nextSession = await loginWithPasscode(passcode)
      setSession(nextSession)
      setCreatedEmployees((prev) => {
        if (prev.some((employee) => employee.id === nextSession.user.id)) {
          return prev
        }
        return [...prev, { id: nextSession.user.id, name: nextSession.user.name, role: nextSession.user.role }]
      })
      setLoginPasscode('')
    } catch (error) {
      setLoginPasscode('')
      attemptedPasscodeRef.current = null
      setLoginError(error instanceof Error ? error.message : 'Login failed')
    } finally {
      setIsLoggingIn(false)
    }
  }

  function handleLoginInput(value: string) {
    const digitsOnly = value.replace(/\D/g, '').slice(0, 4)
    setLoginPasscode(digitsOnly)
    if (digitsOnly.length < 4) {
      attemptedPasscodeRef.current = null
    }
    if (loginError) {
      setLoginError(null)
    }
  }

  function handleLogout() {
    setSession(null)
    setEntries([])
    setEntriesError(null)
    setClockMessage(null)
    setCreatedEmployees([])
    window.sessionStorage.removeItem(SESSION_KEY)
    setLoginPasscode('')
    setLoginError(null)
  }

  async function refreshEntries(sourceSession = session) {
    if (!sourceSession) {
      return
    }
    try {
      setIsEntriesLoading(true)
      setEntriesError(null)
      const recentEntries = await fetchTimeEntries(sourceSession.user.id, sourceSession.token)
      setEntries(recentEntries)
    } catch (error) {
      setEntriesError(error instanceof Error ? error.message : 'Failed to load time entries')
    } finally {
      setIsEntriesLoading(false)
    }
  }

  async function handleClockAction() {
    if (!currentUser || !session) {
      return
    }

    try {
      setIsClockSubmitting(true)
      setClockMessage(null)
      if (activeEntry) {
        await clockOut(activeEntry.id, session.token)
        setClockMessage('Clock out successful')
      } else {
        await clockIn(currentUser.id, session.token)
        setClockMessage('Clock in successful')
      }
      await refreshEntries()
    } catch (error) {
      setClockMessage(error instanceof Error ? error.message : 'Clock action failed')
    } finally {
      setIsClockSubmitting(false)
    }
  }

  async function handleCreateEmployee(event: React.FormEvent) {
    event.preventDefault()
    setEmployeeMessage(null)

    if (!session) {
      return
    }

    const trimmedName = newEmployeeName.trim()
    if (!trimmedName) {
      setEmployeeMessage('Employee name is required')
      return
    }

    const cleanPasscode = newEmployeePasscode.replace(/\D/g, '')
    if (cleanPasscode.length !== 4) {
      setEmployeeMessage('Employee passcode must be 4 digits')
      return
    }

    try {
      setIsCreatingEmployee(true)
      const created = await createEmployee(
        { name: trimmedName, passcode: cleanPasscode, role: newEmployeeRole },
        session.token,
      )
      setCreatedEmployees((prev) =>
        prev.some((employee) => employee.id === created.id) ? prev : [...prev, created],
      )
      setTargetEmployeeId(created.id)
      setNewEmployeeName('')
      setNewEmployeePasscode('')
      setNewEmployeeRole('EMPLOYEE')
      setEmployeeMessage(`Employee created. ID: ${created.id}`)
    } catch (error) {
      setEmployeeMessage(error instanceof Error ? error.message : 'Failed to create employee')
    } finally {
      setIsCreatingEmployee(false)
    }
  }

  async function handleChangePasscode(event: React.FormEvent) {
    event.preventDefault()
    setPasswordMessage(null)

    if (!session) {
      return
    }

    const trimmedEmployeeId = targetEmployeeId.trim()
    if (!trimmedEmployeeId) {
      setPasswordMessage('Employee ID is required')
      return
    }

    const cleanNewPasscode = newPasscode.replace(/\D/g, '')
    if (cleanNewPasscode.length !== 4) {
      setPasswordMessage('New passcode must be 4 digits')
      return
    }

    const cleanAdminPasscode = adminPasscode.replace(/\D/g, '')
    if (cleanAdminPasscode.length !== 4) {
      setPasswordMessage('Super admin password must be 4 digits')
      return
    }

    try {
      setIsChangingPasscode(true)
      await changeEmployeePasscode(
        {
          employeeId: trimmedEmployeeId,
          newPasscode: cleanNewPasscode,
          superAdminPasscode: cleanAdminPasscode,
        },
        session.token,
      )
      setNewPasscode('')
      setAdminPasscode('')
      setPasswordMessage('Passcode changed successfully')
    } catch (error) {
      setPasswordMessage(error instanceof Error ? error.message : 'Failed to change passcode')
    } finally {
      setIsChangingPasscode(false)
    }
  }

  if (!currentUser) {
    return (
      <div className="login-shell">
        <section className="card login-card">
          <h1>Clock System Login</h1>
          <p className="hint">Enter your 4-digit passcode to login automatically.</p>
          <label htmlFor="login-passcode">Passcode</label>
          <input
            id="login-passcode"
            type="password"
            maxLength={4}
            inputMode="numeric"
            value={loginPasscode}
            onChange={(event) => handleLoginInput(event.target.value)}
            autoFocus
          />
          <p className="hint">{loginPasscode.length}/4 digits</p>
          {isLoggingIn && <p className="status">Logging in...</p>}
          {loginError && <p className="status">{loginError}</p>}
          <p className="hint">Default super admin passcode in backend seed: 8888</p>
        </section>
      </div>
    )
  }

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <h1>Clock In / Clock Out</h1>
          <p className="hint">
            Logged in as {currentUser.name} ({currentUser.role})
          </p>
        </div>
        <button type="button" onClick={handleLogout}>
          Logout
        </button>
      </header>

      <main className="main-grid">
        <section className="card">
          <h2>Your Clock Status</h2>
          <p className="status">{activeEntry ? 'Currently clocked in' : 'Currently clocked out'}</p>
          <button type="button" onClick={handleClockAction} disabled={isClockSubmitting}>
            {isClockSubmitting ? 'Submitting...' : activeEntry ? 'Clock Out' : 'Clock In'}
          </button>
          {activeEntry && (
            <p className="hint">Clocked in at: {formatDateTime(activeEntry.clockInAt)}</p>
          )}
          {clockMessage && <p className="status">{clockMessage}</p>}
        </section>

        <section className="card">
          <h2>Your Recent Records</h2>
          <button type="button" onClick={() => void refreshEntries()} disabled={isEntriesLoading}>
            {isEntriesLoading ? 'Loading...' : 'Refresh'}
          </button>
          {entriesError && <p className="status">{entriesError}</p>}
          {!entriesError && !isEntriesLoading && entries.length === 0 && (
            <p className="hint">No records yet.</p>
          )}
          {entries.length > 0 && (
            <table>
              <thead>
                <tr>
                  <th>Clock In</th>
                  <th>Clock Out</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id}>
                    <td>{formatDateTime(entry.clockInAt)}</td>
                    <td>{formatDateTime(entry.clockOutAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {currentUser.role === 'SUPER_ADMIN' && (
          <>
            <section className="card">
              <h2>Create Employee</h2>
              <form onSubmit={handleCreateEmployee} className="form-stack">
                <label htmlFor="employee-name">Employee Name</label>
                <input
                  id="employee-name"
                  type="text"
                  value={newEmployeeName}
                  onChange={(event) => setNewEmployeeName(event.target.value)}
                />

                <label htmlFor="employee-passcode">Employee Passcode (4 digits)</label>
                <input
                  id="employee-passcode"
                  type="password"
                  inputMode="numeric"
                  maxLength={4}
                  value={newEmployeePasscode}
                  onChange={(event) =>
                    setNewEmployeePasscode(event.target.value.replace(/\D/g, '').slice(0, 4))
                  }
                />

                <label htmlFor="employee-role">Role</label>
                <select
                  id="employee-role"
                  value={newEmployeeRole}
                  onChange={(event) => setNewEmployeeRole(event.target.value as UserRole)}
                >
                  <option value="EMPLOYEE">EMPLOYEE</option>
                  <option value="SUPER_ADMIN">SUPER_ADMIN</option>
                </select>

                <button type="submit" disabled={isCreatingEmployee}>
                  {isCreatingEmployee ? 'Creating...' : 'Create Employee'}
                </button>
                {employeeMessage && <p className="status">{employeeMessage}</p>}
              </form>
              {createdEmployees.length > 0 && (
                <table>
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Name</th>
                      <th>Role</th>
                    </tr>
                  </thead>
                  <tbody>
                    {createdEmployees.map((employee) => (
                      <tr key={employee.id}>
                        <td>{employee.id}</td>
                        <td>{employee.name}</td>
                        <td>{employee.role}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>

            <section className="card">
              <h2>Change Employee Passcode</h2>
              <form onSubmit={handleChangePasscode} className="form-stack">
                <label htmlFor="employee-id">Employee ID</label>
                <input
                  id="employee-id"
                  type="text"
                  value={targetEmployeeId}
                  onChange={(event) => setTargetEmployeeId(event.target.value)}
                />
                <p className="hint">Use the ID from create employee response.</p>

                <label htmlFor="new-passcode">New Passcode (4 digits)</label>
                <input
                  id="new-passcode"
                  type="password"
                  inputMode="numeric"
                  maxLength={4}
                  value={newPasscode}
                  onChange={(event) => setNewPasscode(event.target.value.replace(/\D/g, '').slice(0, 4))}
                />

                <label htmlFor="admin-passcode">Super Admin Password</label>
                <input
                  id="admin-passcode"
                  type="password"
                  inputMode="numeric"
                  maxLength={4}
                  value={adminPasscode}
                  onChange={(event) =>
                    setAdminPasscode(event.target.value.replace(/\D/g, '').slice(0, 4))
                  }
                />

                <button type="submit" disabled={isChangingPasscode}>
                  {isChangingPasscode ? 'Updating...' : 'Change Passcode'}
                </button>
                {passwordMessage && <p className="status">{passwordMessage}</p>}
              </form>
            </section>
          </>
        )}
      </main>
    </div>
  )
}

export default App
