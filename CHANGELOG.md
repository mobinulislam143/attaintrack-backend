# Changelog

All notable changes to this project are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

---

## [Unreleased]

### Planned
- OpenAPI 3.0 spec + Swagger UI at `/api/v1/docs`
- Redis-backed rate limiter for distributed deployments
- File upload service (S3 + local adapter)
- Two-factor authentication (TOTP / authenticator app)
- Multi-tenancy: Organisation model + tenant isolation
- Audit log module (who did what, when)
- PostgreSQL variant with the same API surface

---

## [1.0.0] — 2026-06-26

Initial release of the Enterprise Backend Boilerplate.

### Added

#### Core Infrastructure
- Express 4 application with TypeScript 5 (strict mode)
- Prisma 6 ORM with MongoDB Atlas datasource
- Multi-stage Dockerfile + docker-compose for containerised deployments
- Vercel serverless entry point (`api/index.ts`)
- Graceful shutdown handling (SIGTERM, SIGINT) with 10s drain timeout
- Unhandled rejection + uncaught exception process handlers

#### Data Models
- `User` — authentication fields, email verification, password reset
- `Role` — named permission groups
- `Permission` — fine-grained `resource:action` capabilities
- `UserRole` — explicit many-to-many junction with cascade delete
- `RolePermission` — explicit many-to-many junction with cascade delete
- `RefreshToken` — server-side token store with cascade delete

#### Authentication Module (`/api/v1/auth`)
- `POST /register` — account creation with optional email verification
- `POST /login` — email/password login returning JWT access + refresh tokens
- `POST /refresh-token` — rotating refresh token exchange
- `POST /forgot-password` — password-reset email with 1-hour token
- `POST /reset-password` — token-gated password update
- `GET /verify-email` — one-time email verification link
- `GET /me` — authenticated user profile with roles + permissions
- `POST /logout` — revoke single refresh token
- `POST /logout-all` — revoke all sessions for the user
- `POST /change-password` — authenticated password change with session revocation
- `POST /resend-verification` — re-send verification email

#### Users Module (`/api/v1/users`)
- `GET /profile` — own profile (any authenticated user)
- `PATCH /profile` — update own firstName, lastName, avatar
- `GET /` — admin: paginated, searchable, filterable, sortable user list
- `POST /` — admin: create pre-verified user
- `GET /:id` — admin: get user by ID
- `PATCH /:id` — admin: update any user field
- `DELETE /:id` — admin: hard delete with cascade
- `POST /:id/roles` — admin: assign role to user (idempotent)
- `DELETE /:id/roles/:roleId` — admin: remove role from user

#### Roles Module (`/api/v1/roles`)
- Full CRUD for roles (admin only)
- `POST /:id/permissions` — assign permission to role (idempotent)
- `DELETE /:id/permissions/:permissionId` — remove permission from role

#### Permissions Module (`/api/v1/permissions`)
- Full CRUD for permissions (admin only)
- Enforced `resource:action` naming convention

#### Health Module (`/api/v1/health`)
- Database ping, uptime, API version
- Returns `503` status if database is unreachable

#### Security
- **Helmet** — 15 secure HTTP headers
- **CORS** — configurable origin whitelist with credentials support
- **Rate limiting** — in-memory sliding-window, 100 req / 15 min (global), 10 req / 15 min (auth)
- **Password hashing** — Node.js `crypto.scrypt` with 32-byte random salt and 64-byte derived key
- **Timing-safe comparison** — `timingSafeEqual()` for password verification
- **JWT access tokens** — 15-minute default expiry, HS256
- **JWT refresh tokens** — 7-day default expiry, server-side storage with rotation

#### Common Layer
- `AppError` hierarchy (8 subclasses covering all HTTP status codes)
- `Validator` — fluent validation DSL with per-field error accumulation
- `asyncHandler` — eliminates try/catch in route handlers
- Standard response envelope (`sendSuccess`, `sendCreated`, `sendNoContent`)
- Pagination helpers (`parsePagination`, `parseSort`, `buildMeta`)
- Crypto helpers (`hashPassword`, `verifyPassword`, `generateSecureToken`, `generateOtp`)
- Structured logger with context tagging and debug-only output in development

#### Email Service
- Generic `EmailService` using Nodemailer
- Password-reset HTML email template
- Email-verification HTML email template
- Welcome email template
- Non-fatal email failures (logged, never crash the request)

#### Developer Experience
- `prisma/seed.ts` — seeds 12 permissions, 2 roles, 1 admin user
- `.env.example` with all variables documented
- Professional README with architecture diagram, API table, quick start
- `docs/api.md` — full API reference with request/response examples
- `docs/architecture.md` — system design, data model, scaling guide
- `docs/folder-structure.md` — every file explained with design rationale
- TypeScript strict mode passes with zero errors

---

## Migration Guide

### From the CRM Backend

This boilerplate replaced the Auto Lead Generation CRM backend. If you were using the old CRM codebase:

**Removed APIs:**
- All `/api/leads` endpoints
- All `/api/admin` endpoints
- All `/api/reps` endpoints
- All `/api/webhooks/clerk` endpoint
- The scraper trigger / status endpoints

**Auth changes:**
- Clerk authentication has been removed entirely
- Admin JWT is now full JWT with `JWT_ACCESS_SECRET` (not Clerk)
- Replace all `CLERK_*` env vars with `JWT_ACCESS_SECRET` + `JWT_REFRESH_SECRET`
- Replace `MONGODB_URL` with `DATABASE_URL`

**Database:**
- All CRM collections (`reps`, `leads`, `daily_batches`) are no longer used
- New collections: `users`, `roles`, `permissions`, `user_roles`, `role_permissions`, `refresh_tokens`
- Run `npm run prisma:seed` on a fresh database
