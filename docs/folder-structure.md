# Folder Structure

Every file exists for a reason. This document explains the purpose, the contents, and the design decision behind each one.

---

## Root

```
enterprise-backend-boilerplate/
├── .env                  ← your local secrets (git-ignored)
├── .env.example          ← template committed to source control
├── .gitignore
├── .dockerignore
├── Dockerfile
├── docker-compose.yml
├── nodemon.json          ← dev server config
├── package.json
├── tsconfig.json
├── vercel.json           ← Vercel serverless deployment config
├── README.md
├── CHANGELOG.md
└── LICENSE
```

### `.env` vs `.env.example`

`.env.example` is committed and shows every available variable with safe placeholder values. Developers copy it to `.env` and fill in real values. `.env` is git-ignored.

### `nodemon.json`

Watches `src/` for `.ts` and `.json` changes and restarts the dev server via `ts-node`. This is faster than the default `nodemon` behavior.

### `tsconfig.json`

Strict TypeScript with:
- `noUncheckedIndexedAccess: true` — forces you to handle `array[i]` potentially being `undefined`
- `noImplicitOverride: true` — class method overrides must be explicit
- `strict: true` — the full strict flag bundle

These settings catch bugs at compile time that would otherwise silently fail at runtime.

---

## `prisma/`

```
prisma/
├── schema.prisma    ← data models
└── seed.ts          ← initial data population
```

### `schema.prisma`

Defines six models:

| Model | Purpose |
|---|---|
| `User` | Application users with auth fields |
| `Role` | Named groups of permissions |
| `Permission` | Fine-grained `resource:action` capabilities |
| `UserRole` | Junction: User ↔ Role (many-to-many) |
| `RolePermission` | Junction: Role ↔ Permission (many-to-many) |
| `RefreshToken` | Server-side refresh token store |

The `output = "../src/generated/prisma"` in the generator means the Prisma client is generated into `src/generated/prisma/` and git-ignored. `npm install` triggers `postinstall: prisma generate` automatically.

### `seed.ts`

Run with `npm run prisma:seed`. Creates:
- 12 core permissions (`users:*`, `roles:*`, `permissions:*`)
- 2 core roles (`admin`, `user`)
- 1 admin user (`admin@example.com`)

Uses `upsert` throughout so it's safe to re-run without creating duplicates.

---

## `src/`

```
src/
├── app.ts
├── server.ts
├── config/
├── common/
├── types/
├── database/
├── middleware/
├── services/
├── routes/
└── modules/
```

### `src/app.ts`

The Express application factory. Contains only:
1. Middleware registration (in correct order — order matters with Express)
2. Route mounting
3. 404 and error handler at the end

Does **not** start the HTTP server. That's `server.ts`. This separation makes `app` importable by tests and by the Vercel entry point (`api/index.ts`) without starting a port listener.

### `src/server.ts`

The process entry point. Responsibilities:
1. Load `.env` (`import 'dotenv/config'`)
2. Validate all required env vars (exits with code 1 if missing)
3. Connect to MongoDB
4. Start the HTTP server
5. Register graceful shutdown handlers (SIGTERM, SIGINT)
6. Register unhandled rejection and uncaught exception handlers

---

## `src/config/`

```
config/
└── env.ts
```

### `env.ts`

The single source of truth for environment configuration. Exports:
- `validateEnv()` — call once at startup; exits if required vars are missing
- `env` — a typed readonly object with all config values

**Why:** Directly reading `process.env.FOO` across the codebase scatters unknown types everywhere (`string | undefined`). Centralizing it means:
- One place to see every variable the app uses
- TypeScript types are correct (required vars are `string`, not `string | undefined`)
- One place to set defaults

---

## `src/common/`

Shared utilities with **zero business logic**. Any file here can be used by any module.

### `errors.ts`

```
AppError (base)
├── BadRequestError     400
├── ValidationError     422  ← has .errors: Record<string, string>
├── UnauthorizedError   401
├── ForbiddenError      403
├── NotFoundError       404
├── ConflictError       409
├── UnprocessableError  422
├── TooManyRequestsError 429
└── ServiceUnavailableError 503
```

**Why a hierarchy instead of one generic error class?**
Each subclass has a fixed HTTP status code and a default code string. Services can `throw new NotFoundError('User')` without knowing anything about HTTP. The controller and global handler take care of the response.

### `logger.ts`

Format: `[2026-06-26T10:00:00.000Z] [LEVEL] [context] message — extra`

Four levels: `info`, `warn`, `error`, `debug`. Debug only outputs in development.

**Why not Winston/Pino?** Zero deps is a selling point for a boilerplate. Pino is recommended for production — the interface is identical, just swap the implementation.

### `async-handler.ts`

```typescript
asyncHandler(fn) → RequestHandler
```

Without this, every controller needs:
```typescript
try { await service.do() } catch (e) { next(e) }
```

With it:
```typescript
router.get('/', asyncHandler(ctrl.getAll));
```

Any rejected promise is caught and passed to `next(err)` → global error handler.

### `response.ts`

Three helpers that enforce the standard envelope:

```typescript
sendSuccess(res, data, message?, status?, meta?)   // 200
sendCreated(res, data, message?)                   // 201
sendNoContent(res)                                 // 204
```

**Why not call `res.json()` directly in controllers?**
If you call `res.json()` directly, a future change to the response shape requires hunting every controller. With helpers, change the shape in one place.

### `pagination.ts`

```typescript
parsePagination(req) → { page, limit, skip }
parseSort(req, allowedFields) → { field, order }
buildMeta(total, page, limit) → ApiMeta
```

`parseSort` takes an `allowedFields` whitelist — this prevents users from sorting by arbitrary column names, which could expose internal field names or cause unexpected query behavior.

### `crypto.ts`

Uses Node.js built-in `crypto` — no bcrypt dependency.

```typescript
hashPassword(password)           → Promise<"salt:hash">
verifyPassword(password, stored) → Promise<boolean>
generateSecureToken(bytes?)      → string (hex)
generateOtp()                    → string (6-digit)
```

**scrypt parameters:** N=32768, r=8, p=1 (Node.js defaults). These are the OWASP-recommended minimum for 2024.

**Timing-safe comparison:** `timingSafeEqual()` takes constant time regardless of where the strings differ — prevents timing attacks.

### `validator.ts`

A fluent validation DSL:

```typescript
new Validator(req.body)
  .required('email', 'Email')
  .email('email', 'Email')
  .required('password', 'Password')
  .minLength('password', 8, 'Password')
  .strongPassword('password', 'Password')
  .throw(); // throws ValidationError if any rule failed
```

**Why not express-validator or Zod?**
- Zero new dependencies
- The DSL is readable and produces per-field error maps
- For a boilerplate, it's better to show the pattern than to mandate a library

Swap this out for Zod in production if you prefer — just replace the validator calls in each `*.validator.ts`.

---

## `src/types/`

```
types/
└── express.d.ts
```

### `express.d.ts`

Extends the Express `Request` type to include `user?: AuthUser` after `requireAuth` runs.

```typescript
interface AuthUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  roles: string[];
  permissions: string[];
}
```

Without this, `req.user` would be `any` and you'd lose type safety in every controller.

---

## `src/database/`

```
database/
└── client.ts
```

### `client.ts`

A singleton `PrismaClient`. Uses the `global.__prisma` trick to prevent multiple instances during hot-reload in development (each file change would otherwise create a new connection pool).

Exports:
```typescript
export const prisma: PrismaClient
export async function connectDB(): Promise<void>
export async function disconnectDB(): Promise<void>
```

---

## `src/middleware/`

Middleware files are pure Express middleware functions — no business logic.

### `auth.middleware.ts`

`requireAuth` — extracts and verifies the Bearer JWT. Populates `req.user`.

`optionalAuth` — same but doesn't reject if no token is provided. Use for public routes that show enhanced content when authenticated.

### `authorize.middleware.ts`

`requireRole(...roles)` — passes if user has any listed role.

`requirePermission(...permissions)` — passes if user has ALL listed permissions.

`requireAnyPermission(...permissions)` — passes if user has ANY listed permission.

All require `requireAuth` to have already populated `req.user`.

### `error.middleware.ts`

The global error handler (must be the last `app.use()` in `app.ts`).

Priority:
1. `ValidationError` → 422 with `.errors` map
2. Known `AppError` subclasses → their `.statusCode`
3. Unknown errors → 500, full message in dev, generic in prod

5xx errors are logged with stack trace. 4xx errors are returned as-is.

### `not-found.middleware.ts`

404 handler for routes that don't match any registered path. Must come after all route registrations but before `errorMiddleware`.

### `rate-limiter.middleware.ts`

Sliding-window in-memory rate limiter. Stores counters in a `Map<IP, { count, resetAt }>`.

`rateLimiter(options)` — configurable factory (window, max, key prefix).

`authRateLimiter` — pre-configured strict instance (10 req / 15 min) for auth routes.

> Replace with Redis for multi-instance deployments. See [architecture.md#scaling](./architecture.md#scaling).

---

## `src/services/`

Shared services used by multiple modules.

### `email.service.ts`

```typescript
emailService.send({ to, subject, html, text? })
emailService.sendPasswordReset(to, resetUrl, firstName)
emailService.sendEmailVerification(to, verifyUrl, firstName)
emailService.sendWelcome(to, firstName)
```

Lazily initializes the SMTP transporter on first use. If SMTP is not configured, throws a descriptive error (doesn't silently fail). Email sending failures in registration/password flows are non-fatal — they're caught and logged, so a misconfigured SMTP doesn't break core auth flows.

HTML templates are inline functions returning base-64-safe HTML strings. Replace with Handlebars or MJML for production-grade templating.

---

## `src/routes/`

```
routes/
└── index.ts
```

### `index.ts`

The central route registry. The only file that knows about all modules:

```typescript
router.use('/health', healthRoutes);
router.use('/auth', authRoutes);
router.use('/users', usersRoutes);
// add yours here
```

Mounted in `app.ts` under `/api/v1`.

---

## `src/modules/`

Feature-based modules. Each module owns all its own code.

```
modules/
├── health/        ← no service needed, controller talks to Prisma directly
├── auth/          ← the most complex module: tokens, email, password flows
├── users/         ← CRUD + search/filter/sort/pagination
├── roles/         ← CRUD + permission assignment
└── permissions/   ← CRUD, enforces resource:action naming
```

**The golden rule:** modules never import each other. If two modules share logic, move it to `src/common/` or `src/services/`.

---

## `api/`

```
api/
└── index.ts
```

Vercel serverless entry point. Imports and re-exports `app` from `src/app.ts`. Vercel calls this file on every request, so no `server.listen()` here — Vercel handles the HTTP layer.

---

## `docs/`

```
docs/
├── api.md               ← complete API reference
├── architecture.md      ← this document + system design
└── folder-structure.md  ← you are here
```
