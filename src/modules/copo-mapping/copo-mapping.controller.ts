import { Request, Response } from 'express';
import { copoMappingService } from './copo-mapping.service';
import { sendSuccess } from '../../common/response';
import { BadRequestError } from '../../common/errors';
import { requireCourseAccess, requireCourseOwnership } from '../../common/scope';

export async function getMatrix(req: Request, res: Response): Promise<void> {
  const courseId = req.query['courseId'] ? String(req.query['courseId']) : '';
  if (!courseId) throw new BadRequestError('courseId is required', 'COURSE_ID_REQUIRED');

  await requireCourseAccess(req.user!, courseId);
  sendSuccess(res, await copoMappingService.matrix(courseId), 'CO-PO mapping');
}

export async function saveMatrix(req: Request, res: Response): Promise<void> {
  const { courseId, entries } = req.body as {
    courseId: string;
    entries: Array<{ courseOutcomeId: string; programOutcomeId: string; strength: number }>;
  };

  if (!courseId || !Array.isArray(entries)) {
    throw new BadRequestError('courseId and entries[] are required');
  }

  await requireCourseOwnership(req.user!, courseId);

  const matrix = await copoMappingService.save(courseId, entries);
  sendSuccess(
    res,
    matrix,
    matrix.complete
      ? 'CO-PO mapping saved. Every Course Outcome and Program Outcome is mapped.'
      : `CO-PO mapping saved. ${
          matrix.invalidPOs.length > 0
            ? `${matrix.invalidPOs.join(', ')} still ${matrix.invalidPOs.length > 1 ? 'have' : 'has'} no mapping.`
            : `${matrix.unmappedCOs.join(', ')} still ${matrix.unmappedCOs.length > 1 ? 'have' : 'has'} no mapping.`
        }`,
  );
}
