import { Router } from 'express';
import { asyncHandler } from '../../common/async-handler';
import { requireAuth } from '../../middleware/auth.middleware';
import { requirePermission } from '../../middleware/authorize.middleware';
import { PERMISSIONS } from '../../common/permissions';
import * as ctrl from './programs.controller';

const router = Router();

router.use(requireAuth);

/** GET /api/v1/programs?departmentId&search&page&limit */
router.get('/', requirePermission(PERMISSIONS.programsRead), asyncHandler(ctrl.listPrograms));

/** GET /api/v1/programs/:id */
router.get('/:id', requirePermission(PERMISSIONS.programsRead), asyncHandler(ctrl.getProgram));

/** POST /api/v1/programs — body: { name, code, degree?, departmentId } */
router.post('/', requirePermission(PERMISSIONS.programsWrite), asyncHandler(ctrl.createProgram));

/** PATCH /api/v1/programs/:id */
router.patch('/:id', requirePermission(PERMISSIONS.programsWrite), asyncHandler(ctrl.updateProgram));

/** DELETE /api/v1/programs/:id — refused while courses remain */
router.delete('/:id', requirePermission(PERMISSIONS.programsWrite), asyncHandler(ctrl.deleteProgram));

export default router;
