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
app.use(
  cors({
    origin: (origin, callback) => {
      const allowed = [env.frontendUrl, 'http://localhost:3000', 'http://localhost:5173'];
      // Allow requests with no origin (curl, Postman, server-to-server)
      if (!origin || allowed.includes(origin)) return callback(null, true);
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
