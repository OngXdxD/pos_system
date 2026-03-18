# Backend Handoff: Clock In/Clock Out System

Frontend requirements changed to employee time tracking.

## New backend scope required

1. 4-digit passcode login for employee and super admin.
2. Employee clock in / clock out records.
3. Employee creation with custom passcode.
4. Employee passcode change flow that requires super admin password.
5. Super admin default passcode in seed data: `8888`.

## Required APIs

### `POST /api/auth/passcode-login`

Request:

```json
{
  "passcode": "1234"
}
```

Success response:

```json
{
  "token": "session-token",
  "user": {
    "id": "emp_001",
    "name": "Alice",
    "role": "EMPLOYEE"
  }
}
```

### `POST /api/time/clock-in`

Request:

```json
{
  "employeeId": "emp_001"
}
```

Success response:

```json
{
  "id": "entry_001",
  "employeeId": "emp_001",
  "clockInAt": "2026-03-18T10:00:00.000Z",
  "clockOutAt": null
}
```

### `POST /api/time/clock-out`

Request:

```json
{
  "entryId": "entry_001"
}
```

Success response:

```json
{
  "id": "entry_001",
  "employeeId": "emp_001",
  "clockInAt": "2026-03-18T10:00:00.000Z",
  "clockOutAt": "2026-03-18T18:00:00.000Z"
}
```

### `GET /api/time/entries?employeeId=emp_001`

Return recent entries for dashboard display.

### `POST /api/employees`

Request:

```json
{
  "name": "Bob",
  "passcode": "2468",
  "role": "EMPLOYEE"
}
```

### `POST /api/employees/change-passcode`

Request:

```json
{
  "employeeId": "emp_001",
  "newPasscode": "1357",
  "superAdminPasscode": "8888"
}
```

Notes:
- Validate super admin passcode before allowing passcode update.
- Return `403` if super admin passcode is wrong.

## Database planning request (please do if not done)

1. `employees`
   - `id` (PK)
   - `name`
   - `role` (`SUPER_ADMIN` / `EMPLOYEE`)
   - `is_active`
   - `created_at`, `updated_at`
2. `employee_passcodes`
   - `employee_id` (FK)
   - `passcode_hash`
   - `passcode_updated_at`
3. `time_entries`
   - `id` (PK)
   - `employee_id` (FK)
   - `clock_in_at`
   - `clock_out_at` (nullable)
   - `created_at`
4. `auth_sessions`
   - `id` (PK)
   - `employee_id` (FK)
   - `token_hash`
   - `expires_at`
   - `revoked_at` (nullable)

## Security requirements

- Never store raw passcodes.
- Hash passcodes and tokens server-side.
- Add rate limiting and lockout on repeated failed login attempts.
- Add seed super admin account with passcode `8888` during environment setup.

## Additional backend endpoint needed for better UX

To let super admin choose employees from a dropdown (instead of typing ID manually), please add:

### `GET /api/employees`

Response:

```json
[
  { "id": "emp_001", "name": "Alice", "role": "EMPLOYEE" },
  { "id": "emp_002", "name": "Bob", "role": "SUPER_ADMIN" }
]
```
