import { Request } from 'express';
import { ApiMeta } from './response';

// ─────────────────────────────────────────────────────────────────────────────
// Pagination, sorting, and filtering helpers.
// ─────────────────────────────────────────────────────────────────────────────

export interface PaginationParams {
  page: number;
  limit: number;
  skip: number;
}

export interface SortParams {
  field: string;
  order: 'asc' | 'desc';
}

export interface FilterParams {
  search?: string;
  [key: string]: unknown;
}

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 10;

/**
 * Extract and sanitise pagination params from the request query string.
 * Accepts `?page=2&limit=25`.
 */
export function parsePagination(req: Request): PaginationParams {
  const page = Math.max(1, parseInt(String(req.query['page'] ?? '1'), 10) || 1);
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, parseInt(String(req.query['limit'] ?? DEFAULT_LIMIT), 10) || DEFAULT_LIMIT),
  );
  return { page, limit, skip: (page - 1) * limit };
}

/**
 * Extract and sanitise sort params from the request query string.
 * Accepts `?sortBy=createdAt&sortOrder=desc`.
 *
 * @param allowedFields  Whitelist of sortable fields. Defaults to `['createdAt']`.
 * @param defaults       Fallback used when the client sends nothing. Reference
 *                       tables (departments, programs) want name ascending;
 *                       activity feeds want createdAt descending. Newest-first
 *                       is a poor default for a lookup list nobody scrolls.
 */
export function parseSort(
  req: Request,
  allowedFields: string[] = ['createdAt'],
  defaults: SortParams = { field: 'createdAt', order: 'desc' },
): SortParams {
  const requested = req.query['sortBy'] ? String(req.query['sortBy']) : null;
  const field = requested && allowedFields.includes(requested) ? requested : defaults.field;

  const rawOrder = req.query['sortOrder'] ? String(req.query['sortOrder']).toLowerCase() : null;
  const order = rawOrder === 'asc' ? 'asc' : rawOrder === 'desc' ? 'desc' : defaults.order;

  return { field, order };
}

/**
 * Build the `ApiMeta` pagination metadata block for a response.
 */
export function buildMeta(total: number, page: number, limit: number): ApiMeta {
  const totalPages = Math.ceil(total / limit);
  return {
    page,
    limit,
    total,
    totalPages,
    hasNextPage: page < totalPages,
    hasPrevPage: page > 1,
  };
}
