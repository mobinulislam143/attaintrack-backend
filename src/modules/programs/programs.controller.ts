import { Request, Response } from 'express';
import { programsService } from './programs.service';
import { sendSuccess, sendCreated, sendNoContent } from '../../common/response';
import { parsePagination, parseSort } from '../../common/pagination';
import { Validator } from '../../common/validator';

interface ProgramBody {
  name: string;
  code: string;
  degree?: string;
  departmentId: string;
}

export async function listPrograms(req: Request, res: Response): Promise<void> {
  const { page, limit, skip } = parsePagination(req);
  const { field, order } = parseSort(req, ['name', 'code', 'degree', 'createdAt', 'updatedAt'], {
    field: 'name',
    order: 'asc',
  });

  const { data, meta } = await programsService.list({
    page,
    limit,
    skip,
    search: req.query['search'] ? String(req.query['search']) : undefined,
    departmentId: req.query['departmentId'] ? String(req.query['departmentId']) : undefined,
    sortField: field,
    sortOrder: order,
  });
  sendSuccess(res, data, 'Programs', 200, meta);
}

export async function getProgram(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await programsService.findById(String(req.params['id'])), 'Program');
}

export async function createProgram(req: Request, res: Response): Promise<void> {
  const v = new Validator(req.body);
  v.required('name').maxLength('name', 160);
  v.required('code').maxLength('code', 16);
  v.required('departmentId');
  v.throw();

  const program = await programsService.create(req.body as ProgramBody);
  sendCreated(res, program, `Program ${program.code} created`);
}

export async function updateProgram(req: Request, res: Response): Promise<void> {
  const v = new Validator(req.body);
  v.maxLength('name', 160).maxLength('code', 16);
  v.throw();

  const program = await programsService.update(
    String(req.params['id']),
    req.body as Partial<ProgramBody>,
  );
  sendSuccess(res, program, 'Program updated');
}

export async function deleteProgram(req: Request, res: Response): Promise<void> {
  await programsService.delete(String(req.params['id']));
  sendNoContent(res);
}
