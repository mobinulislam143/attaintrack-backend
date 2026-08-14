import { Router } from 'express';
import { asyncHandler } from '../../common/async-handler';
import { requireAuth } from '../../middleware/auth.middleware';
import { requireRole } from '../../middleware/authorize.middleware';
import * as ctrl from './dashboard.controller';

const router = Router();

router.use(requireAuth);

/** GET /api/v1/dashboard — whichever dashboard the caller's role earns */
router.get('/', asyncHandler(ctrl.getMyDashboard));

/** GET /api/v1/dashboard/teacher */
router.get('/teacher', requireRole('teacher', 'admin'), asyncHandler(ctrl.getTeacherDashboard));

/** GET /api/v1/dashboard/admin */
router.get('/admin', requireRole('admin'), asyncHandler(ctrl.getAdminDashboard));

/** GET /api/v1/dashboard/student */
router.get('/student', requireRole('student'), asyncHandler(ctrl.getStudentDashboard));

export default router;
