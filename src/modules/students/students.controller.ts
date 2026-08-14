import { Request, Response } from 'express';
import { studentsService } from './students.service';
import { sendSuccess, sendCreated, sendNoContent } from '../../common/response';
import { parsePagination, parseSort } from '../../common/pagination';
import { Validator } from '../../common/validator';
import { BadRequestError } from '../../common/errors';
import { requireCourseAccess, requireCourseOwnership } from '../../common/scope';

export async function listStudents(req: Request, res: Response): Promise<void> {
  const courseId = req.query['courseId'] ? String(req.query['courseId']) : undefined;
  if (courseId) await requireCourseAccess(req.user!, courseId);

  const { page, limit, skip } = parsePagination(req);
  const { field, order } = parseSort(req, ['studentId', 'name', 'createdAt', 'updatedAt'], {
    field: 'studentId',
    order: 'asc',
  });

  const { data, meta } = await studentsService.list({
    page,
    limit,
    skip,
    search: req.query['search'] ? String(req.query['search']) : undefined,
    programId: req.query['programId'] ? String(req.query['programId']) : undefined,
    courseId,
    sortField: field,
    sortOrder: order,
  });
  sendSuccess(res, data, 'Students', 200, meta);
}

export async function getStudent(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await studentsService.findById(String(req.params['id'])), 'Student');
}

export async function createStudent(req: Request, res: Response): Promise<void> {
  const v = new Validator(req.body);
  v.required('studentId').maxLength('studentId', 32);
  v.required('name').maxLength('name', 120);
  v.email('email');
  v.throw();

  const student = await studentsService.create(req.body);
  sendCreated(res, student, `${student.name} added to the roster`);
}

export async function updateStudent(req: Request, res: Response): Promise<void> {
  const v = new Validator(req.body);
  v.maxLength('studentId', 32).maxLength('name', 120).email('email');
  v.throw();

  const student = await studentsService.update(String(req.params['id']), req.body);
  sendSuccess(res, student, `${student.name} updated`);
}

export async function deleteStudent(req: Request, res: Response): Promise<void> {
  await studentsService.delete(String(req.params['id']));
  sendNoContent(res);
}

export async function linkAccount(req: Request, res: Response): Promise<void> {
  const { userId } = req.body as { userId: string | null };
  const student = await studentsService.linkAccount(String(req.params['id']), userId ?? null);
  sendSuccess(
    res,
    student,
    student.userId
      ? `${student.name} can now sign in and see their own results`
      : `${student.name} is no longer linked to a login`,
  );
}

export async function bulkImportStudents(req: Request, res: Response): Promise<void> {
  const { students, programId, courseId } = req.body as {
    students: Array<{ studentId: string; name: string; email?: string }>;
    programId?: string;
    courseId?: string;
  };

  if (!Array.isArray(students) || students.length === 0) {
    throw new BadRequestError('students[] is required and must not be empty');
  }
  if (courseId) await requireCourseOwnership(req.user!, courseId);

  const result = await studentsService.bulkImport(students, {
    programId: programId ?? null,
    courseId: courseId ?? null,
  });

  const parts = [`${result.created} added`, `${result.updated} updated`];
  if (courseId) parts.push(`${result.enrolled} enrolled`);
  if (result.skipped.length > 0) parts.push(`${result.skipped.length} skipped`);

  sendSuccess(res, result, parts.join(' · '));
}

// ── Enrollment ───────────────────────────────────────────────────────────────

export async function listEnrolled(req: Request, res: Response): Promise<void> {
  const courseId = String(req.params['courseId']);
  await requireCourseAccess(req.user!, courseId);
  sendSuccess(res, await studentsService.listEnrolled(courseId), 'Enrolled students');
}

export async function enrollStudents(req: Request, res: Response): Promise<void> {
  const { courseId, studentIds } = req.body as { courseId: string; studentIds: string[] };
  if (!courseId || !Array.isArray(studentIds)) {
    throw new BadRequestError('courseId and studentIds[] are required');
  }

  await requireCourseOwnership(req.user!, courseId);
  const result = await studentsService.enroll(courseId, studentIds);
  sendSuccess(res, result, `${result.enrolled} student(s) enrolled`);
}

export async function unenrollStudent(req: Request, res: Response): Promise<void> {
  const courseId = String(req.params['courseId']);
  await requireCourseOwnership(req.user!, courseId);
  await studentsService.unenroll(courseId, String(req.params['studentId']));
  sendNoContent(res);
}
