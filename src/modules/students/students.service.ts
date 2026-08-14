import { Prisma } from '../../generated/prisma';
import { prisma } from '../../database/client';
import { buildMeta } from '../../common/pagination';
import { ApiMeta } from '../../common/response';
import { ConflictError, NotFoundError } from '../../common/errors';
import { recomputeStatus } from '../courses/courses.service';

// ─────────────────────────────────────────────────────────────────────────────
// Students and enrollments.
//
// A Student is a roster record keyed by the registration number printed on the
// class list (`studentId`, e.g. "202322") — that is what CSV imports match on.
// A login is optional and lives on `userId`; roster-only students are normal.
// ─────────────────────────────────────────────────────────────────────────────

export interface StudentDto {
  id: string;
  studentId: string;
  name: string;
  email: string | null;
  programId: string | null;
  programCode: string | null;
  userId: string | null;
  enrolledCourses: number;
  createdAt: Date;
  updatedAt: Date;
}

const STUDENT_INCLUDE = {
  program: { select: { code: true } },
  _count: { select: { enrollments: true } },
} satisfies Prisma.StudentInclude;

type StudentRow = Prisma.StudentGetPayload<{ include: typeof STUDENT_INCLUDE }>;

function toDto(row: StudentRow): StudentDto {
  return {
    id: row.id,
    studentId: row.studentId,
    name: row.name,
    email: row.email,
    programId: row.programId,
    programCode: row.program?.code ?? null,
    userId: row.userId,
    enrolledCourses: row._count.enrollments,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export interface ListStudentsOptions {
  page: number;
  limit: number;
  skip: number;
  search?: string;
  programId?: string;
  /** When set, returns only students enrolled in that course. */
  courseId?: string;
  sortField: string;
  sortOrder: 'asc' | 'desc';
}

const SORTABLE = ['studentId', 'name', 'createdAt', 'updatedAt'];

export interface BulkImportResult {
  created: number;
  updated: number;
  enrolled: number;
  skipped: Array<{ studentId: string; reason: string }>;
}

export const studentsService = {
  async list(opts: ListStudentsOptions): Promise<{ data: StudentDto[]; meta: ApiMeta }> {
    const where: Prisma.StudentWhereInput = {};
    if (opts.programId) where.programId = opts.programId;
    if (opts.courseId) where.enrollments = { some: { courseId: opts.courseId } };
    if (opts.search) {
      where.OR = [
        { name: { contains: opts.search, mode: 'insensitive' } },
        { studentId: { contains: opts.search, mode: 'insensitive' } },
        { email: { contains: opts.search, mode: 'insensitive' } },
      ];
    }

    const sortField = SORTABLE.includes(opts.sortField) ? opts.sortField : 'studentId';

    const [rows, total] = await Promise.all([
      prisma.student.findMany({
        where,
        include: STUDENT_INCLUDE,
        orderBy: { [sortField]: opts.sortOrder },
        skip: opts.skip,
        take: opts.limit,
      }),
      prisma.student.count({ where }),
    ]);

    return { data: rows.map(toDto), meta: buildMeta(total, opts.page, opts.limit) };
  },

  async findById(id: string): Promise<StudentDto> {
    const row = await prisma.student.findUnique({ where: { id }, include: STUDENT_INCLUDE });
    if (!row) throw new NotFoundError('Student');
    return toDto(row);
  },

  async create(data: {
    studentId: string;
    name: string;
    email?: string | null;
    programId?: string | null;
  }): Promise<StudentDto> {
    const studentId = data.studentId.trim();
    const clash = await prisma.student.findUnique({ where: { studentId } });
    if (clash) throw new ConflictError(`Student ${studentId} already exists`);

    if (data.programId) {
      const program = await prisma.program.findUnique({ where: { id: data.programId } });
      if (!program) throw new NotFoundError('Program');
    }

    const row = await prisma.student.create({
      data: {
        studentId,
        name: data.name.trim(),
        email: data.email?.trim().toLowerCase() || null,
        programId: data.programId ?? null,
      },
      include: STUDENT_INCLUDE,
    });
    return toDto(row);
  },

  async update(
    id: string,
    data: Partial<{ studentId: string; name: string; email: string | null; programId: string | null }>,
  ): Promise<StudentDto> {
    const existing = await prisma.student.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError('Student');

    if (data.studentId !== undefined && data.studentId.trim() !== existing.studentId) {
      const clash = await prisma.student.findUnique({ where: { studentId: data.studentId.trim() } });
      if (clash) throw new ConflictError(`Student ${data.studentId.trim()} already exists`);
    }

    const row = await prisma.student.update({
      where: { id },
      data: {
        ...(data.studentId !== undefined && { studentId: data.studentId.trim() }),
        ...(data.name !== undefined && { name: data.name.trim() }),
        ...(data.email !== undefined && { email: data.email?.trim().toLowerCase() || null }),
        ...(data.programId !== undefined && { programId: data.programId }),
      },
      include: STUDENT_INCLUDE,
    });
    return toDto(row);
  },

  async delete(id: string): Promise<void> {
    const existing = await prisma.student.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError('Student');
    await prisma.student.delete({ where: { id } });
  },

  /**
   * Link a login to a roster row, so the student portal can find its data.
   * Enforces one-account-one-row, which the schema cannot express here — see
   * the note on `Student.userId`. Pass null to unlink.
   */
  async linkAccount(id: string, userId: string | null): Promise<StudentDto> {
    const student = await prisma.student.findUnique({ where: { id } });
    if (!student) throw new NotFoundError('Student');

    if (userId) {
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) throw new NotFoundError('User account');

      const taken = await prisma.student.findFirst({ where: { userId, NOT: { id } } });
      if (taken) {
        throw new ConflictError(
          `${user.email} is already linked to student ${taken.studentId}`,
          'ACCOUNT_ALREADY_LINKED',
        );
      }
    }

    const row = await prisma.student.update({
      where: { id },
      data: { userId },
      include: STUDENT_INCLUDE,
    });
    return toDto(row);
  },

  // ── Enrollment ────────────────────────────────────────────────────────────

  /** Students enrolled in a course, by registration number. */
  async listEnrolled(courseId: string): Promise<StudentDto[]> {
    const course = await prisma.course.findUnique({ where: { id: courseId } });
    if (!course) throw new NotFoundError('Course');

    const rows = await prisma.student.findMany({
      where: { enrollments: { some: { courseId } } },
      include: STUDENT_INCLUDE,
      orderBy: { studentId: 'asc' },
    });
    return rows.map(toDto);
  },

  /** Enroll a set of existing students. Idempotent. */
  async enroll(courseId: string, studentIds: string[]): Promise<{ enrolled: number }> {
    const course = await prisma.course.findUnique({ where: { id: courseId } });
    if (!course) throw new NotFoundError('Course');

    let enrolled = 0;
    for (const studentId of studentIds) {
      const student = await prisma.student.findUnique({ where: { id: studentId } });
      if (!student) continue;

      const existing = await prisma.enrollment.findUnique({
        where: { courseId_studentId: { courseId, studentId } },
      });
      if (existing) continue;

      await prisma.enrollment.create({ data: { courseId, studentId } });
      enrolled += 1;
    }

    await recomputeStatus(courseId);
    return { enrolled };
  },

  async unenroll(courseId: string, studentId: string): Promise<void> {
    const existing = await prisma.enrollment.findUnique({
      where: { courseId_studentId: { courseId, studentId } },
    });
    if (!existing) throw new NotFoundError('Enrollment');

    await prisma.enrollment.delete({ where: { id: existing.id } });
    await recomputeStatus(courseId);
  },

  /**
   * Create-or-update a roster and optionally enroll it into a course in one
   * pass. This is what the "paste the class list" flow calls: an existing
   * registration number updates the name rather than failing the whole batch.
   */
  async bulkImport(
    rows: Array<{ studentId: string; name: string; email?: string | null }>,
    options: { programId?: string | null; courseId?: string | null } = {},
  ): Promise<BulkImportResult> {
    const result: BulkImportResult = { created: 0, updated: 0, enrolled: 0, skipped: [] };

    if (options.courseId) {
      const course = await prisma.course.findUnique({ where: { id: options.courseId } });
      if (!course) throw new NotFoundError('Course');
    }

    for (const row of rows) {
      const studentId = String(row.studentId ?? '').trim();
      const name = String(row.name ?? '').trim();

      if (!studentId) {
        result.skipped.push({ studentId: '(blank)', reason: 'No registration number' });
        continue;
      }
      if (!name) {
        result.skipped.push({ studentId, reason: 'No name' });
        continue;
      }

      const existing = await prisma.student.findUnique({ where: { studentId } });
      let record;

      if (existing) {
        record = await prisma.student.update({
          where: { id: existing.id },
          data: {
            name,
            ...(row.email !== undefined && { email: row.email?.trim().toLowerCase() || null }),
            ...(options.programId && !existing.programId && { programId: options.programId }),
          },
        });
        result.updated += 1;
      } else {
        record = await prisma.student.create({
          data: {
            studentId,
            name,
            email: row.email?.trim().toLowerCase() || null,
            programId: options.programId ?? null,
          },
        });
        result.created += 1;
      }

      if (options.courseId) {
        const enrollment = await prisma.enrollment.findUnique({
          where: { courseId_studentId: { courseId: options.courseId, studentId: record.id } },
        });
        if (!enrollment) {
          await prisma.enrollment.create({
            data: { courseId: options.courseId, studentId: record.id },
          });
          result.enrolled += 1;
        }
      }
    }

    if (options.courseId) await recomputeStatus(options.courseId);
    return result;
  },
};
