# Architecture

This document covers the system design, data model, module anatomy, and scaling guidance.

---

## Table of Contents

- [Overview](#overview)
- [Request Lifecycle](#request-lifecycle)
- [Data Model](#data-model)
- [Module Anatomy](#module-anatomy)
- [Common Layer](#common-layer)
- [Authentication Design](#authentication-design)
- [RBAC Design](#rbac-design)
- [Error Handling](#error-handling)
- [Adding a Module](#adding-a-module)
- [Scaling](#scaling)

---

## Overview

The stack is intentionally **minimal and readable**:

```
Express (HTTP)
  └── Prisma ORM
        └── MongoDB Atlas
```

No IoC containers. No decorators. No magic. Every module is plain TypeScript that any developer can follow from route to database in under a minute.

**Design principles:**
- **Feature modules** — each feature owns all its own files
- **Thin controllers** — validate input, call service, send response. Nothing more.
- **Fat services** — all business logic, all Prisma queries
- **Shared common** — utilities that have no business logic, usable anywhere
- **No circular deps** — modules never import each other; only `common/`, `config/`, `database/`, `services/`, `middleware/`

---

## Request Lifecycle

```
 ┌──────────┐
 │  Client  │
 └────┬─────┘
      │ HTTP Request
      ▼
 ┌─────────────────────────────────────────────┐
 │             Express Middleware Stack         │
 │                                             │
 │  1. Helmet       — security headers         │
 │  2. CORS         — origin whitelist         │
 │  3. Morgan       — HTTP request logging     │
 │  4. JSON parser  — req.body                 │
 │  5. Rate limiter — IP-based sliding window  │
 └────────────────────┬────────────────────────┘
                      │
                      ▼
 ┌─────────────────────────────────────────────┐
 │               Route Matching                │
 │         /api/v1/<module>/<endpoint>         │
 └────────────────────┬────────────────────────┘
                      │
                      ▼
 ┌─────────────────────────────────────────────┐
 │          Per-Route Middleware Guards         │
 │                                             │
 │  requireAuth         — JWT verification     │
 │  requireRole(...)    — role check           │
 │  requirePermission() — permission check     │
 └────────────────────┬────────────────────────┘
                      │
                      ▼
 ┌─────────────────────────────────────────────┐
 │               Controller                    │
 │                                             │
 │  1. Validate input (Validator class)        │
 │  2. Extract typed body/params               │
 │  3. Call service method                     │
 │  4. Send response (sendSuccess/sendCreated) │
 └────────────────────┬────────────────────────┘
                      │
                      ▼
 ┌─────────────────────────────────────────────┐
 │                 Service                     │
 │                                             │
 │  - Business rules                           │
 │  - Prisma queries                           │
 │  - Throws AppError subclasses on failure    │
 └────────────────────┬────────────────────────┘
                      │
                      ▼
 ┌─────────────────────────────────────────────┐
 │             Prisma ORM                      │
 │             MongoDB Atlas                   │
 └─────────────────────────────────────────────┘
```

**Error path:**
Any thrown `AppError` (or unexpected exception) propagates back up through `asyncHandler`, which catches the rejected promise and calls `next(err)`. Express then routes it to the global `errorMiddleware` at the bottom of `app.ts`.

```
Service throws NotFoundError
  ↓
asyncHandler calls next(err)
  ↓
errorMiddleware formats it as { success: false, message, code }
  ↓
Client receives 404
```

---

## Data Model

```
┌──────────────────────────────────────────────────────────────┐
│                          User                                │
│  id · email · password · firstName · lastName · avatar       │
│  isEmailVerified · emailVerifyToken · isActive               │
│  passwordResetToken · passwordResetExpiry                    │
│  createdAt · updatedAt                                       │
└──────────┬──────────────────────────┬───────────────────────┘
           │ 1                        │ 1
           │                          │
           ▼ *                        ▼ *
 ┌──────────────────┐      ┌──────────────────────┐
 │   UserRole       │      │    RefreshToken       │
 │  userId · roleId │      │  token · userId       │
 └────────┬─────────┘      │  expiresAt            │
          │ *              └──────────────────────┘
          │
          ▼ 1
 ┌──────────────────────────────┐
 │             Role             │
 │  id · name · description     │
 │  createdAt · updatedAt       │
 └──────────┬───────────────────┘
            │ 1
            │
            ▼ *
 ┌────────────────────────────────────┐
 │          RolePermission            │
 │        roleId · permissionId       │
 └────────────────┬───────────────────┘
                  │ *
                  │
                  ▼ 1
 ┌──────────────────────────────┐
 │          Permission          │
 │  id · name · description     │
 │  createdAt · updatedAt       │
 └──────────────────────────────┘
```

**Key decisions:**

| Decision | Reason |
|---|---|
| Junction tables `UserRole` + `RolePermission` | MongoDB Prisma doesn't support implicit M2M; explicit junctions allow future metadata (e.g. `grantedAt`, `grantedBy`) |
| `password` never returned in SELECT | `USER_SELECT` Prisma selector explicitly omits it |
| `RefreshToken` stored in DB | Enables server-side revocation per-token or per-user; essential for "logout all devices" |
| `emailVerifyToken` + `passwordResetToken` in User | Avoids a separate OTP table for small-scale deployments |
| Roles stored in JWT claims | Avoids a DB lookup on every request; invalidated on next token refresh |

---

## Module Anatomy

Every module under `src/modules/<name>/` follows this pattern:

```
posts/
├── posts.service.ts     # All business logic + Prisma queries
├── posts.controller.ts  # HTTP layer only — validate, call, respond
├── posts.validator.ts   # Input validation using Validator class
└── posts.routes.ts      # Router with middleware guards
```

**service.ts** — the core

```typescript
export const postsService = {
  async list(opts): Promise<{ data: PostDto[]; meta: ApiMeta }> { ... },
  async findById(id: string): Promise<PostDto> { ... },
  async create(data): Promise<PostDto> { ... },
  async update(id, data): Promise<PostDto> { ... },
  async delete(id): Promise<void> { ... },
};
```

Rules:
- Export a plain object (not a class) — simpler, tree-shakeable
- Always `throw new NotFoundError('Post')` instead of returning `null`
- Prefix Prisma selects with a `const SELECT` to avoid ever leaking password or internal fields

**controller.ts** — only 3 responsibilities

```typescript
export async function createPost(req: Request, res: Response): Promise<void> {
  validateCreatePost(req);                          // 1. validate
  const { title, body } = req.body as CreateBody;  // 2. extract
  const post = await postsService.create({ title, body }); // 3. call
  sendCreated(res, post, 'Post created');           // 4. respond
}
```

**routes.ts** — express router

```typescript
router.post('/', requireAuth, requirePermission('posts:create'), asyncHandler(ctrl.createPost));
```

---

## Common Layer

`src/common/` contains zero-business-logic utilities. Every file is independently usable.

| File | Exports | When to use |
|------|---------|-------------|
| `errors.ts` | `AppError` + subclasses | `throw new NotFoundError('Post')` anywhere |
| `logger.ts` | `logger` | `logger.info('module', 'message', extra?)` |
| `async-handler.ts` | `asyncHandler` | Wrap every async route handler |
| `response.ts` | `sendSuccess` `sendCreated` `sendNoContent` | In every controller — never call `res.json()` directly |
| `pagination.ts` | `parsePagination` `parseSort` `buildMeta` | In list controllers |
| `crypto.ts` | `hashPassword` `verifyPassword` `generateSecureToken` | In auth service + seed |
| `validator.ts` | `Validator` class | In every `*.validator.ts` file |

---

## Authentication Design

### Two-token strategy

```
Access Token  — short-lived (default 15m), stateless JWT
Refresh Token — long-lived (default 7d), stored in DB
```

**Why two tokens?**

Single long-lived JWT can't be revoked. Short-lived JWT + DB-backed refresh token gives you:
- Fast auth checks (no DB on every request — just verify JWT signature)
- True server-side revocation (delete from `refresh_tokens` table)
- "Logout all devices" (delete all refresh tokens for user)

**Token rotation:**

Every refresh-token exchange:
1. Validates the provided token exists in DB and is not expired
2. Deletes the old token from DB
3. Issues a new access token + new refresh token

This means a stolen refresh token can only be used once before it's rotated out. On next refresh by the legitimate client, it will fail (token already deleted) and force re-login.

**JWT payload structure:**

```typescript
// Access token claims
{
  sub: "user-id",
  email: "user@example.com",
  firstName: "Jane",
  lastName: "Doe",
  roles: ["admin"],
  permissions: ["users:read", "users:create"],
  iat: 1234567890,
  exp: 1234568790
}
```

Roles and permissions are embedded in the token to avoid a DB lookup on every request. They are refreshed on the next token rotation.

---

## RBAC Design

```
User  ──[UserRole]──►  Role  ──[RolePermission]──►  Permission
```

**Role naming:** lowercase strings — `admin`, `user`, `editor`, `viewer`

**Permission naming:** `resource:action` format — `posts:create`, `users:delete`

**Middleware guards:**

```typescript
// Require a specific role
requireRole('admin')
requireRole('editor', 'admin')  // any of these roles

// Require ALL permissions
requirePermission('posts:create', 'posts:publish')

// Require ANY permission
requireAnyPermission('posts:read', 'posts:draft')
```

**Hierarchy:** Roles aggregate permissions. Users get permissions by virtue of their roles. There is no direct user → permission assignment in this model (keeps it simple). Add a `UserPermission` junction if you need direct overrides.

---

## Error Handling

All errors are caught by the global `errorMiddleware` in `app.ts`.

**Throw hierarchy:**

```
AppError (base)
├── BadRequestError     400
├── ValidationError     422  — has .errors: Record<string, string>
├── UnauthorizedError   401
├── ForbiddenError      403
├── NotFoundError       404
├── ConflictError       409
├── UnprocessableError  422
├── TooManyRequestsError 429
└── ServiceUnavailableError 503
```

**Usage:**

```typescript
// In a service
if (!user) throw new NotFoundError('User');
if (existing) throw new ConflictError('Email already registered');

// Custom code
throw new UnauthorizedError('Token has expired', 'TOKEN_EXPIRED');

// Validation (auto-thrown)
new Validator(req.body).required('email').email('email').throw();
```

Unexpected errors (programming bugs) are caught, logged as ERROR with stack trace, and returned as `500 INTERNAL_SERVER_ERROR`. In production the stack trace is hidden from the client.

---

## Adding a Module

### Step 1 — Add the Prisma model

```prisma
// prisma/schema.prisma
model Post {
  id        String   @id @default(auto()) @map("_id") @db.ObjectId
  title     String
  body      String
  authorId  String   @db.ObjectId
  author    User     @relation(fields: [authorId], references: [id])
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@map("posts")
}
```

```bash
npm run prisma:generate
```

### Step 2 — Add permissions to seed

```typescript
// prisma/seed.ts — add to PERMISSIONS array
{ name: 'posts:read',   description: 'Read posts' },
{ name: 'posts:create', description: 'Create posts' },
{ name: 'posts:update', description: 'Update posts' },
{ name: 'posts:delete', description: 'Delete posts' },
```

### Step 3 — Create the module files

```bash
mkdir src/modules/posts
```

**posts.service.ts** — copy the pattern from `users.service.ts`

**posts.validator.ts**
```typescript
import { Request } from 'express';
import { Validator } from '../../common/validator';

export function validateCreatePost(req: Request): void {
  new Validator(req.body)
    .required('title', 'Title')
    .minLength('title', 3, 'Title')
    .required('body', 'Body')
    .throw();
}
```

**posts.controller.ts** — thin, delegates to service

**posts.routes.ts**
```typescript
import { Router } from 'express';
import { asyncHandler } from '../../common/async-handler';
import { requireAuth } from '../../middleware/auth.middleware';
import { requirePermission } from '../../middleware/authorize.middleware';
import * as ctrl from './posts.controller';

const router = Router();

router.get('/', requireAuth, asyncHandler(ctrl.listPosts));
router.post('/', requireAuth, requirePermission('posts:create'), asyncHandler(ctrl.createPost));
router.get('/:id', requireAuth, asyncHandler(ctrl.getPost));
router.patch('/:id', requireAuth, requirePermission('posts:update'), asyncHandler(ctrl.updatePost));
router.delete('/:id', requireAuth, requirePermission('posts:delete'), asyncHandler(ctrl.deletePost));

export default router;
```

### Step 4 — Register the router

```typescript
// src/routes/index.ts
import postsRoutes from '../modules/posts/posts.routes';
router.use('/posts', postsRoutes);
```

Done. Your new module is live at `/api/v1/posts`.

---

## Scaling

### Rate limiting (current)

The current in-memory rate limiter works for **single-process** deployments. For multiple instances (Kubernetes, PM2 cluster, Vercel serverless), each process has its own counter — limits are per-process, not per-IP across the fleet.

**Solution for multi-instance:** Replace with `express-rate-limit` + `rate-limit-redis`:

```bash
npm install express-rate-limit rate-limit-redis ioredis
```

```typescript
import rateLimit from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import { Redis } from 'ioredis';

const redis = new Redis(process.env.REDIS_URL!);

export const rateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  store: new RedisStore({ sendCommand: (...args) => redis.call(...args) }),
});
```

### Database connection pooling

MongoDB Atlas handles connection pooling. Prisma reuses connections across requests by default. The global singleton in `database/client.ts` ensures only one Prisma instance per process.

### Horizontal scaling

The API is stateless (no in-process session state). Sessions are managed via DB-backed refresh tokens. You can run as many instances as needed behind a load balancer.

Only the rate limiter requires coordination between instances (see above).

### Caching

There is no cache layer in this boilerplate by design — it's a starter. Add caching for:
- **Permission lookups** — cache the user's role/permission set in Redis for the JWT lifetime
- **Heavy read queries** — `findMany` with complex filters

```typescript
// Pattern for Redis caching in a service
const cached = await redis.get(`user:${id}:permissions`);
if (cached) return JSON.parse(cached);
const perms = await loadFromDB(id);
await redis.setex(`user:${id}:permissions`, 900, JSON.stringify(perms)); // 15 min TTL
return perms;
```
