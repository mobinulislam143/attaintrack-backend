import { Request, Response } from 'express';
import { programOutcomesService } from './program-outcomes.service';
import { sendSuccess, sendCreated, sendNoContent } from '../../common/response';
import { Validator } from '../../common/validator';
import { BadRequestError } from '../../common/errors';

interface POBody {
  programId: string;
  code: string;
  title: string;
  description?: string;
  target?: number;
}

export async function listProgramOutcomes(req: Request, res: Response): Promise<void> {
  const programId = req.query['programId'] ? String(req.query['programId']) : '';
  if (!programId) throw new BadRequestError('programId is required', 'PROGRAM_ID_REQUIRED');

  const outcomes = await programOutcomesService.listByProgram(programId);
  sendSuccess(res, outcomes, 'Program Outcomes');
}

export async function getProgramOutcome(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await programOutcomesService.findById(String(req.params['id'])), 'Program Outcome');
}

export async function createProgramOutcome(req: Request, res: Response): Promise<void> {
  const v = new Validator(req.body);
  v.required('programId');
  v.required('code').maxLength('code', 12);
  v.required('title').maxLength('title', 200);
  v.custom(
    'target',
    req.body?.target === undefined || (Number(req.body.target) >= 0 && Number(req.body.target) <= 100),
    'target must be between 0 and 100',
  );
  v.throw();

  const outcome = await programOutcomesService.create(req.body as POBody);
  sendCreated(res, outcome, `${outcome.code} created`);
}

export async function updateProgramOutcome(req: Request, res: Response): Promise<void> {
  const v = new Validator(req.body);
  v.maxLength('code', 12).maxLength('title', 200);
  v.custom(
    'target',
    req.body?.target === undefined || (Number(req.body.target) >= 0 && Number(req.body.target) <= 100),
    'target must be between 0 and 100',
  );
  v.throw();

  const outcome = await programOutcomesService.update(
    String(req.params['id']),
    req.body as Partial<POBody>,
  );
  sendSuccess(res, outcome, `${outcome.code} updated`);
}

export async function deleteProgramOutcome(req: Request, res: Response): Promise<void> {
  await programOutcomesService.delete(String(req.params['id']));
  sendNoContent(res);
}

export async function reorderProgramOutcomes(req: Request, res: Response): Promise<void> {
  const { programId, orderedIds } = req.body as { programId: string; orderedIds: string[] };
  if (!programId || !Array.isArray(orderedIds)) {
    throw new BadRequestError('programId and orderedIds[] are required');
  }

  const outcomes = await programOutcomesService.reorder(programId, orderedIds);
  sendSuccess(res, outcomes, 'Order saved');
}
