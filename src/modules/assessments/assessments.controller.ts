import { Request, Response } from 'express';
import { assessmentsService, QuestionInput } from './assessments.service';
import { sendSuccess, sendCreated, sendNoContent } from '../../common/response';
import { Validator } from '../../common/validator';
import { BadRequestError, NotFoundError } from '../../common/errors';
import { requireCourseAccess, requireCourseOwnership } from '../../common/scope';
import { ASSESSMENT_TYPES } from '../../common/vocabulary';
import { prisma } from '../../database/client';

async function courseIdOfAssessment(id: string): Promise<string> {
  const row = await prisma.assessment.findUnique({ where: { id }, select: { courseId: true } });
  if (!row) throw new NotFoundError('Assessment');
  return row.courseId;
}

export async function listAssessments(req: Request, res: Response): Promise<void> {
  const courseId = req.query['courseId'] ? String(req.query['courseId']) : '';
  if (!courseId) throw new BadRequestError('courseId is required', 'COURSE_ID_REQUIRED');

  await requireCourseAccess(req.user!, courseId);

  const assessments = await assessmentsService.listByCourse(courseId);

  // A student may only see an assessment once the teacher publishes it.
  const visible = req.user!.roles.includes('student')
    ? assessments.filter((a) => a.isPublished)
    : assessments;

  sendSuccess(res, visible, 'Assessments');
}

export async function getAssessment(req: Request, res: Response): Promise<void> {
  const id = String(req.params['id']);
  await requireCourseAccess(req.user!, await courseIdOfAssessment(id));
  sendSuccess(res, await assessmentsService.findById(id), 'Assessment');
}

export async function createAssessment(req: Request, res: Response): Promise<void> {
  const v = new Validator(req.body);
  v.required('courseId');
  v.required('name').maxLength('name', 120);
  v.oneOf('type', ASSESSMENT_TYPES);
  v.throw();

  const { courseId } = req.body as { courseId: string };
  await requireCourseOwnership(req.user!, courseId);

  const assessment = await assessmentsService.create(req.body);
  sendCreated(res, assessment, `${assessment.name} created`);
}

export async function updateAssessment(req: Request, res: Response): Promise<void> {
  const id = String(req.params['id']);
  await requireCourseOwnership(req.user!, await courseIdOfAssessment(id));

  const v = new Validator(req.body);
  v.maxLength('name', 120).oneOf('type', ASSESSMENT_TYPES);
  v.throw();

  const assessment = await assessmentsService.update(id, req.body);
  sendSuccess(res, assessment, `${assessment.name} updated`);
}

export async function deleteAssessment(req: Request, res: Response): Promise<void> {
  const id = String(req.params['id']);
  await requireCourseOwnership(req.user!, await courseIdOfAssessment(id));
  await assessmentsService.delete(id);
  sendNoContent(res);
}

export async function setPublished(req: Request, res: Response): Promise<void> {
  const id = String(req.params['id']);
  await requireCourseOwnership(req.user!, await courseIdOfAssessment(id));

  const { isPublished } = req.body as { isPublished?: boolean };
  const assessment = await assessmentsService.setPublished(id, isPublished !== false);

  sendSuccess(
    res,
    assessment,
    assessment.isPublished
      ? `${assessment.name} published. Students can now see their marks.`
      : `${assessment.name} unpublished. Students can no longer see their marks.`,
  );
}

export async function replaceQuestions(req: Request, res: Response): Promise<void> {
  const id = String(req.params['id']);
  await requireCourseOwnership(req.user!, await courseIdOfAssessment(id));

  const { questions } = req.body as { questions: QuestionInput[] };
  if (!Array.isArray(questions)) throw new BadRequestError('questions[] is required');

  const assessment = await assessmentsService.replaceQuestions(id, questions);
  sendSuccess(
    res,
    assessment,
    `${assessment.questions.length} question(s) saved · ${assessment.totalMarks} total marks`,
  );
}

export async function mapQuestion(req: Request, res: Response): Promise<void> {
  const questionId = String(req.params['questionId']);

  const question = await prisma.question.findUnique({
    where: { id: questionId },
    include: { assessment: { select: { courseId: true } } },
  });
  if (!question) throw new NotFoundError('Question');
  await requireCourseOwnership(req.user!, question.assessment.courseId);

  const { courseOutcomeId } = req.body as { courseOutcomeId: string | null };
  const updated = await assessmentsService.mapQuestion(questionId, courseOutcomeId ?? null);

  sendSuccess(
    res,
    updated,
    updated.courseOutcomeCode
      ? `${updated.code} mapped to ${updated.courseOutcomeCode}`
      : `${updated.code} is no longer mapped to a Course Outcome`,
  );
}
