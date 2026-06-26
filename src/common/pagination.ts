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
 */
export function parseSort(req: Request, allowedFields: string[] = ['createdAt']): SortParams {
  const field = String(req.query['sortBy'] ?? 'createdAt');
  const safeField = allowedFields.includes(field) ? field : 'createdAt';
  const rawOrder = String(req.query['sortOrder'] ?? 'desc').toLowerCase();
  const order = rawOrder === 'asc' ? 'asc' : 'desc';
  return { field: safeField, order };
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
