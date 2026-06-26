import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { UnauthorizedError } from '../common/errors';
import { AuthUser } from '../types/express';

// ─────────────────────────────────────────────────────────────────────────────
// JWT authentication middleware.
// Expects:  Authorization: Bearer <access_token>
// Populates: req.user with decoded claims.
// ─────────────────────────────────────────────────────────────────────────────

interface AccessTokenPayload {
  sub: string;
  email: string;
  firstName: string;
  lastName: string;
  roles: string[];
  permissions: string[];
}

/**
 * Require a valid JWT access token.
 * Throws UnauthorizedError if the token is missing, expired, or invalid.
 */
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return next(new UnauthorizedError('Access token is required'));
  }

  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, env.jwtAccessSecret) as AccessTokenPayload;
    req.user = {
      id: payload.sub,
      email: payload.email,
      firstName: payload.firstName,
      lastName: payload.lastName,
      roles: payload.roles ?? [],
      permissions: payload.permissions ?? [],
    } satisfies AuthUser;
    next();
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      return next(new UnauthorizedError('Access token has expired', 'TOKEN_EXPIRED'));
    }
    next(new UnauthorizedError('Invalid access token', 'TOKEN_INVALID'));
  }
}

/**
 * Optionally attach user context if a valid token is present, but do not
 * reject the request if no token is provided.  Useful for public routes that
 * have enhanced behaviour when authenticated.
 */
export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return next();

  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, env.jwtAccessSecret) as AccessTokenPayload;
    req.user = {
      id: payload.sub,
      email: payload.email,
      firstName: payload.firstName,
      lastName: payload.lastName,
      roles: payload.roles ?? [],
      permissions: payload.permissions ?? [],
    };
  } catch {
    // Silently ignore invalid token for optional auth
  }
  next();
}
