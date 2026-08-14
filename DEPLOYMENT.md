# Deployment

| | URL | Vercel project |
|---|---|---|
| Backend (this repo) | https://attaintrack-backend.vercel.app | `attaintrack-backend` |
| Frontend | https://attaintrack-frontend.vercel.app | `attaintrack-frontend` |

The project is linked to this GitHub repository and redeploys on every push to
`main`. `vercel.json` routes all traffic to `api/index.ts`, which exports the
Express app from `src/app.ts` as a serverless function.

The frontend origin is allowed from `src/app.ts` rather than only through
`FRONTEND_URL`, so a deploy that forgets the variable still serves its own
frontend. Preview deployments are matched by pattern, scoped to this project's
hostnames rather than `*.vercel.app` — the latter would let any Vercel site on
the internet call this API with a user's credentials.

---

## Required environment variables

**The API returns 500 until these are set.** `src/config/env.ts` asserts the
three required ones at startup rather than letting the process come up and fail
on the first request.

Set them at **Vercel → attaintrack-backend → Settings → Environment
Variables**, for Production *and* Preview, then redeploy.

| Variable | Required | Notes |
|---|:---:|---|
| `DATABASE_URL` | ● | MongoDB connection string including the database name. |
| `JWT_ACCESS_SECRET` | ● | Any long random string. Rotating it invalidates every access token. |
| `JWT_REFRESH_SECRET` | ● | A *different* long random string. |
| `FRONTEND_URL` | | `https://attaintrack-frontend.vercel.app`. Drives the CORS allowlist and the links in verification and password-reset emails. |
| `NODE_ENV` | | `production` — hides stack traces from error responses. |
| `JWT_ACCESS_EXPIRES_IN` | | Defaults to `15m`; `1h` is used locally. |
| `JWT_REFRESH_EXPIRES_IN` | | Defaults to `7d`. |
| `RATE_LIMIT_WINDOW_MS` | | Defaults to `900000` (15 minutes). |
| `RATE_LIMIT_MAX` | | Defaults to `100`. |
| `SMTP_HOST` `SMTP_PORT` `SMTP_USER` `SMTP_PASS` `SMTP_FROM` | | Optional. Without them registration and password reset still work — only the emails are skipped, and a warning is logged. |

See `.env.example` for the full annotated list.

---

## Two settings that are easy to miss

**MongoDB Atlas network access.** Vercel functions have no fixed IP, so the
cluster must allow `0.0.0.0/0` under Network Access. Without it every request
hangs until the function times out, which looks like a slow API rather than a
firewall.

**Vercel deployment protection.** New projects may have Vercel Authentication
switched on, which answers 401 to anything without a session cookie — including
the frontend's API calls, which carry a JWT and not a Vercel cookie. Turn it off
for this project under Settings → Deployment Protection.

---

## Seeding the production database

The seed reads `DATABASE_URL` from the local `.env`, so point that at the
production cluster and run it from your machine:

```bash
npx ts-node prisma/seed.ts
```

It is idempotent — safe to re-run. Set `SEED_DEMO=false` to write the permission
catalogue, roles and the three accounts without the demonstration department,
courses, students and marks.

Change `ADMIN_PASSWORD`, `TEACHER_PASSWORD` and `STUDENT_PASSWORD` before
seeding anything real; the defaults are published in the project README.

---

## Verifying a deploy

```bash
curl https://attaintrack-backend.vercel.app/api/v1/health
```

A healthy response is `{"success":true,...}`. A 500 means the environment
variables above are missing or the database is unreachable.

The full API check exercises every route as all three roles:

```bash
BASE=https://attaintrack-backend.vercel.app/api/v1 node scripts/smoke.mjs
```
