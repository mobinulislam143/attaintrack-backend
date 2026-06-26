import { Request, Response } from 'express';
import { rolesService } from './roles.service';
import { sendSuccess, sendCreated, sendNoContent } from '../../common/response';
import { Validator } from '../../common/validator';

interface CreateRoleBody { name: string; description?: string }
interface AssignPermBody { permissionId: string }

function param(req: Request, key: string): string {
  return String(req.params[key] ?? '');
}

export async function listRoles(req: Request, res: Response): Promise<void> {
  const roles = await rolesService.list();
  sendSuccess(res, roles, 'Roles retrieved');
}

export async function getRole(req: Request, res: Response): Promise<void> {
  const role = await rolesService.findById(param(req, 'id'));
  sendSuccess(res, role, 'Role retrieved');
}

export async function createRole(req: Request, res: Response): Promise<void> {
  new Validator(req.body)
    .required('name', 'Role name')
    .minLength('name', 2, 'Role name')
    .maxLength('name', 50, 'Role name')
    .throw();

  const { name, description } = req.body as CreateRoleBody;
  const role = await rolesService.create({ name, description });
  sendCreated(res, role, 'Role created');
}

export async function updateRole(req: Request, res: Response): Promise<void> {
  new Validator(req.body)
    .string('name', 'Role name')
    .minLength('name', 2, 'Role name')
    .maxLength('name', 50, 'Role name')
    .throw();

  const { name, description } = req.body as Partial<CreateRoleBody>;
  const role = await rolesService.update(param(req, 'id'), { name, description });
  sendSuccess(res, role, 'Role updated');
}

export async function deleteRole(req: Request, res: Response): Promise<void> {
  await rolesService.delete(param(req, 'id'));
  sendNoContent(res);
}

export async function assignPermission(req: Request, res: Response): Promise<void> {
  new Validator(req.body).required('permissionId', 'Permission ID').throw();
  const { permissionId } = req.body as AssignPermBody;
  await rolesService.assignPermission(param(req, 'id'), permissionId);
  sendSuccess(res, null, 'Permission assigned to role');
}

export async function removePermission(req: Request, res: Response): Promise<void> {
  await rolesService.removePermission(param(req, 'id'), param(req, 'permissionId'));
  sendNoContent(res);
}
