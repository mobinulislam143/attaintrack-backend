# API Reference

**Base URL:** `http://localhost:3000/api/v1`
**Content-Type:** `application/json`
**Authentication:** `Authorization: Bearer <access_token>`

---

## Table of Contents

- [Standard Response Format](#standard-response-format)
- [Error Codes](#error-codes)
- [Pagination](#pagination)
- [Health](#health)
- [Auth](#auth)
- [Users](#users)
- [Roles](#roles)
- [Permissions](#permissions)

---

## Standard Response Format

Every endpoint returns the same envelope structure.

### Success

```json
{
  "success": true,
  "message": "Human-readable description",
  "data": { ... },
  "meta": { ... }  // only on paginated responses
}
```

### Error

```json
{
  "success": false,
  "message": "Human-readable error",
  "code": "ERROR_CODE",
  "errors": {        // only on validation failures
    "field": "message per field"
  }
}
```

### HTTP Status Codes

| Code | Meaning |
|------|---------|
| `200` | OK |
| `201` | Created |
| `204` | No Content (delete, logout) |
| `400` | Bad Request |
| `401` | Unauthorized (missing/invalid token) |
| `403` | Forbidden (valid token, insufficient role) |
| `404` | Not Found |
| `409` | Conflict (duplicate email, name) |
| `422` | Validation Error |
| `429` | Too Many Requests |
| `500` | Internal Server Error |
| `503` | Service Unavailable (DB down) |

---

## Error Codes

| Code | Status | Trigger |
|------|--------|---------|
| `VALIDATION_ERROR` | 422 | Input failed validation |
| `UNAUTHORIZED` | 401 | No token provided |
| `TOKEN_EXPIRED` | 401 | Access token expired |
| `TOKEN_INVALID` | 401 | Malformed or tampered token |
| `REFRESH_TOKEN_INVALID` | 401 | Refresh token not found or expired |
| `FORBIDDEN` | 403 | Role/permission check failed |
| `NOT_FOUND` | 404 | Resource does not exist |
| `CONFLICT` | 409 | Duplicate resource |
| `RATE_LIMIT_EXCEEDED` | 429 | Too many requests |
| `INTERNAL_SERVER_ERROR` | 500 | Unhandled exception |

---

## Pagination

Paginated endpoints accept these query parameters:

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `page` | integer | `1` | Page number (1-based) |
| `limit` | integer | `10` | Items per page (max 100) |
| `sortBy` | string | `createdAt` | Field to sort by |
| `sortOrder` | `asc` \| `desc` | `desc` | Sort direction |
| `search` | string | — | Full-text search (email, name) |

**Pagination meta:**

```json
"meta": {
  "page": 2,
  "limit": 10,
  "total": 84,
  "totalPages": 9,
  "hasNextPage": true,
  "hasPrevPage": true
}
```

---

## Health

### GET `/health`

Returns server health, database connectivity, and uptime. No authentication required.

**Response `200`**
```json
{
  "success": true,
  "message": "Health check",
  "data": {
    "status": "ok",
    "uptime": 3721,
    "database": "ok",
    "version": "1.0.0",
    "timestamp": "2026-06-26T10:00:00.000Z"
  }
}
```

**Response `503`** — database unreachable
```json
{
  "success": true,
  "message": "Health check",
  "data": {
    "status": "degraded",
    "uptime": 120,
    "database": "error",
    "version": "1.0.0",
    "timestamp": "2026-06-26T10:00:00.000Z"
  }
}
```

---

## Auth

Base path: `/auth`

### POST `/auth/register`

Create a new user account. Sends an email-verification link if SMTP is configured.

**Rate limit:** 10 requests / 15 min / IP

**Request body**

| Field | Type | Required | Rules |
|-------|------|:--------:|-------|
| `email` | string | ✅ | Valid email format |
| `password` | string | ✅ | Min 8 chars, uppercase + lowercase + digit + special char |
| `firstName` | string | ✅ | 1–50 characters |
| `lastName` | string | ✅ | 1–50 characters |

```json
{
  "email": "jane@example.com",
  "password": "Secure@1234",
  "firstName": "Jane",
  "lastName": "Doe"
}
```

**Response `201`**
```json
{
  "success": true,
  "message": "Account created successfully",
  "data": {
    "user": {
      "id": "64b1a2c3d4e5f6a7b8c9d0e1",
      "email": "jane@example.com",
      "firstName": "Jane",
      "lastName": "Doe",
      "avatar": null,
      "isEmailVerified": false,
      "roles": [],
      "permissions": [],
      "createdAt": "2026-06-26T10:00:00.000Z"
    },
    "tokens": {
      "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
      "refreshToken": "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2"
    }
  }
}
```

**Response `409`** — email already exists
```json
{
  "success": false,
  "message": "An account with this email already exists",
  "code": "CONFLICT"
}
```

---

### POST `/auth/login`

Authenticate with email and password.

**Rate limit:** 10 requests / 15 min / IP

**Request body**

| Field | Type | Required |
|-------|------|:--------:|
| `email` | string | ✅ |
| `password` | string | ✅ |

```json
{
  "email": "admin@example.com",
  "password": "Admin@1234"
}
```

**Response `200`**
```json
{
  "success": true,
  "message": "Login successful",
  "data": {
    "user": {
      "id": "64b1a2c3d4e5f6a7b8c9d0e1",
      "email": "admin@example.com",
      "firstName": "Admin",
      "lastName": "User",
      "avatar": null,
      "isEmailVerified": true,
      "roles": ["admin"],
      "permissions": [
        "users:read", "users:create", "users:update", "users:delete",
        "roles:read", "roles:create", "roles:update", "roles:delete",
        "permissions:read", "permissions:create", "permissions:update", "permissions:delete"
      ],
      "createdAt": "2026-06-26T10:00:00.000Z"
    },
    "tokens": {
      "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
      "refreshToken": "a1b2c3d4e5f6..."
    }
  }
}
```

**Response `401`** — wrong credentials
```json
{
  "success": false,
  "message": "Invalid email or password",
  "code": "UNAUTHORIZED"
}
```

---

### POST `/auth/refresh-token`

Rotate the token pair. The old refresh token is invalidated immediately.

**Request body**

| Field | Type | Required |
|-------|------|:--------:|
| `refreshToken` | string | ✅ |

```json
{
  "refreshToken": "a1b2c3d4e5f6a7b8..."
}
```

**Response `200`**
```json
{
  "success": true,
  "message": "Tokens refreshed",
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "new_refresh_token_here..."
  }
}
```

---

### POST `/auth/forgot-password`

Initiate the password-reset flow. Always returns success to prevent email enumeration.

**Rate limit:** 10 requests / 15 min / IP

```json
{ "email": "jane@example.com" }
```

**Response `200`**
```json
{
  "success": true,
  "message": "If an account with that email exists, a reset link has been sent",
  "data": null
}
```

---

### POST `/auth/reset-password`

Set a new password using the token from the reset email. Token expires after 1 hour.

```json
{
  "token": "the_token_from_the_email_link",
  "password": "NewSecure@5678",
  "confirmPassword": "NewSecure@5678"
}
```

**Response `204`** — no content

**Response `400`** — invalid or expired token
```json
{
  "success": false,
  "message": "Reset token is invalid or has expired",
  "code": "TOKEN_INVALID"
}
```

---

### GET `/auth/verify-email?token=<token>`

Verify a user's email address using the link sent during registration.

**Response `200`**
```json
{
  "success": true,
  "message": "Email verified successfully",
  "data": null
}
```

---

### GET `/auth/me` 🔒

Return the currently authenticated user's full profile.

**Response `200`**
```json
{
  "success": true,
  "message": "Current user",
  "data": {
    "id": "64b1a2c3d4e5f6a7b8c9d0e1",
    "email": "jane@example.com",
    "firstName": "Jane",
    "lastName": "Doe",
    "avatar": null,
    "isEmailVerified": true,
    "roles": ["user"],
    "permissions": ["users:read", "roles:read", "permissions:read"],
    "createdAt": "2026-06-26T10:00:00.000Z"
  }
}
```

---

### POST `/auth/logout` 🔒

Revoke a specific refresh token.

```json
{ "refreshToken": "a1b2c3d4e5f6..." }
```

**Response `204`** — no content

---

### POST `/auth/logout-all` 🔒

Revoke all refresh tokens (signs out from every device).

**Response `204`** — no content

---

### POST `/auth/change-password` 🔒

Change the authenticated user's password. Revokes all other sessions.

```json
{
  "currentPassword": "OldSecure@1234",
  "newPassword": "NewSecure@5678",
  "confirmPassword": "NewSecure@5678"
}
```

**Response `204`** — no content

---

### POST `/auth/resend-verification` 🔒

Re-send the email-verification link.

**Response `200`**
```json
{
  "success": true,
  "message": "Verification email sent",
  "data": null
}
```

---

## Users

Base path: `/users`

### GET `/users/profile` 🔒

Return the authenticated user's own profile with assigned roles.

**Response `200`**
```json
{
  "success": true,
  "message": "Profile retrieved",
  "data": {
    "id": "64b1a2c3d4e5f6a7b8c9d0e1",
    "email": "jane@example.com",
    "firstName": "Jane",
    "lastName": "Doe",
    "avatar": "https://cdn.example.com/avatars/jane.jpg",
    "isEmailVerified": true,
    "isActive": true,
    "roles": [{ "id": "...", "name": "user" }],
    "createdAt": "2026-06-26T10:00:00.000Z",
    "updatedAt": "2026-06-26T10:00:00.000Z"
  }
}
```

---

### PATCH `/users/profile` 🔒

Update the authenticated user's own profile.

```json
{
  "firstName": "Jane",
  "lastName": "Smith",
  "avatar": "https://cdn.example.com/avatars/jane-new.jpg"
}
```

**Response `200`** — returns updated profile (same shape as GET /profile)

---

### GET `/users` 🔒 `admin`

List all users with pagination, search, filter, and sort.

**Query parameters**

| Parameter | Type | Example | Description |
|-----------|------|---------|-------------|
| `page` | int | `1` | Page number |
| `limit` | int | `20` | Per page (max 100) |
| `search` | string | `jane` | Search email, firstName, lastName |
| `isActive` | boolean | `true` | Filter by active status |
| `sortBy` | string | `email` | `createdAt`, `email`, `firstName`, `lastName` |
| `sortOrder` | string | `asc` | `asc` or `desc` |

**Response `200`**
```json
{
  "success": true,
  "message": "Users retrieved",
  "data": [
    {
      "id": "...",
      "email": "jane@example.com",
      "firstName": "Jane",
      "lastName": "Doe",
      "avatar": null,
      "isEmailVerified": true,
      "isActive": true,
      "roles": [{ "id": "...", "name": "user" }],
      "createdAt": "2026-06-26T10:00:00.000Z",
      "updatedAt": "2026-06-26T10:00:00.000Z"
    }
  ],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 84,
    "totalPages": 5,
    "hasNextPage": true,
    "hasPrevPage": false
  }
}
```

---

### POST `/users` 🔒 `admin`

Create a new user. Admin-created users are pre-verified and active by default.

```json
{
  "email": "newuser@example.com",
  "password": "Secure@1234",
  "firstName": "New",
  "lastName": "User",
  "isActive": true
}
```

**Response `201`** — returns created user object

---

### GET `/users/:id` 🔒 `admin`

Get a single user by their MongoDB ObjectId.

**Response `200`** — returns user object

**Response `404`**
```json
{
  "success": false,
  "message": "User not found",
  "code": "NOT_FOUND"
}
```

---

### PATCH `/users/:id` 🔒 `admin`

Update a user's fields. All fields optional.

```json
{
  "firstName": "Updated",
  "lastName": "Name",
  "avatar": "https://cdn.example.com/avatar.jpg",
  "isActive": false
}
```

**Response `200`** — returns updated user object

---

### DELETE `/users/:id` 🔒 `admin`

Hard-delete a user. Cascades to user roles and refresh tokens.

**Response `204`** — no content

---

### POST `/users/:id/roles` 🔒 `admin`

Assign a role to a user. Idempotent — assigning an already-held role is a no-op.

```json
{ "roleId": "64b1a2c3d4e5f6a7b8c9d0e1" }
```

**Response `200`**
```json
{
  "success": true,
  "message": "Role assigned",
  "data": null
}
```

---

### DELETE `/users/:id/roles/:roleId` 🔒 `admin`

Remove a role from a user.

**Response `204`** — no content

---

## Roles

Base path: `/roles`  
All endpoints require the `admin` role.

### GET `/roles`

List all roles with their assigned permissions.

**Response `200`**
```json
{
  "success": true,
  "message": "Roles retrieved",
  "data": [
    {
      "id": "64b1a2c3d4e5f6a7b8c9d0e1",
      "name": "admin",
      "description": "Full access to all resources",
      "permissions": [
        { "id": "...", "name": "users:read", "description": "Read any user" },
        { "id": "...", "name": "users:create", "description": "Create users" }
      ],
      "createdAt": "2026-06-26T10:00:00.000Z",
      "updatedAt": "2026-06-26T10:00:00.000Z"
    }
  ]
}
```

---

### POST `/roles`

Create a new role. Name is lowercased and must be unique.

```json
{
  "name": "editor",
  "description": "Can create and update content"
}
```

**Response `201`** — returns created role

---

### GET `/roles/:id`

Get a single role with its permissions.

**Response `200`** — returns role object

---

### PATCH `/roles/:id`

Update a role's name or description.

```json
{
  "name": "super-editor",
  "description": "Updated description"
}
```

**Response `200`** — returns updated role

---

### DELETE `/roles/:id`

Delete a role. Automatically removes all user-role and role-permission assignments.

**Response `204`** — no content

---

### POST `/roles/:id/permissions`

Assign a permission to a role. Idempotent.

```json
{ "permissionId": "64b1a2c3d4e5f6a7b8c9d0e1" }
```

**Response `200`**
```json
{
  "success": true,
  "message": "Permission assigned to role",
  "data": null
}
```

---

### DELETE `/roles/:id/permissions/:permissionId`

Remove a permission from a role.

**Response `204`** — no content

---

## Permissions

Base path: `/permissions`  
All endpoints require the `admin` role.

Permission names follow the `resource:action` convention:
`users:read`, `posts:create`, `invoices:delete`, etc.

### GET `/permissions`

List all permissions, sorted alphabetically.

**Response `200`**
```json
{
  "success": true,
  "message": "Permissions retrieved",
  "data": [
    {
      "id": "64b1a2c3d4e5f6a7b8c9d0e1",
      "name": "users:create",
      "description": "Create new users",
      "createdAt": "2026-06-26T10:00:00.000Z",
      "updatedAt": "2026-06-26T10:00:00.000Z"
    }
  ]
}
```

---

### POST `/permissions`

Create a permission. Name must match `resource:action` format.

```json
{
  "name": "posts:publish",
  "description": "Publish blog posts"
}
```

**Response `201`** — returns created permission

**Response `422`** — invalid name format
```json
{
  "success": false,
  "message": "Validation failed",
  "code": "VALIDATION_ERROR",
  "errors": {
    "name": "Permission name must follow 'resource:action' format (e.g. users:read)"
  }
}
```

---

### GET `/permissions/:id`

Get a single permission by ID.

---

### PATCH `/permissions/:id`

Update a permission.

```json
{
  "name": "posts:approve",
  "description": "Updated description"
}
```

**Response `200`** — returns updated permission

---

### DELETE `/permissions/:id`

Delete a permission. Automatically removes it from all roles that held it.

**Response `204`** — no content

---

## Authentication Examples

### cURL — Login and use token

```bash
# 1. Login
TOKEN=$(curl -s -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"Admin@1234"}' \
  | jq -r '.data.tokens.accessToken')

# 2. Use token
curl http://localhost:3000/api/v1/auth/me \
  -H "Authorization: Bearer $TOKEN"
```

### JavaScript — Fetch

```javascript
// Login
const res = await fetch('http://localhost:3000/api/v1/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'admin@example.com', password: 'Admin@1234' })
});
const { data } = await res.json();
const { accessToken, refreshToken } = data.tokens;

// Authenticated request
const profile = await fetch('http://localhost:3000/api/v1/auth/me', {
  headers: { 'Authorization': `Bearer ${accessToken}` }
}).then(r => r.json());
```

### Axios — Token interceptor pattern

```javascript
import axios from 'axios';

const api = axios.create({ baseURL: 'http://localhost:3000/api/v1' });

// Attach token to every request
api.interceptors.request.use(config => {
  const token = localStorage.getItem('accessToken');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Auto-refresh on 401
api.interceptors.response.use(
  res => res,
  async err => {
    if (err.response?.status === 401 && err.response?.data?.code === 'TOKEN_EXPIRED') {
      const refresh = await api.post('/auth/refresh-token', {
        refreshToken: localStorage.getItem('refreshToken')
      });
      const { accessToken, refreshToken } = refresh.data.data;
      localStorage.setItem('accessToken', accessToken);
      localStorage.setItem('refreshToken', refreshToken);
      err.config.headers.Authorization = `Bearer ${accessToken}`;
      return api.request(err.config);
    }
    return Promise.reject(err);
  }
);
```
