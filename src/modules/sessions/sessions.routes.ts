import { Router } from 'express';
import { asyncHandler } from '../../common/async-handler';
import { requireAuth } from '../../middleware/auth.middleware';
import { requirePermission } from '../../middleware/authorize.middleware';
import { PERMISSIONS } from '../../common/permissions';
import * as ctrl from './sessions.controller';

const router = Router();

router.use(requireAuth);

const read = requirePermission(PERMISSIONS.sessionsRead);
const write = requirePermission(PERMISSIONS.sessionsWrite);

/** GET /api/v1/sessions — active first, then newest */
router.get('/', read, asyncHandler(ctrl.listSessions));

/** GET /api/v1/sessions/active — the session new courses default into */
router.get('/active', read, asyncHandler(ctrl.getActiveSession));

/** GET /api/v1/sessions/:id */
router.get('/:id', read, asyncHandler(ctrl.getSession));

/** POST /api/v1/sessions — body: { name, startDate, endDate, isActive? } */
router.post('/', write, asyncHandler(ctrl.createSession));

/** PATCH /api/v1/sessions/:id */
router.patch('/:id', write, asyncHandler(ctrl.updateSession));

/** POST /api/v1/sessions/:id/activate — deactivates every other session */
router.post('/:id/activate', write, asyncHandler(ctrl.activateSession));

/** DELETE /api/v1/sessions/:id — refused while courses remain */
router.delete('/:id', write, asyncHandler(ctrl.deleteSession));

export default router;
