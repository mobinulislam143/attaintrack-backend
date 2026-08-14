import { Prisma } from '../../generated/prisma';
import { prisma } from '../../database/client';
import { buildMeta } from '../../common/pagination';
import { ApiMeta } from '../../common/response';
import { AuthUser } from '../../types/express';
import { courseScope } from '../../common/scope';
import { CourseStatus } from '../../common/vocabulary';
import { ConflictError, NotFoundError } from '../../common/errors';

// ─────────────────────────────────────────────────────────────────────────────
// Courses — the unit of work for a teacher, and the spine of the value chain.
//
// `status` is never set by a client. It is derived from the course's own data
// by `recomputeStatus`, which every mutation in the workflow calls. That keeps
// the badge on the course card honest: it cannot claim "Report ready" for a
// course whose mapping was later broken.
// ─────────────────────────────────────────────────────────────────────────────

const COURSE_INCLUDE = {
  program: { select: { id: true, name: true, code: true } },
  session: { select: { id: true, name: true } },
  teacher: { select: { id: true, firstName: true, lastName: true, email: true } },
  _count: { select: { outcomes: true, assessments: true, enrollments: true } },
} satisfies Prisma.CourseInclude;

type CourseRow = Prisma.CourseGetPayload<{ include: typeof COURSE_INCLUDE }>;

export interface CourseDto {
  id: string;
  code: string;
  title: string;
  credit: number;
  section: string;
  status: string;
  attainmentThreshold: number;
  attainmentTarget: number;
  programId: string;
  sessionId: string;
  teacherId: string | null;
  program: { id: string; name: string; code: string };
  session: { id: string; name: string };
  teacher: { id: string; firstName: string; lastName: string; email: string } | null;
  studentCount: number;
  outcomeCount: number;
  assessmentCount: number;
  coAttainment: number | null;
  poAttainment: number | null;
  createdAt: Date;
  updatedAt: Date;
}

function toDto(
  row: CourseRow,
  attainment?: { overallCO: number; overallPO: number } | null,
): CourseDto {
  return {
    id: row.id,
    code: row.code,
    title: row.title,
    credit: row.credit,
    section: row.section,
    status: row.status,
    attainmentThreshold: row.attainmentThreshold,
    attainmentTarget: row.attainmentTarget,
    programId: row.programId,
    sessionId: row.sessionId,
    teacherId: row.teacherId,
    program: row.program,
    session: row.session,
    teacher: row.teacher,
    studentCount: row._count.enrollments,
    outcomeCount: row._count.outcomes,
    assessmentCount: row._count.assessments,
    coAttainment: attainment?.overallCO ?? null,
    poAttainment: attainment?.overallPO ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Attach the headline numbers from each course's most recent run, in one query. */
async function latestRuns(courseIds: string[]) {
  if (courseIds.length === 0) return new Map<string, { overallCO: number; overallPO: number }>();

  const runs = await prisma.attainmentRun.findMany({
    where: { courseId: { in: courseIds } },
    orderBy: { calculatedAt: 'desc' },
    select: { courseId: true, overallCO: true, overallPO: true },
  });

  const map = new Map<string, { overallCO: number; overallPO: number }>();
  for (const run of runs) {
    // findMany is ordered newest-first, so the first entry per course wins.
    if (!map.has(run.courseId)) {
      map.set(run.courseId, { overallCO: run.overallCO, overallPO: run.overallPO });
    }
  }
  return map;
}

// ─────────────────────────────────────────────────────────────────────────────
// Setup completeness
// ─────────────────────────────────────────────────────────────────────────────

export interface SetupCheck {
  /** Machine key, so the UI can deep-link to the tab that fixes it. */
  key:
    | 'course-outcomes'
    | 'copo-mapping'
    | 'assessments'
    | 'question-mapping'
    | 'enrollment'
    | 'marks';
  label: string;
  complete: boolean;
  /** Names the object and the fault. Empty when complete. */
  detail: string;
}

export interface CourseSetupStatus {
  courseId: string;
  status: CourseStatus;
  checks: SetupCheck[];
  /** True when every check above passes. */
  readyToCalculate: boolean;
  marksEntered: number;
  marksExpected: number;
}

/**
 * Inspect everything the workflow depends on and report, per step, whether it
 * is done — and if not, exactly which object is at fault.
 */
export async function inspectSetup(courseId: string): Promise<CourseSetupStatus> {
  const course = await prisma.course.findUnique({
    where: { id: courseId },
    include: {
      outcomes: { include: { mappings: true, questions: true }, orderBy: { order: 'asc' } },
      assessments: { include: { questions: true } },
      _count: { select: { enrollments: true } },
    },
  });
  if (!course) throw new NotFoundError('Course');

  const programOutcomes = await prisma.programOutcome.findMany({
    where: { programId: course.programId },
    orderBy: { order: 'asc' },
    select: { id: true, code: true },
  });

  const checks: SetupCheck[] = [];

  // 1 — Course Outcomes exist
  checks.push({
    key: 'course-outcomes',
    label: 'Course Outcomes defined',
    complete: course.outcomes.length > 0,
    detail:
      course.outcomes.length > 0
        ? ''
        : 'No Course Outcomes yet. Define at least one CO before mapping.',
  });

  // 2 — Every CO maps to a PO, and every PO is covered by a CO
  const unmappedCOs = course.outcomes.filter((co) => co.mappings.length === 0).map((co) => co.code);
  const mappedPOIds = new Set(course.outcomes.flatMap((co) => co.mappings.map((m) => m.programOutcomeId)));
  const uncoveredPOs = programOutcomes.filter((po) => !mappedPOIds.has(po.id)).map((po) => po.code);

  const mappingFaults: string[] = [];
  if (course.outcomes.length === 0) mappingFaults.push('There are no Course Outcomes to map.');
  if (unmappedCOs.length > 0) {
    mappingFaults.push(
      `${unmappedCOs.join(', ')} ${unmappedCOs.length > 1 ? 'have' : 'has'} no Program Outcome mapping.`,
    );
  }
  if (uncoveredPOs.length > 0) {
    mappingFaults.push(
      `${uncoveredPOs.join(', ')} ${uncoveredPOs.length > 1 ? 'have' : 'has'} no mapping.`,
    );
  }

  checks.push({
    key: 'copo-mapping',
    label: 'CO-PO mapping complete',
    complete: mappingFaults.length === 0,
    detail: mappingFaults.join(' '),
  });

  // 3 — At least one assessment carrying questions
  const withQuestions = course.assessments.filter((a) => a.questions.length > 0);
  const emptyAssessments = course.assessments
    .filter((a) => a.questions.length === 0)
    .map((a) => a.name);

  checks.push({
    key: 'assessments',
    label: 'Assessments created',
    complete: withQuestions.length > 0,
    detail:
      withQuestions.length > 0
        ? ''
        : course.assessments.length === 0
          ? 'No assessments yet. Create an assessment to start mapping questions to Course Outcomes.'
          : `${emptyAssessments.join(', ')} ${emptyAssessments.length > 1 ? 'have' : 'has'} no questions.`,
  });

  // 4 — Every question carries a CO
  const allQuestions = course.assessments.flatMap((a) =>
    a.questions.map((q) => ({ ...q, assessmentName: a.name })),
  );
  const unmappedQuestions = allQuestions.filter((q) => !q.courseOutcomeId);

  checks.push({
    key: 'question-mapping',
    label: 'Questions mapped to Course Outcomes',
    complete: allQuestions.length > 0 && unmappedQuestions.length === 0,
    detail:
      allQuestions.length === 0
        ? 'There are no questions to map.'
        : unmappedQuestions.length === 0
          ? ''
          : `${unmappedQuestions
              .slice(0, 4)
              .map((q) => `${q.assessmentName} ${q.code}`)
              .join(', ')}${unmappedQuestions.length > 4 ? ` and ${unmappedQuestions.length - 4} more` : ''} ${
              unmappedQuestions.length > 1 ? 'are' : 'is'
            } not mapped to a Course Outcome.`,
  });

  // 5 — Students enrolled
  checks.push({
    key: 'enrollment',
    label: 'Students enrolled',
    complete: course._count.enrollments > 0,
    detail:
      course._count.enrollments > 0
        ? ''
        : 'No students enrolled. Enroll students before entering marks.',
  });

  // 6 — Marks entered
  const questionIds = allQuestions.map((q) => q.id);
  const marksExpected = questionIds.length * course._count.enrollments;
  const marksEntered =
    questionIds.length === 0
      ? 0
      : await prisma.mark.count({
          where: { questionId: { in: questionIds }, obtained: { not: null } },
        });

  checks.push({
    key: 'marks',
    label: 'Marks entered',
    complete: marksExpected > 0 && marksEntered >= marksExpected,
    detail:
      marksExpected === 0
        ? 'There is nothing to mark yet.'
        : marksEntered >= marksExpected
          ? ''
          : `${marksEntered} of ${marksExpected} marks entered.`,
  });

  // ── Derive the status word ────────────────────────────────────────────────
  const setupComplete = checks
    .filter((c) => c.key !== 'marks' && c.key !== 'enrollment')
    .every((c) => c.complete);

  let status: CourseStatus;
  if (!setupComplete) status = 'setup-incomplete';
  else if (course._count.enrollments === 0 || marksEntered === 0) status = 'ready';
  else if (marksEntered < marksExpected) status = 'in-progress';
  else status = 'marks-uploaded';

  // A completed run or report outranks the data-derived status, but only while
  // setup still holds — a broken mapping demotes the course back immediately.
  if (setupComplete && marksEntered > 0) {
    const [run, report] = await Promise.all([
      prisma.attainmentRun.findFirst({ where: { courseId }, orderBy: { calculatedAt: 'desc' } }),
      prisma.report.findFirst({ where: { courseId }, orderBy: { generatedAt: 'desc' } }),
    ]);
    if (run) status = 'calculated';
    if (report) status = 'report-ready';
  }

  return {
    courseId,
    status,
    checks,
    readyToCalculate: setupComplete && marksEntered > 0,
    marksEntered,
    marksExpected,
  };
}

/** Recompute and persist a course's status. Called after every workflow mutation. */
export async function recomputeStatus(courseId: string): Promise<CourseStatus> {
  const setup = await inspectSetup(courseId);
  await prisma.course.update({ where: { id: courseId }, data: { status: setup.status } });
  return setup.status;
}

// ─────────────────────────────────────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────────────────────────────────────

export interface ListCoursesOptions {
  page: number;
  limit: number;
  skip: number;
  search?: string;
  programId?: string;
  sessionId?: string;
  teacherId?: string;
  status?: string;
  sortField: string;
  sortOrder: 'asc' | 'desc';
}

const SORTABLE = ['code', 'title', 'status', 'createdAt', 'updatedAt'];

export const coursesService = {
  async list(
    user: AuthUser,
    opts: ListCoursesOptions,
  ): Promise<{ data: CourseDto[]; meta: ApiMeta }> {
    const where: Prisma.CourseWhereInput = { ...(await courseScope(user)) };

    if (opts.programId) where.programId = opts.programId;
    if (opts.sessionId) where.sessionId = opts.sessionId;
    if (opts.teacherId) where.teacherId = opts.teacherId;
    if (opts.status) where.status = opts.status;
    if (opts.search) {
      where.OR = [
        { code: { contains: opts.search, mode: 'insensitive' } },
        { title: { contains: opts.search, mode: 'insensitive' } },
      ];
    }

    const sortField = SORTABLE.includes(opts.sortField) ? opts.sortField : 'code';

    const [rows, total] = await Promise.all([
      prisma.course.findMany({
        where,
        include: COURSE_INCLUDE,
        orderBy: { [sortField]: opts.sortOrder },
        skip: opts.skip,
        take: opts.limit,
      }),
      prisma.course.count({ where }),
    ]);

    const runs = await latestRuns(rows.map((r) => r.id));

    return {
      data: rows.map((r) => toDto(r, runs.get(r.id))),
      meta: buildMeta(total, opts.page, opts.limit),
    };
  },

  async findById(id: string): Promise<CourseDto> {
    const row = await prisma.course.findUnique({ where: { id }, include: COURSE_INCLUDE });
    if (!row) throw new NotFoundError('Course');
    const runs = await latestRuns([id]);
    return toDto(row, runs.get(id));
  },

  async create(data: {
    code: string;
    title: string;
    credit?: number;
    section?: string;
    programId: string;
    sessionId: string;
    teacherId?: string | null;
    attainmentThreshold?: number;
    attainmentTarget?: number;
  }): Promise<CourseDto> {
    const [program, session] = await Promise.all([
      prisma.program.findUnique({ where: { id: data.programId } }),
      prisma.academicSession.findUnique({ where: { id: data.sessionId } }),
    ]);
    if (!program) throw new NotFoundError('Program');
    if (!session) throw new NotFoundError('Academic session');

    const code = data.code.trim().toUpperCase();
    const section = (data.section ?? 'A').trim().toUpperCase();

    const clash = await prisma.course.findUnique({
      where: { code_section_sessionId: { code, section, sessionId: data.sessionId } },
    });
    if (clash) {
      throw new ConflictError(
        `${code} section ${section} already exists in ${session.name}`,
        'COURSE_DUPLICATE',
      );
    }

    if (data.teacherId) await assertTeacher(data.teacherId);

    const row = await prisma.course.create({
      data: {
        code,
        title: data.title.trim(),
        credit: data.credit ?? 3,
        section,
        programId: data.programId,
        sessionId: data.sessionId,
        teacherId: data.teacherId ?? null,
        attainmentThreshold: data.attainmentThreshold ?? 60,
        attainmentTarget: data.attainmentTarget ?? 70,
        status: 'setup-incomplete',
      },
      include: COURSE_INCLUDE,
    });

    return toDto(row, null);
  },

  async update(
    id: string,
    data: Partial<{
      code: string;
      title: string;
      credit: number;
      section: string;
      programId: string;
      sessionId: string;
      attainmentThreshold: number;
      attainmentTarget: number;
    }>,
  ): Promise<CourseDto> {
    const existing = await prisma.course.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError('Course');

    const code = data.code?.trim().toUpperCase() ?? existing.code;
    const section = data.section?.trim().toUpperCase() ?? existing.section;
    const sessionId = data.sessionId ?? existing.sessionId;

    if (code !== existing.code || section !== existing.section || sessionId !== existing.sessionId) {
      const clash = await prisma.course.findUnique({
        where: { code_section_sessionId: { code, section, sessionId } },
      });
      if (clash && clash.id !== id) {
        throw new ConflictError(
          `${code} section ${section} already exists in that session`,
          'COURSE_DUPLICATE',
        );
      }
    }

    await prisma.course.update({
      where: { id },
      data: {
        code,
        section,
        sessionId,
        ...(data.title !== undefined && { title: data.title.trim() }),
        ...(data.credit !== undefined && { credit: data.credit }),
        ...(data.programId !== undefined && { programId: data.programId }),
        ...(data.attainmentThreshold !== undefined && {
          attainmentThreshold: data.attainmentThreshold,
        }),
        ...(data.attainmentTarget !== undefined && { attainmentTarget: data.attainmentTarget }),
      },
    });

    await recomputeStatus(id);
    return coursesService.findById(id);
  },

  /** Assign or clear the course teacher. Pass null to unassign. */
  async assignTeacher(id: string, teacherId: string | null): Promise<CourseDto> {
    const existing = await prisma.course.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError('Course');

    if (teacherId) await assertTeacher(teacherId);

    await prisma.course.update({ where: { id }, data: { teacherId } });
    return coursesService.findById(id);
  },

  async delete(id: string): Promise<void> {
    const existing = await prisma.course.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError('Course');
    await prisma.course.delete({ where: { id } });
  },

  /** The workflow stepper's data source. */
  async setup(id: string): Promise<CourseSetupStatus> {
    return inspectSetup(id);
  },
};

/** A course teacher must be an existing account holding the `teacher` role. */
async function assertTeacher(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { userRoles: { include: { role: true } } },
  });
  if (!user) throw new NotFoundError('Teacher account');

  const isTeacher = user.userRoles.some((ur) => ur.role.name === 'teacher' || ur.role.name === 'admin');
  if (!isTeacher) {
    throw new ConflictError(
      `${user.firstName} ${user.lastName} does not hold the teacher role`,
      'NOT_A_TEACHER',
    );
  }
}
