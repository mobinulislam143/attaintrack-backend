import { Router } from 'express';
import { asyncHandler } from '../../common/async-handler';
import { requireAuth } from '../../middleware/auth.middleware';
import { requirePermission } from '../../middleware/authorize.middleware';
import { PERMISSIONS } from '../../common/permissions';
import * as ctrl from './reports.controller';

const router = Router();

router.use(requireAuth);

const generate = requirePermission(PERMISSIONS.reportsGenerate);
const exportPermission = requirePermission(PERMISSIONS.reportsExport);

/** GET /api/v1/reports?courseId=... */
router.get('/', generate, asyncHandler(ctrl.listReports));

/** POST /api/v1/reports — body: { courseId, runId?, config? } */
router.post('/', generate, asyncHandler(ctrl.generateReport));

/** GET /api/v1/reports/:id — the full payload the A4 preview renders */
router.get('/:id', generate, asyncHandler(ctrl.getReport));

/** GET /api/v1/reports/:id/pdf */
router.get('/:id/pdf', exportPermission, asyncHandler(ctrl.exportPdf));

/** GET /api/v1/reports/:id/excel */
router.get('/:id/excel', exportPermission, asyncHandler(ctrl.exportExcel));

/** DELETE /api/v1/reports/:id */
router.delete('/:id', generate, asyncHandler(ctrl.deleteReport));

export default router;
