import { Request, Response } from 'express';
import { coursesService } from './courses.service';
import { sendSuccess, sendCreated, sendNoContent } from '../../common/response';
import { parsePagination, parseSort } from '../../common/pagination';
import { Validator } from '../../common/validator';
import { COURSE_STATUSES } from '../../common/vocabulary';
import { requireCourseAccess, requireCourseOwnership } from '../../common/scope';

interface CourseBody {
  code: string;
  title: string;
  credit?: number;
  section?: string;
  programId: string;
  sessionId: string;
  teacherId?: string | null;
  attainmentThreshold?: number;
  attainmentTarget?: number;
}

export async function listCourses(req: Request, res: Response): Promise<void> {
  const { page, limit, skip } = parsePagination(req);
  const { field, order } = parseSort(req, ['code', 'title', 'status', 'createdAt', 'updatedAt'], {
    field: 'code',
    order: 'asc',
  });

  const { data, meta } = await coursesService.list(req.user!, {
    page,
    limit,
    skip,
    search: req.query['search'] ? String(req.query['search']) : undefined,
    programId: req.query['programId'] ? String(req.query['programId']) : undefined,
    sessionId: req.query['sessionId'] ? String(req.query['sessionId']) : undefined,
    teacherId: req.query['teacherId'] ? String(req.query['teacherId']) : undefined,
    status: req.query['status'] ? String(req.query['status']) : undefined,
    sortField: field,
    sortOrder: order,
  });
  sendSuccess(res, data, 'Courses', 200, meta);
}

export async function getCourse(req: Request, res: Response): Promise<void> {
  const id = String(req.params['id']);
  await requireCourseAccess(req.user!, id);
  sendSuccess(res, await coursesService.findById(id), 'Course');
}

export async function getCourseSetup(req: Request, res: Response): Promise<void> {
  const id = String(req.params['id']);
  await requireCourseAccess(req.user!, id);
  sendSuccess(res, await coursesService.setup(id), 'Course setup');
}

export async function createCourse(req: Request, res: Response): Promise<void> {
  const v = new Validator(req.body);
  v.required('code').maxLength('code', 16);
  v.required('title').maxLength('title', 200);
  v.required('programId');
  v.required('sessionId');
  v.oneOf('status', COURSE_STATUSES);
  v.throw();

  const course = await coursesService.create(req.body as CourseBody);
  sendCreated(res, course, `${course.code} created`);
}

export async function updateCourse(req: Request, res: Response): Promise<void> {
  const id = String(req.params['id']);
  await requireCourseOwnership(req.user!, id);

  const v = new Validator(req.body);
  v.maxLength('code', 16).maxLength('title', 200);
  const body = req.body as Partial<CourseBody>;
  v.custom(
    'attainmentThreshold',
    body.attainmentThreshold === undefined ||
      (Number(body.attainmentThreshold) > 0 && Number(body.attainmentThreshold) <= 100),
    'attainmentThreshold must be between 1 and 100',
  );
  v.custom(
    'attainmentTarget',
    body.attainmentTarget === undefined ||
      (Number(body.attainmentTarget) > 0 && Number(body.attainmentTarget) <= 100),
    'attainmentTarget must be between 1 and 100',
  );
  v.throw();

  const course = await coursesService.update(id, body);
  sendSuccess(res, course, `${course.code} updated`);
}

export async function assignTeacher(req: Request, res: Response): Promise<void> {
  const { teacherId } = req.body as { teacherId: string | null };
  const course = await coursesService.assignTeacher(String(req.params['id']), teacherId ?? null);
  sendSuccess(
    res,
    course,
    course.teacher
      ? `${course.code} assigned to ${course.teacher.firstName} ${course.teacher.lastName}`
      : `${course.code} has no assigned teacher`,
  );
}

export async function deleteCourse(req: Request, res: Response): Promise<void> {
  await coursesService.delete(String(req.params['id']));
  sendNoContent(res);
}
