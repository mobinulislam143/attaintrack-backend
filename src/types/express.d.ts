// ─────────────────────────────────────────────────────────────────────────────
// Augment Express Request with the authenticated user context injected by
// the auth middleware.  Import this file anywhere to get typed `req.user`.
// ─────────────────────────────────────────────────────────────────────────────

export interface AuthUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  roles: string[];
  permissions: string[];
}

declare global {
  namespace Express {
    interface Request {
      /** Populated by `authMiddleware` after JWT verification. */
      user?: AuthUser;
    }
  }
}

export {};
