import { Request, Response } from 'express';
import { departmentsService } from './departments.service';
import { sendSuccess, sendCreated, sendNoContent } from '../../common/response';
import { parsePagination, parseSort } from '../../common/pagination';
import { Validator } from '../../common/validator';

interface DepartmentBody {
  name: string;
  code: string;
}

export async function listDepartments(req: Request, res: Response): Promise<void> {
  const { page, limit, skip } = parsePagination(req);
  const { field, order } = parseSort(req, ['name', 'code', 'createdAt', 'updatedAt'], {
    field: 'name',
    order: 'asc',
  });
  const search = req.query['search'] ? String(req.query['search']) : undefined;

  const { data, meta } = await departmentsService.list({
    page,
    limit,
    skip,
    search,
    sortField: field,
    sortOrder: order,
  });
  sendSuccess(res, data, 'Departments', 200, meta);
}

export async function getDepartment(req: Request, res: Response): Promise<void> {
  const department = await departmentsService.findById(String(req.params['id']));
  sendSuccess(res, department, 'Department');
}

export async function createDepartment(req: Request, res: Response): Promise<void> {
  const v = new Validator(req.body);
  v.required('name').maxLength('name', 120);
  v.required('code').maxLength('code', 12);
  v.throw();

  const { name, code } = req.body as DepartmentBody;
  const department = await departmentsService.create({ name, code });
  sendCreated(res, department, `Department ${department.code} created`);
}

export async function updateDepartment(req: Request, res: Response): Promise<void> {
  const v = new Validator(req.body);
  v.maxLength('name', 120).maxLength('code', 12);
  v.throw();

  const department = await departmentsService.update(
    String(req.params['id']),
    req.body as Partial<DepartmentBody>,
  );
  sendSuccess(res, department, 'Department updated');
}

export async function deleteDepartment(req: Request, res: Response): Promise<void> {
  await departmentsService.delete(String(req.params['id']));
  sendNoContent(res);
}
