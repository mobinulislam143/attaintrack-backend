import { Request, Response } from 'express';
import { authService } from './auth.service';
import { sendSuccess, sendCreated, sendNoContent } from '../../common/response';
import {
  validateRegister,
  validateLogin,
  validateForgotPassword,
  validateResetPassword,
  validateChangePassword,
  validateRefreshToken,
} from './auth.validator';
import { UnauthorizedError } from '../../common/errors';

// ─────────────────────────────────────────────────────────────────────────────
// Auth controller — thin layer that validates input and delegates to service.
// ─────────────────────────────────────────────────────────────────────────────

interface RegisterBody { email: string; password: string; firstName: string; lastName: string }
interface LoginBody { email: string; password: string }
interface RefreshBody { refreshToken: string }
interface ForgotBody { email: string }
interface ResetBody { token: string; password: string }
interface ChangePasswordBody { currentPassword: string; newPassword: string }

export async function register(req: Request, res: Response): Promise<void> {
  validateRegister(req);
  const { email, password, firstName, lastName } = req.body as RegisterBody;
  const result = await authService.register({ email, password, firstName, lastName });
  sendCreated(res, result, 'Account created successfully');
}

export async function login(req: Request, res: Response): Promise<void> {
  validateLogin(req);
  const { email, password } = req.body as LoginBody;
  const result = await authService.login(email, password);
  sendSuccess(res, result, 'Login successful');
}

export async function refreshTokens(req: Request, res: Response): Promise<void> {
  validateRefreshToken(req);
  const { refreshToken } = req.body as RefreshBody;
  const tokens = await authService.refreshTokens(refreshToken);
  sendSuccess(res, tokens, 'Tokens refreshed');
}

export async function logout(req: Request, res: Response): Promise<void> {
  const body = req.body as Partial<RefreshBody>;
  if (body.refreshToken) await authService.logout(body.refreshToken);
  sendNoContent(res);
}

export async function logoutAll(req: Request, res: Response): Promise<void> {
  await authService.logoutAll(req.user!.id);
  sendNoContent(res);
}

export async function forgotPassword(req: Request, res: Response): Promise<void> {
  validateForgotPassword(req);
  const { email } = req.body as ForgotBody;
  await authService.forgotPassword(email);
  sendSuccess(res, null, 'If an account with that email exists, a reset link has been sent');
}

export async function resetPassword(req: Request, res: Response): Promise<void> {
  validateResetPassword(req);
  const { token, password } = req.body as ResetBody;
  await authService.resetPassword(token, password);
  sendNoContent(res);
}

export async function changePassword(req: Request, res: Response): Promise<void> {
  validateChangePassword(req);
  const { currentPassword, newPassword } = req.body as ChangePasswordBody;
  await authService.changePassword(req.user!.id, currentPassword, newPassword);
  sendNoContent(res);
}

export async function getMe(req: Request, res: Response): Promise<void> {
  const user = await authService.getMe(req.user!.id);
  sendSuccess(res, user, 'Current user');
}

export async function verifyEmail(req: Request, res: Response): Promise<void> {
  const token = String(req.query['token'] ?? '');
  if (!token) throw new UnauthorizedError('Verification token is required', 'TOKEN_MISSING');
  await authService.verifyEmail(token);
  sendSuccess(res, null, 'Email verified successfully');
}

export async function resendVerification(req: Request, res: Response): Promise<void> {
  await authService.resendVerification(req.user!.id);
  sendSuccess(res, null, 'Verification email sent');
}
