import { Router } from 'express';
import { asyncHandler } from '../../common/async-handler';
import { requireAuth } from '../../middleware/auth.middleware';
import { requirePermission } from '../../middleware/authorize.middleware';
import { PERMISSIONS } from '../../common/permissions';
import * as ctrl from './program-outcomes.controller';

const router = Router();

router.use(requireAuth);

const read = requirePermission(PERMISSIONS.programOutcomesRead);
const write = requirePermission(PERMISSIONS.programOutcomesWrite);

/** GET /api/v1/program-outcomes?programId=... — ordered, not paginated */
router.get('/', read, asyncHandler(ctrl.listProgramOutcomes));

/** POST /api/v1/program-outcomes/reorder — body: { programId, orderedIds[] } */
router.post('/reorder', write, asyncHandler(ctrl.reorderProgramOutcomes));

/** GET /api/v1/program-outcomes/:id */
router.get('/:id', read, asyncHandler(ctrl.getProgramOutcome));

/** POST /api/v1/program-outcomes — body: { programId, code, title, description?, target? } */
router.post('/', write, asyncHandler(ctrl.createProgramOutcome));

/** PATCH /api/v1/program-outcomes/:id */
router.patch('/:id', write, asyncHandler(ctrl.updateProgramOutcome));

/** DELETE /api/v1/program-outcomes/:id — refused while Course Outcomes map to it */
router.delete('/:id', write, asyncHandler(ctrl.deleteProgramOutcome));

export default router;
