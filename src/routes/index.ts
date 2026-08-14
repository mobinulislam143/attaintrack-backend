import { Router } from 'express';
import healthRoutes from '../modules/health/health.routes';
import authRoutes from '../modules/auth/auth.routes';
import usersRoutes from '../modules/users/users.routes';
import rolesRoutes from '../modules/roles/roles.routes';
import permissionsRoutes from '../modules/permissions/permissions.routes';

// OBE domain
import departmentsRoutes from '../modules/departments/departments.routes';
import programsRoutes from '../modules/programs/programs.routes';
import programOutcomesRoutes from '../modules/program-outcomes/program-outcomes.routes';
import sessionsRoutes from '../modules/sessions/sessions.routes';
import coursesRoutes from '../modules/courses/courses.routes';
import courseOutcomesRoutes from '../modules/course-outcomes/course-outcomes.routes';
import copoMappingRoutes from '../modules/copo-mapping/copo-mapping.routes';
import assessmentsRoutes from '../modules/assessments/assessments.routes';
import studentsRoutes from '../modules/students/students.routes';
import marksRoutes from '../modules/marks/marks.routes';
import attainmentRoutes from '../modules/attainment/attainment.routes';
import reportsRoutes from '../modules/reports/reports.routes';
import dashboardRoutes from '../modules/dashboard/dashboard.routes';

// ─────────────────────────────────────────────────────────────────────────────
// Central route registry.
// All API routes are versioned under /api/v1.
// To add a new module: import its router and mount it here.
//
// The OBE block is ordered along the value chain, not alphabetically:
// structure → course → outcomes → mapping → assessment → marks → attainment
// → reports. Reading it top to bottom reads the product.
// ─────────────────────────────────────────────────────────────────────────────

const router = Router();

// ── Platform ────────────────────────────────────────────────────────────────
router.use('/health', healthRoutes);
router.use('/auth', authRoutes);
router.use('/users', usersRoutes);
router.use('/roles', rolesRoutes);
router.use('/permissions', permissionsRoutes);

// ── Academic structure ──────────────────────────────────────────────────────
router.use('/departments', departmentsRoutes);
router.use('/programs', programsRoutes);
router.use('/program-outcomes', programOutcomesRoutes);
router.use('/sessions', sessionsRoutes);

// ── Course and outcomes ─────────────────────────────────────────────────────
router.use('/courses', coursesRoutes);
router.use('/course-outcomes', courseOutcomesRoutes);
router.use('/copo-mapping', copoMappingRoutes);

// ── Assessment and marks ────────────────────────────────────────────────────
router.use('/assessments', assessmentsRoutes);
router.use('/students', studentsRoutes);
router.use('/marks', marksRoutes);

// ── Results ─────────────────────────────────────────────────────────────────
router.use('/attainment', attainmentRoutes);
router.use('/reports', reportsRoutes);
router.use('/dashboard', dashboardRoutes);

export default router;
