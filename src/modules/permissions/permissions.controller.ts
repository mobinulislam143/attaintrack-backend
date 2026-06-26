import { Request, Response } from 'express';
import { permissionsService } from './permissions.service';
import { sendSuccess, sendCreated, sendNoContent } from '../../common/response';
import { Validator } from '../../common/validator';

interface CreatePermBody { name: string; description?: string }

const PERMISSION_NAME_REGEX = /^[a-z0-9_]+:[a-z0-9_]+$/;

function param(req: Request, key: string): string {
  return String(req.params[key] ?? '');
}

export async function listPermissions(req: Request, res: Response): Promise<void> {
  const permissions = await permissionsService.list();
  sendSuccess(res, permissions, 'Permissions retrieved');
}

export async function getPermission(req: Request, res: Response): Promise<void> {
  const permission = await permissionsService.findById(param(req, 'id'));
  sendSuccess(res, permission, 'Permission retrieved');
}

export async function createPermission(req: Request, res: Response): Promise<void> {
  const { name } = req.body as Partial<CreatePermBody>;
  new Validator(req.body)
    .required('name', 'Permission name')
    .minLength('name', 3, 'Permission name')
    .maxLength('name', 100, 'Permission name')
    .custom(
      'name',
      !name || PERMISSION_NAME_REGEX.test(name),
      "Permission name must follow 'resource:action' format (e.g. users:read)",
    )
    .throw();

  const { description } = req.body as Partial<CreatePermBody>;
  const permission = await permissionsService.create({ name: name!, description });
  sendCreated(res, permission, 'Permission created');
}

export async function updatePermission(req: Request, res: Response): Promise<void> {
  new Validator(req.body).string('name', 'Permission name').throw();
  const { name, description } = req.body as Partial<CreatePermBody>;
  const permission = await permissionsService.update(param(req, 'id'), { name, description });
  sendSuccess(res, permission, 'Permission updated');
}

export async function deletePermission(req: Request, res: Response): Promise<void> {
  await permissionsService.delete(param(req, 'id'));
  sendNoContent(res);
}
