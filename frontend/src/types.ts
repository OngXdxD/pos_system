export type UserRole = 'SUPER_ADMIN' | 'EMPLOYEE';

export interface AuthUser {
  id: string;
  name: string;
  role: UserRole;
}

export interface AuthSession {
  token: string;
  user: AuthUser;
}

export interface Employee {
  id: string;
  name: string;
  role: UserRole;
}

export interface TimeEntry {
  id: string;
  employeeId: string;
  clockInAt: string;
  clockOutAt: string | null;
}

