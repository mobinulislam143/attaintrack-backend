import { Router } from 'express';
import { asyncHandler } from '../../common/async-handler';
import { requireAuth } from '../../middleware/auth.middleware';
import { requirePermission } from '../../middleware/authorize.middleware';
import { PERMISSIONS } from '../../common/permissions';
import * as ctrl from './courses.controller';

const router = Router();

router.use(requireAuth);

const read = requirePermission(PERMISSIONS.coursesRead);
const write = requirePermission(PERMISSIONS.coursesWrite);

// Note: `courses:read` gates the route, but every course-bound handler also
// runs `requireCourseAccess` — two teachers hold identical permissions and
// must still not see each other's courses.

/** GET /api/v1/courses?programId&sessionId&teacherId&status&search — scoped to the caller */
router.get('/', read, asyncHandler(ctrl.listCourses));

/** GET /api/v1/courses/:id */
router.get('/:id', read, asyncHandler(ctrl.getCourse));

/** GET /api/v1/courses/:id/setup — per-step workflow completeness */
router.get('/:id/setup', read, asyncHandler(ctrl.getCourseSetup));

/** POST /api/v1/courses */
router.post('/', write, asyncHandler(ctrl.createCourse));

/** PATCH /api/v1/courses/:id — the assigned teacher may edit thresholds and title */
router.patch('/:id', read, asyncHandler(ctrl.updateCourse));

/** POST /api/v1/courses/:id/assign — body: { teacherId | null } */
router.post(
  '/:id/assign',
  requirePermission(PERMISSIONS.coursesAssign),
  asyncHandler(ctrl.assignTeacher),
);

/** DELETE /api/v1/courses/:id */
router.delete('/:id', write, asyncHandler(ctrl.deleteCourse));

export default router;
