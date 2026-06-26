import { Request, Response, NextFunction } from 'express';
import { AppError, ValidationError, isAppError, isValidationError } from '../common/errors';
import { logger } from '../common/logger';
import { env } from '../config/env';

// ─────────────────────────────────────────────────────────────────────────────
// Global error handler — must be registered LAST in app.ts.
// Normalises all thrown errors into the standard API error envelope.
// ─────────────────────────────────────────────────────────────────────────────

interface ErrorResponse {
  success: false;
  message: string;
  code: string;
  errors?: Record<string, string>;
  stack?: string;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorMiddleware(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  // ── Validation errors ──────────────────────────────────────────────────────
  if (isValidationError(err)) {
    const body: ErrorResponse = {
      success: false,
      message: err.message,
      code: err.code,
      errors: err.errors,
    };
    res.status(422).json(body);
    return;
  }

  // ── Known operational errors ───────────────────────────────────────────────
  if (isAppError(err)) {
    if (err.statusCode >= 500) {
      logger.error('errorMiddleware', err.message, err);
    }
    const body: ErrorResponse = {
      success: false,
      message: err.message,
      code: err.code,
    };
    if (env.isDev) body.stack = err.stack;
    res.status(err.statusCode).json(body);
    return;
  }

  // ── Unknown / programming errors ───────────────────────────────────────────
  const raw = err as Error;
  logger.error('errorMiddleware', raw?.message ?? 'Unknown error', raw);

  const body: ErrorResponse = {
    success: false,
    message: env.isDev ? (raw?.message ?? 'Internal server error') : 'Internal server error',
    code: 'INTERNAL_SERVER_ERROR',
  };
  if (env.isDev) body.stack = raw?.stack;
  res.status(500).json(body);
}
