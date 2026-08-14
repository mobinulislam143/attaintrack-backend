import { Router } from 'express';
import { asyncHandler } from '../../common/async-handler';
import { requireAuth } from '../../middleware/auth.middleware';
import { requirePermission } from '../../middleware/authorize.middleware';
import { PERMISSIONS } from '../../common/permissions';
import * as ctrl from './course-outcomes.controller';

const router = Router();

router.use(requireAuth);

// Reading a CO rides on course access rather than a dedicated permission —
// a student may see the outcomes of a course they are enrolled in.
const write = requirePermission(PERMISSIONS.courseOutcomesWrite);

/** GET /api/v1/course-outcomes?courseId=... — ordered */
router.get('/', asyncHandler(ctrl.listCourseOutcomes));

/** POST /api/v1/course-outcomes/reorder — body: { courseId, orderedIds[] } */
router.post('/reorder', write, asyncHandler(ctrl.reorderCourseOutcomes));

/** GET /api/v1/course-outcomes/:id */
router.get('/:id', asyncHandler(ctrl.getCourseOutcome));

/** POST /api/v1/course-outcomes — body: { courseId, statement, code?, target? } */
router.post('/', write, asyncHandler(ctrl.createCourseOutcome));

/** PATCH /api/v1/course-outcomes/:id */
router.patch('/:id', write, asyncHandler(ctrl.updateCourseOutcome));

/** DELETE /api/v1/course-outcomes/:id — refused while questions map to it */
router.delete('/:id', write, asyncHandler(ctrl.deleteCourseOutcome));

export default router;
