import { Router } from 'express';
import { asyncHandler } from '../../common/async-handler';
import { requireAuth } from '../../middleware/auth.middleware';
import { requirePermission } from '../../middleware/authorize.middleware';
import { PERMISSIONS } from '../../common/permissions';
import * as ctrl from './copo-mapping.controller';

const router = Router();

router.use(requireAuth);

/** GET /api/v1/copo-mapping?courseId=... — COs, POs, entries and what is missing */
router.get('/', asyncHandler(ctrl.getMatrix));

/**
 * PUT /api/v1/copo-mapping
 * Body: { courseId, entries: [{ courseOutcomeId, programOutcomeId, strength }] }
 * Strength 0 removes the mapping. Only changed cells need to be sent.
 */
router.put('/', requirePermission(PERMISSIONS.copoMappingWrite), asyncHandler(ctrl.saveMatrix));

export default router;
