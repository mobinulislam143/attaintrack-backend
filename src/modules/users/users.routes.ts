import { Router } from 'express';
import { asyncHandler } from '../../common/async-handler';
import { requireAuth } from '../../middleware/auth.middleware';
import { requireRole } from '../../middleware/authorize.middleware';
import * as ctrl from './users.controller';

const router = Router();

// ── Own profile (any authenticated user) ─────────────────────────────────────

/**
 * GET /api/v1/users/profile
 * Returns the authenticated user's own profile.
 */
router.get('/profile', requireAuth, asyncHandler(ctrl.getProfile));

/**
 * PATCH /api/v1/users/profile
 * Body: { firstName?, lastName?, avatar? }
 */
router.patch('/profile', requireAuth, asyncHandler(ctrl.updateProfile));

// ── Admin-only user management ────────────────────────────────────────────────

/**
 * GET /api/v1/users
 * Query: ?page=1&limit=10&search=&isActive=true&sortBy=createdAt&sortOrder=desc
 */
router.get('/', requireAuth, requireRole('admin'), asyncHandler(ctrl.listUsers));

/**
 * POST /api/v1/users
 * Body: { email, password, firstName, lastName, isActive? }
 */
router.post('/', requireAuth, requireRole('admin'), asyncHandler(ctrl.createUser));

/**
 * GET /api/v1/users/:id
 */
router.get('/:id', requireAuth, requireRole('admin'), asyncHandler(ctrl.getUser));

/**
 * PATCH /api/v1/users/:id
 * Body: { firstName?, lastName?, avatar?, isActive? }
 */
router.patch('/:id', requireAuth, requireRole('admin'), asyncHandler(ctrl.updateUser));

/**
 * DELETE /api/v1/users/:id
 */
router.delete('/:id', requireAuth, requireRole('admin'), asyncHandler(ctrl.deleteUser));

/**
 * POST /api/v1/users/:id/roles
 * Body: { roleId }
 */
router.post('/:id/roles', requireAuth, requireRole('admin'), asyncHandler(ctrl.assignRole));

/**
 * DELETE /api/v1/users/:id/roles/:roleId
 */
router.delete('/:id/roles/:roleId', requireAuth, requireRole('admin'), asyncHandler(ctrl.removeRole));

export default router;
