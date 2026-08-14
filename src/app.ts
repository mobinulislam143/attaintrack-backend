import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { env } from './config/env';
import { errorMiddleware } from './middleware/error.middleware';
import { notFoundMiddleware } from './middleware/not-found.middleware';
import { rateLimiter } from './middleware/rate-limiter.middleware';
import apiRoutes from './routes/index';

// ─────────────────────────────────────────────────────────────────────────────
// Express application factory.
// Middleware is ordered intentionally — do not rearrange without reason.
// ─────────────────────────────────────────────────────────────────────────────

const app = express();

// ── Security headers ──────────────────────────────────────────────────────────
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

// ── CORS ──────────────────────────────────────────────────────────────────────
//
// The deployed frontend is listed here rather than left to FRONTEND_URL alone,
// so a deploy that forgets the variable still serves its own frontend. Vercel
// also gives every preview build its own hostname, so previews are matched by
// pattern — scoped to this project's names, not to `*.vercel.app`, which would
// let any Vercel site on the internet call this API with a user's credentials.

const ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:5173',
  'https://attaintrack-frontend.vercel.app',
  'https://attaintrack-frontend-mahis-projects-0c38f8e8.vercel.app',
];

/** Preview deployments of this project: attaintrack-frontend-<hash>-<team>.vercel.app */
const PREVIEW_ORIGIN = /^https:\/\/attaintrack-frontend-[a-z0-9-]+\.vercel\.app$/;

function isAllowedOrigin(origin: string): boolean {
  if (origin === env.frontendUrl) return true;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  return PREVIEW_ORIGIN.test(origin);
}

app.use(
  cors({
    origin: (origin, callback) => {
      // Requests with no Origin header (curl, Postman, server-to-server)
      if (!origin || isAllowedOrigin(origin)) return callback(null, true);
      callback(new Error(`CORS: origin '${origin}' is not allowed`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }),
);

// ── HTTP request logging ──────────────────────────────────────────────────────
app.use(morgan(env.isDev ? 'dev' : 'combined'));

// ── Body parsing ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// ── Global rate limiter ───────────────────────────────────────────────────────
app.use(rateLimiter());

// ── API routes ────────────────────────────────────────────────────────────────
app.use('/api/v1', apiRoutes);

// ── 404 handler ───────────────────────────────────────────────────────────────
app.use(notFoundMiddleware);

// ── Global error handler (must be LAST) ──────────────────────────────────────
app.use(errorMiddleware);

export default app;
