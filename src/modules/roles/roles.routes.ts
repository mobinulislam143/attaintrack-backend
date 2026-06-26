import { Router } from 'express';
import { asyncHandler } from '../../common/async-handler';
import { requireAuth } from '../../middleware/auth.middleware';
import { requireRole } from '../../middleware/authorize.middleware';
import * as ctrl from './roles.controller';

const router = Router();

const adminOnly = [requireAuth, requireRole('admin')];

/** GET /api/v1/roles */
router.get('/', ...adminOnly, asyncHandler(ctrl.listRoles));

/** POST /api/v1/roles — Body: { name, description? } */
router.post('/', ...adminOnly, asyncHandler(ctrl.createRole));

/** GET /api/v1/roles/:id */
router.get('/:id', ...adminOnly, asyncHandler(ctrl.getRole));

/** PATCH /api/v1/roles/:id — Body: { name?, description? } */
router.patch('/:id', ...adminOnly, asyncHandler(ctrl.updateRole));

/** DELETE /api/v1/roles/:id */
router.delete('/:id', ...adminOnly, asyncHandler(ctrl.deleteRole));

/** POST /api/v1/roles/:id/permissions — Body: { permissionId } */
router.post('/:id/permissions', ...adminOnly, asyncHandler(ctrl.assignPermission));

/** DELETE /api/v1/roles/:id/permissions/:permissionId */
router.delete('/:id/permissions/:permissionId', ...adminOnly, asyncHandler(ctrl.removePermission));

export default router;
