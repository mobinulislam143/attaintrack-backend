import { Router } from 'express';
import { asyncHandler } from '../../common/async-handler';
import { requireAuth } from '../../middleware/auth.middleware';
import { requirePermission } from '../../middleware/authorize.middleware';
import { PERMISSIONS } from '../../common/permissions';
import * as ctrl from './assessments.controller';

const router = Router();

router.use(requireAuth);

const write = requirePermission(PERMISSIONS.assessmentsWrite);

/** GET /api/v1/assessments?courseId=... — students see published ones only */
router.get('/', asyncHandler(ctrl.listAssessments));

/** PATCH /api/v1/assessments/questions/:questionId — body: { courseOutcomeId | null } */
router.patch('/questions/:questionId', write, asyncHandler(ctrl.mapQuestion));

/** GET /api/v1/assessments/:id */
router.get('/:id', asyncHandler(ctrl.getAssessment));

/** POST /api/v1/assessments — body: { courseId, name, type?, weight?, conductedOn?, questions? } */
router.post('/', write, asyncHandler(ctrl.createAssessment));

/** PATCH /api/v1/assessments/:id */
router.patch('/:id', write, asyncHandler(ctrl.updateAssessment));

/** PUT /api/v1/assessments/:id/questions — body: { questions: [{ code, maxMarks, courseOutcomeId }] } */
router.put('/:id/questions', write, asyncHandler(ctrl.replaceQuestions));

/** POST /api/v1/assessments/:id/publish — body: { isPublished?: boolean } */
router.post('/:id/publish', write, asyncHandler(ctrl.setPublished));

/** DELETE /api/v1/assessments/:id */
router.delete('/:id', write, asyncHandler(ctrl.deleteAssessment));

export default router;
