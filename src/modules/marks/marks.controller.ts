import { Request, Response } from 'express';
import { marksService } from './marks.service';
import { sendSuccess } from '../../common/response';
import { BadRequestError, NotFoundError, UnprocessableError } from '../../common/errors';
import { requireCourseAccess, requireCourseOwnership } from '../../common/scope';
import { prisma } from '../../database/client';

async function courseIdOfAssessment(id: string): Promise<string> {
  const row = await prisma.assessment.findUnique({ where: { id }, select: { courseId: true } });
  if (!row) throw new NotFoundError('Assessment');
  return row.courseId;
}

export async function getGrid(req: Request, res: Response): Promise<void> {
  const assessmentId = req.query['assessmentId'] ? String(req.query['assessmentId']) : '';
  if (!assessmentId) throw new BadRequestError('assessmentId is required', 'ASSESSMENT_ID_REQUIRED');

  await requireCourseAccess(req.user!, await courseIdOfAssessment(assessmentId));
  sendSuccess(res, await marksService.grid(assessmentId), 'Marks');
}

export async function saveMarks(req: Request, res: Response): Promise<void> {
  const { assessmentId, entries } = req.body as {
    assessmentId: string;
    entries: Array<{ studentId: string; questionId: string; obtained: number | null }>;
  };

  if (!assessmentId || !Array.isArray(entries)) {
    throw new BadRequestError('assessmentId and entries[] are required');
  }

  await requireCourseOwnership(req.user!, await courseIdOfAssessment(assessmentId));

  const result = await marksService.save(assessmentId, entries);
  sendSuccess(res, result, `${result.saved} mark(s) saved`);
}

export async function downloadTemplate(req: Request, res: Response): Promise<void> {
  const assessmentId = req.query['assessmentId'] ? String(req.query['assessmentId']) : '';
  if (!assessmentId) throw new BadRequestError('assessmentId is required', 'ASSESSMENT_ID_REQUIRED');

  await requireCourseOwnership(req.user!, await courseIdOfAssessment(assessmentId));

  const { fileName, csv } = await marksService.template(assessmentId);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  res.status(200).send(csv);
}

export async function validateCsv(req: Request, res: Response): Promise<void> {
  const file = req.file;
  if (!file) throw new BadRequestError('No file was uploaded', 'FILE_REQUIRED');

  const assessmentId = String(req.body?.assessmentId ?? '');
  if (!assessmentId) throw new BadRequestError('assessmentId is required', 'ASSESSMENT_ID_REQUIRED');

  await requireCourseOwnership(req.user!, await courseIdOfAssessment(assessmentId));

  const result = await marksService.validateCsv(assessmentId, file, req.user!.id);
  const errors = result.issues.filter((i) => i.severity === 'error').length;

  sendSuccess(
    res,
    result,
    errors === 0
      ? `${result.detectedStudents} students detected · ${result.validRows} valid records · no errors`
      : `${result.detectedStudents} students detected · ${result.validRows} valid records · ${errors} error(s)`,
  );
}

export async function commitCsv(req: Request, res: Response): Promise<void> {
  const { uploadToken } = req.body as { uploadToken: string };
  if (!uploadToken) throw new BadRequestError('uploadToken is required', 'UPLOAD_TOKEN_REQUIRED');

  const upload = await prisma.marksUpload.findUnique({
    where: { token: uploadToken },
    select: { courseId: true },
  });
  if (!upload) {
    throw new UnprocessableError(
      'This upload is no longer staged. Upload the file again.',
      'UPLOAD_NOT_FOUND',
    );
  }
  await requireCourseOwnership(req.user!, upload.courseId);

  const result = await marksService.commitCsv(uploadToken);
  sendSuccess(
    res,
    result,
    `${result.imported} imported · ${result.updated} updated · ${result.skipped} unchanged`,
  );
}
