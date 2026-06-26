import { Router } from 'express';
import { asyncHandler } from '../../common/async-handler';
import { healthCheck } from './health.controller';

const router = Router();

/**
 * GET /api/v1/health
 * Public endpoint. Returns server uptime, database status, and API version.
 */
router.get('/', asyncHandler(healthCheck));

export default router;
