import { Router } from 'express';
import healthRoutes from '../modules/health/health.routes';
import authRoutes from '../modules/auth/auth.routes';
import usersRoutes from '../modules/users/users.routes';
import rolesRoutes from '../modules/roles/roles.routes';
import permissionsRoutes from '../modules/permissions/permissions.routes';

// ─────────────────────────────────────────────────────────────────────────────
// Central route registry.
// All API routes are versioned under /api/v1.
// To add a new module: import its router and mount it here.
// ─────────────────────────────────────────────────────────────────────────────

const router = Router();

router.use('/health', healthRoutes);
router.use('/auth', authRoutes);
router.use('/users', usersRoutes);
router.use('/roles', rolesRoutes);
router.use('/permissions', permissionsRoutes);

export default router;
