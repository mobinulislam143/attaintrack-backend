import { prisma } from '../database/client';
import { Prisma } from '../generated/prisma';
import { AuthUser } from '../types/express';
import { ForbiddenError, NotFoundError } from './errors';

// ─────────────────────────────────────────────────────────────────────────────
// Row-level scoping.
//
// RBAC answers "may this role call this route"; it cannot answer "may this
// teacher touch *this* course". Two teachers hold identical permissions, so
// every course-bound handler must additionally pass through here.
//
// The rules, in one place:
//   admin    — every course
//   teacher  — courses where they are the assigned teacher
//   student  — courses they are enrolled in, read-only
// ─────────────────────────────────────────────────────────────────────────────

export function isAdmin(user: AuthUser): boolean {
  return user.roles.includes('admin');
}

export function isTeacher(user: AuthUser): boolean {
  return user.roles.includes('teacher');
}

export function isStudent(user: AuthUser): boolean {
  return user.roles.includes('student');
}

/**
 * A Prisma `where` fragment restricting a course query to what the user may
 * see. Admins get `{}`; anything else is filtered by identity.
 */
export async function courseScope(user: AuthUser): Promise<Prisma.CourseWhereInput> {
  if (isAdmin(user)) return {};
  if (isTeacher(user)) return { teacherId: user.id };

  const student = await prisma.student.findFirst({ where: { userId: user.id } });
  if (!student) return { id: '000000000000000000000000' }; // matches nothing
  return { enrollments: { some: { studentId: student.id } } };
}

/**
 * Load a course the user is allowed to *read*, or throw.
 * Returns the course so callers do not fetch it twice.
 */
export async function requireCourseAccess(user: AuthUser, courseId: string) {
  const course = await prisma.course.findUnique({ where: { id: courseId } });
  if (!course) throw new NotFoundError('Course');

  if (isAdmin(user)) return course;

  if (isTeacher(user) && course.teacherId === user.id) return course;

  if (isStudent(user)) {
    const student = await prisma.student.findFirst({ where: { userId: user.id } });
    if (student) {
      const enrolled = await prisma.enrollment.findUnique({
        where: { courseId_studentId: { courseId, studentId: student.id } },
      });
      if (enrolled) return course;
    }
  }

  throw new ForbiddenError('You do not have access to this course');
}

/**
 * Load a course the user is allowed to *modify*. Students never qualify;
 * a teacher qualifies only for their own courses.
 */
export async function requireCourseOwnership(user: AuthUser, courseId: string) {
  const course = await prisma.course.findUnique({ where: { id: courseId } });
  if (!course) throw new NotFoundError('Course');

  if (isAdmin(user)) return course;
  if (isTeacher(user) && course.teacherId === user.id) return course;

  throw new ForbiddenError('Only the assigned teacher can modify this course');
}

/**
 * The roster record behind a student login. Throws when the account has the
 * `student` role but no roster row — an admin data-entry gap, not a bug.
 */
export async function requireStudentRecord(user: AuthUser) {
  const student = await prisma.student.findFirst({ where: { userId: user.id } });
  if (!student) {
    throw new NotFoundError(
      'Student record for this account. Ask an administrator to link your login to the roster',
    );
  }
  return student;
}
