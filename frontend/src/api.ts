import type { AuthSession, Employee, TimeEntry, UserRole } from './types';

const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? '/api').replace(/\/$/, '');

function getErrorMessage(payload: unknown, fallback: string): string {
  if (typeof payload === 'object' && payload !== null && 'message' in payload) {
    const maybeMessage = (payload as { message: unknown }).message;
    if (typeof maybeMessage === 'string' && maybeMessage.trim().length > 0) {
      return maybeMessage;
    }
  }
  return fallback;
}

async function requestJson<T>(
  path: string,
  options: RequestInit = {},
  token?: string,
): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set('Content-Type', 'application/json');
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  const payload = (await res.json().catch(() => null)) as unknown;

  if (!res.ok) {
    throw new Error(getErrorMessage(payload, `${res.status} ${res.statusText}`.trim()));
  }

  return payload as T;
}

export async function loginWithPasscode(passcode: string): Promise<AuthSession> {
  return requestJson<AuthSession>('/auth/passcode-login', {
    method: 'POST',
    body: JSON.stringify({ passcode }),
  });
}

export async function clockIn(employeeId: string, token: string): Promise<TimeEntry> {
  return requestJson<TimeEntry>(
    '/time/clock-in',
    {
      method: 'POST',
      body: JSON.stringify({ employeeId }),
    },
    token,
  );
}

export async function clockOut(entryId: string, token: string): Promise<TimeEntry> {
  return requestJson<TimeEntry>(
    '/time/clock-out',
    {
      method: 'POST',
      body: JSON.stringify({ entryId }),
    },
    token,
  );
}

export async function fetchTimeEntries(employeeId: string, token: string): Promise<TimeEntry[]> {
  const query = new URLSearchParams({ employeeId }).toString();
  return requestJson<TimeEntry[]>(`/time/entries?${query}`, {}, token);
}

export async function createEmployee(
  input: { name: string; passcode: string; role: UserRole },
  token: string,
): Promise<Employee> {
  return requestJson<Employee>(
    '/employees',
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
    token,
  );
}

export async function changeEmployeePasscode(
  input: { employeeId: string; newPasscode: string; superAdminPasscode: string },
  token: string,
): Promise<void> {
  await requestJson<unknown>(
    '/employees/change-passcode',
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
    token,
  );
}

