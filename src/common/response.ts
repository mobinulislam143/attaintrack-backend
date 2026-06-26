import { Response } from 'express';

// ─────────────────────────────────────────────────────────────────────────────
// Standard API response envelope.
// Every endpoint must use these helpers for consistency.
//
// Success:  { success: true,  message, data, meta? }
// Error:    { success: false, message, code, errors? }
// ─────────────────────────────────────────────────────────────────────────────

export interface ApiMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
}

export interface ApiSuccess<T = unknown> {
  success: true;
  message: string;
  data: T;
  meta?: ApiMeta;
}

export interface ApiError {
  success: false;
  message: string;
  code: string;
  errors?: Record<string, string>;
}

/**
 * Send a successful JSON response.
 *
 * @param res     Express Response
 * @param data    Payload to serialize
 * @param message Human-readable message (shown in API clients / docs)
 * @param status  HTTP status code (default 200)
 * @param meta    Optional pagination metadata
 */
export function sendSuccess<T>(
  res: Response,
  data: T,
  message = 'Success',
  status = 200,
  meta?: ApiMeta,
): void {
  const body: ApiSuccess<T> = { success: true, message, data };
  if (meta) body.meta = meta;
  res.status(status).json(body);
}

/**
 * Send a 201 Created response.
 */
export function sendCreated<T>(res: Response, data: T, message = 'Created successfully'): void {
  sendSuccess(res, data, message, 201);
}

/**
 * Send a 204 No Content response.
 */
export function sendNoContent(res: Response): void {
  res.status(204).send();
}
