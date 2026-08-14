import { Request, Response } from 'express';
import { attainmentService } from './attainment.service';
import { sendSuccess } from '../../common/response';
import { BadRequestError } from '../../common/errors';
import { requireCourseAccess, requireCourseOwnership, requireStudentRecord } from '../../common/scope';
import { prisma } from '../../database/client';

function courseIdFromQuery(req: Request): string {
  const courseId = req.query['courseId'] ? String(req.query['courseId']) : '';
  if (!courseId) throw new BadRequestError('courseId is required', 'COURSE_ID_REQUIRED');
  return courseId;
}

export async function calculate(req: Request, res: Response): Promise<void> {
  const { courseId } = req.body as { courseId: string };
  if (!courseId) throw new BadRequestError('courseId is required', 'COURSE_ID_REQUIRED');

  await requireCourseOwnership(req.user!, courseId);

  const run = await attainmentService.calculate(courseId);
  const belowTarget = run.co.filter((c) => c.status === 'below-target').length;

  sendSuccess(
    res,
    run,
    belowTarget === 0
      ? `Attainment calculated. Overall CO ${run.overallCO}% · overall PO ${run.overallPO}%. Every outcome is at or above target.`
      : `Attainment calculated. Overall CO ${run.overallCO}% · overall PO ${run.overallPO}% · ${belowTarget} outcome(s) below target.`,
  );
}

export async function getLatest(req: Request, res: Response): Promise<void> {
  const courseId = courseIdFromQuery(req);
  await requireCourseAccess(req.user!, courseId);
  sendSuccess(res, await attainmentService.latest(courseId), 'Latest attainment');
}

export async function getHistory(req: Request, res: Response): Promise<void> {
  const courseId = courseIdFromQuery(req);
  await requireCourseAccess(req.user!, courseId);
  sendSuccess(res, await attainmentService.history(courseId), 'Calculation history');
}

export async function getRun(req: Request, res: Response): Promise<void> {
  const run = await attainmentService.findRun(String(req.params['runId']));
  await requireCourseAccess(req.user!, run.courseId);
  sendSuccess(res, run, 'Attainment run');
}

export async function getStudentPerformance(req: Request, res: Response): Promise<void> {
  const courseId = courseIdFromQuery(req);
  await requireCourseOwnership(req.user!, courseId);
  sendSuccess(res, await attainmentService.studentPerformance(courseId), 'Student performance');
}

/**
 * The signed-in student's own breakdown for one course.
 *
 * Carries no permission gate on purpose: it is scoped by identity, and there is
 * no argument a student could pass that would widen it. Marks from unpublished
 * assessments are excluded, so a student never sees a grade before the teacher
 * releases it.
 */
export async function getMyPerformance(req: Request, res: Response): Promise<void> {
  const courseId = courseIdFromQuery(req);
  await requireCourseAccess(req.user!, courseId);

  const student = await requireStudentRecord(req.user!);
  const performance = await attainmentService.studentPerformanceFor(courseId, student.id, {
    publishedOnly: true,
  });

  const course = await prisma.course.findUnique({
    where: { id: courseId },
    select: { code: true, title: true, attainmentThreshold: true },
  });

  sendSuccess(res, { course, performance }, 'Your performance');
}
