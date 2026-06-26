import { Request, Response } from 'express';
import { usersService } from './users.service';
import { sendSuccess, sendCreated, sendNoContent } from '../../common/response';
import { parsePagination, parseSort } from '../../common/pagination';
import {
  validateCreateUser,
  validateUpdateUser,
  validateUpdateProfile,
  validateAssignRole,
} from './users.validator';

// ─────────────────────────────────────────────────────────────────────────────
// Users controller — admin-facing user management endpoints.
// ─────────────────────────────────────────────────────────────────────────────

interface CreateUserBody { email: string; password: string; firstName: string; lastName: string; isActive?: boolean }
interface UpdateUserBody { firstName?: string; lastName?: string; avatar?: string; isActive?: boolean }
interface AssignRoleBody { roleId: string }

function param(req: Request, key: string): string {
  return String(req.params[key] ?? '');
}

export async function listUsers(req: Request, res: Response): Promise<void> {
  const { page, limit, skip } = parsePagination(req);
  const { field: sortField, order: sortOrder } = parseSort(req, [
    'createdAt', 'updatedAt', 'email', 'firstName', 'lastName',
  ]);
  const search = String(req.query['search'] ?? '').trim() || undefined;
  const isActiveQuery = req.query['isActive'];
  const isActive =
    isActiveQuery === 'true' ? true : isActiveQuery === 'false' ? false : undefined;

  const { data, meta } = await usersService.list({ page, limit, skip, search, isActive, sortField, sortOrder });
  sendSuccess(res, data, 'Users retrieved', 200, meta);
}

export async function getUser(req: Request, res: Response): Promise<void> {
  const user = await usersService.findById(param(req, 'id'));
  sendSuccess(res, user, 'User retrieved');
}

export async function createUser(req: Request, res: Response): Promise<void> {
  validateCreateUser(req);
  const { email, password, firstName, lastName, isActive } = req.body as CreateUserBody;
  const user = await usersService.create({ email, password, firstName, lastName, isActive });
  sendCreated(res, user, 'User created');
}

export async function updateUser(req: Request, res: Response): Promise<void> {
  validateUpdateUser(req);
  const { firstName, lastName, avatar, isActive } = req.body as UpdateUserBody;
  const user = await usersService.update(param(req, 'id'), { firstName, lastName, avatar, isActive });
  sendSuccess(res, user, 'User updated');
}

export async function deleteUser(req: Request, res: Response): Promise<void> {
  await usersService.delete(param(req, 'id'));
  sendNoContent(res);
}

export async function assignRole(req: Request, res: Response): Promise<void> {
  validateAssignRole(req);
  const { roleId } = req.body as AssignRoleBody;
  await usersService.assignRole(param(req, 'id'), roleId);
  sendSuccess(res, null, 'Role assigned');
}

export async function removeRole(req: Request, res: Response): Promise<void> {
  await usersService.removeRole(param(req, 'id'), param(req, 'roleId'));
  sendNoContent(res);
}

export async function getProfile(req: Request, res: Response): Promise<void> {
  const user = await usersService.findById(req.user!.id);
  sendSuccess(res, user, 'Profile retrieved');
}

export async function updateProfile(req: Request, res: Response): Promise<void> {
  validateUpdateProfile(req);
  const { firstName, lastName, avatar } = req.body as UpdateUserBody;
  const user = await usersService.updateProfile(req.user!.id, { firstName, lastName, avatar });
  sendSuccess(res, user, 'Profile updated');
}
