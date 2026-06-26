import { Request, Response, NextFunction, RequestHandler } from 'express';
import { ForbiddenError, UnauthorizedError } from '../common/errors';

// ─────────────────────────────────────────────────────────────────────────────
// Role-Based Access Control (RBAC) middleware.
// Always chain AFTER `requireAuth`.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Require the authenticated user to have at least one of the specified roles.
 *
 * @example
 * router.delete('/users/:id', requireAuth, requireRole('admin'), handler);
 */
export function requireRole(...roles: string[]): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) return next(new UnauthorizedError());
    const hasRole = roles.some((r) => req.user!.roles.includes(r));
    if (!hasRole) {
      return next(new ForbiddenError(`Required role: ${roles.join(' | ')}`));
    }
    next();
  };
}

/**
 * Require the authenticated user to have ALL of the specified permissions.
 *
 * @example
 * router.post('/posts', requireAuth, requirePermission('posts:create'), handler);
 */
export function requirePermission(...permissions: string[]): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) return next(new UnauthorizedError());
    const hasAll = permissions.every((p) => req.user!.permissions.includes(p));
    if (!hasAll) {
      return next(new ForbiddenError(`Missing permission(s): ${permissions.join(', ')}`));
    }
    next();
  };
}

/**
 * Require the authenticated user to have at least one of the specified permissions.
 */
export function requireAnyPermission(...permissions: string[]): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) return next(new UnauthorizedError());
    const hasAny = permissions.some((p) => req.user!.permissions.includes(p));
    if (!hasAny) {
      return next(new ForbiddenError(`Required permission: ${permissions.join(' | ')}`));
    }
    next();
  };
}
