import { Request, Response } from 'express';
import { courseOutcomesService } from './course-outcomes.service';
import { sendSuccess, sendCreated, sendNoContent } from '../../common/response';
import { Validator } from '../../common/validator';
import { BadRequestError } from '../../common/errors';
import { requireCourseAccess, requireCourseOwnership } from '../../common/scope';
import { prisma } from '../../database/client';
import { NotFoundError } from '../../common/errors';

/** Resolve the course a CO belongs to, so ownership can be checked before writing. */
async function courseIdOf(courseOutcomeId: string): Promise<string> {
  const row = await prisma.courseOutcome.findUnique({
    where: { id: courseOutcomeId },
    select: { courseId: true },
  });
  if (!row) throw new NotFoundError('Course Outcome');
  return row.courseId;
}

export async function listCourseOutcomes(req: Request, res: Response): Promise<void> {
  const courseId = req.query['courseId'] ? String(req.query['courseId']) : '';
  if (!courseId) throw new BadRequestError('courseId is required', 'COURSE_ID_REQUIRED');

  await requireCourseAccess(req.user!, courseId);
  sendSuccess(res, await courseOutcomesService.listByCourse(courseId), 'Course Outcomes');
}

export async function getCourseOutcome(req: Request, res: Response): Promise<void> {
  const id = String(req.params['id']);
  await requireCourseAccess(req.user!, await courseIdOf(id));
  sendSuccess(res, await courseOutcomesService.findById(id), 'Course Outcome');
}

export async function createCourseOutcome(req: Request, res: Response): Promise<void> {
  const v = new Validator(req.body);
  v.required('courseId');
  v.required('statement').maxLength('statement', 500);
  v.maxLength('code', 12);
  v.throw();

  const { courseId } = req.body as { courseId: string };
  await requireCourseOwnership(req.user!, courseId);

  const outcome = await courseOutcomesService.create(req.body);
  sendCreated(res, outcome, `${outcome.code} created`);
}

export async function updateCourseOutcome(req: Request, res: Response): Promise<void> {
  const id = String(req.params['id']);
  await requireCourseOwnership(req.user!, await courseIdOf(id));

  const v = new Validator(req.body);
  v.maxLength('statement', 500).maxLength('code', 12);
  v.throw();

  const outcome = await courseOutcomesService.update(id, req.body);
  sendSuccess(res, outcome, `${outcome.code} updated`);
}

export async function deleteCourseOutcome(req: Request, res: Response): Promise<void> {
  const id = String(req.params['id']);
  await requireCourseOwnership(req.user!, await courseIdOf(id));
  await courseOutcomesService.delete(id);
  sendNoContent(res);
}

export async function reorderCourseOutcomes(req: Request, res: Response): Promise<void> {
  const { courseId, orderedIds } = req.body as { courseId: string; orderedIds: string[] };
  if (!courseId || !Array.isArray(orderedIds)) {
    throw new BadRequestError('courseId and orderedIds[] are required');
  }

  await requireCourseOwnership(req.user!, courseId);
  sendSuccess(res, await courseOutcomesService.reorder(courseId, orderedIds), 'Order saved');
}
