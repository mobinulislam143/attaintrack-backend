import { Router } from 'express';
import { asyncHandler } from '../../common/async-handler';
import { requireAuth } from '../../middleware/auth.middleware';
import { requirePermission } from '../../middleware/authorize.middleware';
import { PERMISSIONS } from '../../common/permissions';
import * as ctrl from './students.controller';

const router = Router();

router.use(requireAuth);

const read = requirePermission(PERMISSIONS.studentsRead);
const write = requirePermission(PERMISSIONS.studentsWrite);

/** GET /api/v1/students?courseId&programId&search — courseId narrows to enrolled */
router.get('/', read, asyncHandler(ctrl.listStudents));

/** POST /api/v1/students/bulk — body: { students[], programId?, courseId? } */
router.post('/bulk', write, asyncHandler(ctrl.bulkImportStudents));

/** POST /api/v1/students/enrollments — body: { courseId, studentIds[] } */
router.post('/enrollments', write, asyncHandler(ctrl.enrollStudents));

/** GET /api/v1/students/enrollments/:courseId */
router.get('/enrollments/:courseId', read, asyncHandler(ctrl.listEnrolled));

/** DELETE /api/v1/students/enrollments/:courseId/:studentId */
router.delete('/enrollments/:courseId/:studentId', write, asyncHandler(ctrl.unenrollStudent));

/** GET /api/v1/students/:id */
router.get('/:id', read, asyncHandler(ctrl.getStudent));

/** POST /api/v1/students — body: { studentId, name, email?, programId? } */
router.post('/', write, asyncHandler(ctrl.createStudent));

/** PATCH /api/v1/students/:id */
router.patch('/:id', write, asyncHandler(ctrl.updateStudent));

/** POST /api/v1/students/:id/link — body: { userId | null } */
router.post('/:id/link', write, asyncHandler(ctrl.linkAccount));

/** DELETE /api/v1/students/:id */
router.delete('/:id', write, asyncHandler(ctrl.deleteStudent));

export default router;
