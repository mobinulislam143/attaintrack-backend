import { Router } from 'express';
import { asyncHandler } from '../../common/async-handler';
import { requireAuth } from '../../middleware/auth.middleware';
import { requirePermission } from '../../middleware/authorize.middleware';
import { PERMISSIONS } from '../../common/permissions';
import * as ctrl from './departments.controller';

const router = Router();

router.use(requireAuth);

/** GET /api/v1/departments?page&limit&search&sortBy&sortOrder */
router.get('/', requirePermission(PERMISSIONS.departmentsRead), asyncHandler(ctrl.listDepartments));

/** GET /api/v1/departments/:id */
router.get('/:id', requirePermission(PERMISSIONS.departmentsRead), asyncHandler(ctrl.getDepartment));

/** POST /api/v1/departments — body: { name, code } */
router.post('/', requirePermission(PERMISSIONS.departmentsWrite), asyncHandler(ctrl.createDepartment));

/** PATCH /api/v1/departments/:id */
router.patch('/:id', requirePermission(PERMISSIONS.departmentsWrite), asyncHandler(ctrl.updateDepartment));

/** DELETE /api/v1/departments/:id — refused while programs remain */
router.delete('/:id', requirePermission(PERMISSIONS.departmentsWrite), asyncHandler(ctrl.deleteDepartment));

export default router;
