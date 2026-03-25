import type { AuthUser, Employee, Order } from './types'

/** Merge API roster, employees created this session, and the logged-in user (by id). */
export function mergeEmployeeDirectory(
  roster: Employee[],
  createdThisSession: Employee[],
  self: AuthUser,
): Employee[] {
  const m = new Map<string, Employee>()
  for (const e of roster) m.set(e.id, e)
  for (const e of createdThisSession) m.set(e.id, e)
  m.set(self.id, { id: self.id, name: self.name, role: self.role })
  return [...m.values()]
}

export function buildIdToNameMap(employees: Employee[]): Map<string, string> {
  return new Map(employees.map((e) => [e.id, e.name]))
}

/** Prefer API field on order, then directory, then id. */
export function orderEmployeeDisplayName(o: Order, idToName: Map<string, string>): string {
  const n = o.employeeName?.trim()
  if (n) return n
  return idToName.get(o.employeeId) ?? o.employeeId
}

/** Timesheet row: API employeeName on entry, then directory, then id. */
export function timesheetEmployeeDisplayName(
  employeeId: string,
  entryEmployeeName: string | undefined,
  idToName: Map<string, string>,
): string {
  const n = entryEmployeeName?.trim()
  if (n) return n
  return idToName.get(employeeId) ?? employeeId
}
