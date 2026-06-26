import jwt from 'jsonwebtoken';
import { prisma } from '../../database/client';
import { env } from '../../config/env';
import { hashPassword, verifyPassword, generateSecureToken } from '../../common/crypto';
import { emailService } from '../../services/email.service';
import { logger } from '../../common/logger';
import {
  ConflictError,
  UnauthorizedError,
  NotFoundError,
  BadRequestError,
  ForbiddenError,
} from '../../common/errors';

// ─────────────────────────────────────────────────────────────────────────────
// Auth service — all authentication and session business logic lives here.
// ─────────────────────────────────────────────────────────────────────────────

interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

interface UserProfile {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  avatar: string | null;
  isEmailVerified: boolean;
  roles: string[];
  permissions: string[];
  createdAt: Date;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function getUserWithRoles(userId: string) {
  return prisma.user.findUnique({
    where: { id: userId },
    include: {
      userRoles: {
        include: {
          role: {
            include: { rolePermissions: { include: { permission: true } } },
          },
        },
      },
    },
  });
}

function extractRolesAndPermissions(userWithRoles: NonNullable<Awaited<ReturnType<typeof getUserWithRoles>>>) {
  const roles = userWithRoles.userRoles.map((ur) => ur.role.name);
  const permissions = [
    ...new Set(
      userWithRoles.userRoles.flatMap((ur) =>
        ur.role.rolePermissions.map((rp) => rp.permission.name),
      ),
    ),
  ];
  return { roles, permissions };
}

function signAccessToken(payload: {
  sub: string;
  email: string;
  firstName: string;
  lastName: string;
  roles: string[];
  permissions: string[];
}): string {
  return jwt.sign(payload, env.jwtAccessSecret, {
    expiresIn: env.jwtAccessExpiresIn as jwt.SignOptions['expiresIn'],
  });
}

async function createRefreshToken(userId: string): Promise<string> {
  const token = generateSecureToken(40);
  const expiresAt = new Date(Date.now() + parseDuration(env.jwtRefreshExpiresIn));

  await prisma.refreshToken.create({ data: { token, userId, expiresAt } });
  return token;
}

/** Parse duration strings like '7d', '24h', '15m' into milliseconds. */
function parseDuration(duration: string): number {
  const match = /^(\d+)([smhd])$/.exec(duration);
  if (!match) return 7 * 24 * 60 * 60 * 1000; // default 7 days
  const value = parseInt(match[1]!, 10);
  const unit = match[2]!;
  const factors: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return value * (factors[unit] ?? 86_400_000);
}

function toProfile(user: NonNullable<Awaited<ReturnType<typeof getUserWithRoles>>>, roles: string[], permissions: string[]): UserProfile {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    avatar: user.avatar,
    isEmailVerified: user.isEmailVerified,
    roles,
    permissions,
    createdAt: user.createdAt,
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

export const authService = {
  /**
   * Register a new user account.
   * Sends a verification email if SMTP is configured.
   */
  async register(data: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
  }): Promise<{ user: UserProfile; tokens: TokenPair }> {
    const existing = await prisma.user.findUnique({ where: { email: data.email.toLowerCase() } });
    if (existing) throw new ConflictError('An account with this email already exists');

    const password = await hashPassword(data.password);
    const emailVerifyToken = generateSecureToken();

    const user = await prisma.user.create({
      data: {
        email: data.email.toLowerCase(),
        password,
        firstName: data.firstName,
        lastName: data.lastName,
        emailVerifyToken,
      },
    });

    // Send verification email (non-blocking — failure doesn't abort registration)
    const verifyUrl = `${env.frontendUrl}/verify-email?token=${emailVerifyToken}`;
    emailService
      .sendEmailVerification(user.email, verifyUrl, user.firstName)
      .catch((err) => logger.warn('authService', 'Verification email failed', err));

    const tokens = await authService.generateTokens(user.id);

    const userWithRoles = await getUserWithRoles(user.id);
    const { roles, permissions } = extractRolesAndPermissions(userWithRoles!);

    return { user: toProfile(userWithRoles!, roles, permissions), tokens };
  },

  /**
   * Authenticate with email + password. Returns a token pair on success.
   */
  async login(email: string, password: string): Promise<{ user: UserProfile; tokens: TokenPair }> {
    const user = await getUserWithRoles(
      (await prisma.user.findUnique({ where: { email: email.toLowerCase() } }))?.id ?? '',
    );
    if (!user) throw new UnauthorizedError('Invalid email or password');
    if (!user.isActive) throw new ForbiddenError('Your account has been deactivated');

    const isValid = await verifyPassword(password, user.password);
    if (!isValid) throw new UnauthorizedError('Invalid email or password');

    const { roles, permissions } = extractRolesAndPermissions(user);
    const tokens = await authService.generateTokens(user.id, roles, permissions);

    return { user: toProfile(user, roles, permissions), tokens };
  },

  /**
   * Issue a new token pair using a valid refresh token.
   * Rotates the refresh token (old one is deleted, new one is issued).
   */
  async refreshTokens(refreshToken: string): Promise<TokenPair> {
    const stored = await prisma.refreshToken.findUnique({
      where: { token: refreshToken },
      include: { user: true },
    });

    if (!stored || stored.expiresAt < new Date()) {
      if (stored) await prisma.refreshToken.delete({ where: { id: stored.id } });
      throw new UnauthorizedError('Refresh token is invalid or expired', 'REFRESH_TOKEN_INVALID');
    }

    if (!stored.user.isActive) throw new ForbiddenError('Account deactivated');

    // Delete old token (rotation)
    await prisma.refreshToken.delete({ where: { id: stored.id } });

    return authService.generateTokens(stored.userId);
  },

  /**
   * Revoke a refresh token (logout).
   */
  async logout(refreshToken: string): Promise<void> {
    await prisma.refreshToken.deleteMany({ where: { token: refreshToken } });
  },

  /**
   * Revoke all refresh tokens for a user (logout from all devices).
   */
  async logoutAll(userId: string): Promise<void> {
    await prisma.refreshToken.deleteMany({ where: { userId } });
  },

  /**
   * Initiate the forgot-password flow.
   * Sets a time-limited reset token and sends the reset email.
   */
  async forgotPassword(email: string): Promise<void> {
    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    // Always return success to prevent email enumeration
    if (!user) return;

    const token = generateSecureToken();
    const expiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await prisma.user.update({
      where: { id: user.id },
      data: { passwordResetToken: token, passwordResetExpiry: expiry },
    });

    const resetUrl = `${env.frontendUrl}/reset-password?token=${token}`;
    await emailService
      .sendPasswordReset(user.email, resetUrl, user.firstName)
      .catch((err) => logger.warn('authService', 'Password reset email failed', err));
  },

  /**
   * Complete the password-reset flow with a valid reset token.
   */
  async resetPassword(token: string, newPassword: string): Promise<void> {
    const user = await prisma.user.findFirst({
      where: {
        passwordResetToken: token,
        passwordResetExpiry: { gt: new Date() },
      },
    });
    if (!user) throw new BadRequestError('Reset token is invalid or has expired', 'TOKEN_INVALID');

    await prisma.user.update({
      where: { id: user.id },
      data: {
        password: await hashPassword(newPassword),
        passwordResetToken: null,
        passwordResetExpiry: null,
      },
    });

    // Invalidate all sessions after password change
    await prisma.refreshToken.deleteMany({ where: { userId: user.id } });
  },

  /**
   * Change password for an authenticated user.
   */
  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundError('User');

    const isValid = await verifyPassword(currentPassword, user.password);
    if (!isValid) throw new UnauthorizedError('Current password is incorrect', 'WRONG_PASSWORD');

    await prisma.user.update({
      where: { id: userId },
      data: { password: await hashPassword(newPassword) },
    });

    // Invalidate all other sessions
    await prisma.refreshToken.deleteMany({ where: { userId } });
  },

  /**
   * Verify an email address using the one-time token.
   */
  async verifyEmail(token: string): Promise<void> {
    const user = await prisma.user.findFirst({ where: { emailVerifyToken: token } });
    if (!user) throw new BadRequestError('Verification token is invalid', 'TOKEN_INVALID');

    await prisma.user.update({
      where: { id: user.id },
      data: { isEmailVerified: true, emailVerifyToken: null },
    });

    emailService
      .sendWelcome(user.email, user.firstName)
      .catch((err) => logger.warn('authService', 'Welcome email failed', err));
  },

  /**
   * Resend the email-verification link.
   */
  async resendVerification(userId: string): Promise<void> {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundError('User');
    if (user.isEmailVerified) throw new BadRequestError('Email is already verified');

    const token = generateSecureToken();
    await prisma.user.update({ where: { id: userId }, data: { emailVerifyToken: token } });

    const verifyUrl = `${env.frontendUrl}/verify-email?token=${token}`;
    await emailService.sendEmailVerification(user.email, verifyUrl, user.firstName);
  },

  /**
   * Return the current authenticated user's profile.
   */
  async getMe(userId: string): Promise<UserProfile> {
    const user = await getUserWithRoles(userId);
    if (!user) throw new NotFoundError('User');
    const { roles, permissions } = extractRolesAndPermissions(user);
    return toProfile(user, roles, permissions);
  },

  /**
   * Issue a fresh access + refresh token pair.
   * When roles/permissions are not provided they are loaded from the database.
   */
  async generateTokens(userId: string, roles?: string[], permissions?: string[]): Promise<TokenPair> {
    let r = roles;
    let p = permissions;

    if (!r || !p) {
      const user = await getUserWithRoles(userId);
      if (!user) throw new NotFoundError('User');
      const extracted = extractRolesAndPermissions(user);
      r = extracted.roles;
      p = extracted.permissions;
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundError('User');

    const accessToken = signAccessToken({
      sub: userId,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      roles: r,
      permissions: p,
    });

    const refreshToken = await createRefreshToken(userId);
    return { accessToken, refreshToken };
  },
};
