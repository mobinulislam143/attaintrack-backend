import { Router } from 'express';
import { asyncHandler } from '../../common/async-handler';
import { requireAuth } from '../../middleware/auth.middleware';
import { authRateLimiter } from '../../middleware/rate-limiter.middleware';
import * as ctrl from './auth.controller';

const router = Router();

// ── Public routes ─────────────────────────────────────────────────────────────

/**
 * POST /api/v1/auth/register
 * Body: { email, password, firstName, lastName }
 */
router.post('/register', authRateLimiter, asyncHandler(ctrl.register));

/**
 * POST /api/v1/auth/login
 * Body: { email, password }
 * Returns: { user, tokens: { accessToken, refreshToken } }
 */
router.post('/login', authRateLimiter, asyncHandler(ctrl.login));

/**
 * POST /api/v1/auth/refresh-token
 * Body: { refreshToken }
 * Returns: { accessToken, refreshToken }
 */
router.post('/refresh-token', asyncHandler(ctrl.refreshTokens));

/**
 * POST /api/v1/auth/forgot-password
 * Body: { email }
 */
router.post('/forgot-password', authRateLimiter, asyncHandler(ctrl.forgotPassword));

/**
 * POST /api/v1/auth/reset-password
 * Body: { token, password, confirmPassword }
 */
router.post('/reset-password', asyncHandler(ctrl.resetPassword));

/**
 * GET /api/v1/auth/verify-email?token=<token>
 */
router.get('/verify-email', asyncHandler(ctrl.verifyEmail));

// ── Protected routes ──────────────────────────────────────────────────────────

/**
 * GET /api/v1/auth/me
 * Returns the currently authenticated user's profile.
 */
router.get('/me', requireAuth, asyncHandler(ctrl.getMe));

/**
 * POST /api/v1/auth/logout
 * Body: { refreshToken } (optional — revokes that specific token)
 */
router.post('/logout', requireAuth, asyncHandler(ctrl.logout));

/**
 * POST /api/v1/auth/logout-all
 * Revokes all refresh tokens (logout from all devices).
 */
router.post('/logout-all', requireAuth, asyncHandler(ctrl.logoutAll));

/**
 * POST /api/v1/auth/change-password
 * Body: { currentPassword, newPassword, confirmPassword }
 */
router.post('/change-password', requireAuth, asyncHandler(ctrl.changePassword));

/**
 * POST /api/v1/auth/resend-verification
 */
router.post('/resend-verification', requireAuth, asyncHandler(ctrl.resendVerification));

export default router;
