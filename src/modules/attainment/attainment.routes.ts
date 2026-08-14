import { Router } from 'express';
import { asyncHandler } from '../../common/async-handler';
import { requireAuth } from '../../middleware/auth.middleware';
import { requirePermission } from '../../middleware/authorize.middleware';
import { PERMISSIONS } from '../../common/permissions';
import * as ctrl from './attainment.controller';

const router = Router();

router.use(requireAuth);

const read = requirePermission(PERMISSIONS.attainmentRead);

/** POST /api/v1/attainment/calculate — body: { courseId } */
router.post(
  '/calculate',
  requirePermission(PERMISSIONS.attainmentCalculate),
  asyncHandler(ctrl.calculate),
);

/**
 * GET /api/v1/attainment/me?courseId=... — the caller's own CO breakdown.
 * Scoped by identity, not by permission; published assessments only.
 */
router.get('/me', asyncHandler(ctrl.getMyPerformance));

/** GET /api/v1/attainment?courseId=... — the most recent run, or null */
router.get('/', read, asyncHandler(ctrl.getLatest));

/** GET /api/v1/attainment/history?courseId=... */
router.get('/history', read, asyncHandler(ctrl.getHistory));

/** GET /api/v1/attainment/students?courseId=... — per-student CO breakdown */
router.get('/students', read, asyncHandler(ctrl.getStudentPerformance));

/** GET /api/v1/attainment/runs/:runId */
router.get('/runs/:runId', read, asyncHandler(ctrl.getRun));

export default router;
