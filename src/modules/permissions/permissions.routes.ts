import { Router } from 'express';
import { asyncHandler } from '../../common/async-handler';
import { requireAuth } from '../../middleware/auth.middleware';
import { requireRole } from '../../middleware/authorize.middleware';
import * as ctrl from './permissions.controller';

const router = Router();

const adminOnly = [requireAuth, requireRole('admin')];

/** GET /api/v1/permissions */
router.get('/', ...adminOnly, asyncHandler(ctrl.listPermissions));

/** POST /api/v1/permissions — Body: { name, description? } */
router.post('/', ...adminOnly, asyncHandler(ctrl.createPermission));

/** GET /api/v1/permissions/:id */
router.get('/:id', ...adminOnly, asyncHandler(ctrl.getPermission));

/** PATCH /api/v1/permissions/:id */
router.patch('/:id', ...adminOnly, asyncHandler(ctrl.updatePermission));

/** DELETE /api/v1/permissions/:id */
router.delete('/:id', ...adminOnly, asyncHandler(ctrl.deletePermission));

export default router;
