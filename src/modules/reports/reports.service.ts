import { prisma } from '../../database/client';
import { NotFoundError, UnprocessableError } from '../../common/errors';
import { COURSE_STATUS_LABELS, CourseStatus, advanceStatus } from '../../common/vocabulary';
import { attainmentService, AttainmentRunDto, StudentPerformance } from '../attainment/attainment.service';
import { copoMappingService, MatrixView } from '../copo-mapping/copo-mapping.service';
import {
  courseOutcomesService,
  CourseOutcomeDto,
} from '../course-outcomes/course-outcomes.service';

// ─────────────────────────────────────────────────────────────────────────────
// Reports.
//
// A report is a *citation*, not a snapshot: it stores the config the teacher
// chose and a pointer to the attainment run it was generated from. Regenerating
// after a recalculation therefore produces a new report rather than silently
// changing an old one, which is what an accreditation audit needs.
// ─────────────────────────────────────────────────────────────────────────────

export interface ReportConfig {
  includeCourseInfo: boolean;
  includeCOList: boolean;
  includeCOPOMatrix: boolean;
  includeCOAttainment: boolean;
  includePOAttainment: boolean;
  includeGapAnalysis: boolean;
  includeStudentList: boolean;
  signatoryName: string;
  signatoryTitle: string;
}

export const DEFAULT_REPORT_CONFIG: ReportConfig = {
  includeCourseInfo: true,
  includeCOList: true,
  includeCOPOMatrix: true,
  includeCOAttainment: true,
  includePOAttainment: true,
  includeGapAnalysis: true,
  includeStudentList: false,
  signatoryName: '',
  signatoryTitle: 'Course Teacher',
};

export interface ReportDto {
  id: string;
  courseId: string;
  runId: string;
  config: ReportConfig;
  generatedAt: Date;
  generatedById: string;
  generatedByName: string;
}

/** Everything the preview, the PDF and the workbook all render from. */
export interface ReportPayload {
  report: ReportDto;
  course: {
    id: string;
    code: string;
    title: string;
    credit: number;
    section: string;
    status: string;
    statusLabel: string;
    attainmentThreshold: number;
    attainmentTarget: number;
    program: { code: string; name: string; degree: string };
    department: { code: string; name: string };
    session: { name: string; startDate: Date; endDate: Date };
    teacher: { firstName: string; lastName: string; email: string } | null;
    studentCount: number;
  };
  run: AttainmentRunDto;
  outcomes: CourseOutcomeDto[];
  matrix: MatrixView;
  students: StudentPerformance[];
}

function normaliseConfig(input: Partial<ReportConfig> | undefined): ReportConfig {
  return { ...DEFAULT_REPORT_CONFIG, ...(input ?? {}) };
}

async function toDto(row: {
  id: string;
  courseId: string;
  runId: string;
  config: unknown;
  generatedAt: Date;
  generatedById: string;
}): Promise<ReportDto> {
  const user = await prisma.user.findUnique({
    where: { id: row.generatedById },
    select: { firstName: true, lastName: true },
  });

  return {
    id: row.id,
    courseId: row.courseId,
    runId: row.runId,
    config: normaliseConfig(row.config as Partial<ReportConfig>),
    generatedAt: row.generatedAt,
    generatedById: row.generatedById,
    generatedByName: user ? `${user.firstName} ${user.lastName}` : 'Unknown',
  };
}

export const reportsService = {
  async listByCourse(courseId: string): Promise<ReportDto[]> {
    const rows = await prisma.report.findMany({
      where: { courseId },
      orderBy: { generatedAt: 'desc' },
    });
    return Promise.all(rows.map(toDto));
  },

  /**
   * Generate a report against the course's most recent run (or a named one).
   * Refuses when no calculation exists — a report without numbers is a lie.
   */
  async generate(
    courseId: string,
    generatedById: string,
    config: Partial<ReportConfig>,
    runId?: string,
  ): Promise<ReportDto> {
    const course = await prisma.course.findUnique({ where: { id: courseId } });
    if (!course) throw new NotFoundError('Course');

    const run = runId
      ? await prisma.attainmentRun.findUnique({ where: { id: runId } })
      : await prisma.attainmentRun.findFirst({
          where: { courseId },
          orderBy: { calculatedAt: 'desc' },
        });

    if (!run) {
      throw new UnprocessableError(
        `${course.code} has no attainment calculation yet. Calculate attainment before generating a report.`,
        'NO_ATTAINMENT_RUN',
      );
    }
    if (run.courseId !== courseId) {
      throw new UnprocessableError('That attainment run belongs to a different course');
    }

    const row = await prisma.report.create({
      data: {
        courseId,
        runId: run.id,
        generatedById,
        config: normaliseConfig(config) as unknown as object,
      },
    });

    await prisma.course.update({
      where: { id: courseId },
      data: { status: advanceStatus(course.status, 'report-ready') },
    });

    return toDto(row);
  },

  async delete(id: string): Promise<void> {
    const existing = await prisma.report.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError('Report');

    await prisma.report.delete({ where: { id } });

    // Dropping the last report demotes the course back to "Attainment calculated".
    const remaining = await prisma.report.count({ where: { courseId: existing.courseId } });
    if (remaining === 0) {
      await prisma.course.update({
        where: { id: existing.courseId },
        data: { status: 'calculated' },
      });
    }
  },

  /** Assemble the full payload. One call feeds preview, PDF and Excel alike. */
  async payload(reportId: string): Promise<ReportPayload> {
    const row = await prisma.report.findUnique({ where: { id: reportId } });
    if (!row) throw new NotFoundError('Report');

    const report = await toDto(row);

    const course = await prisma.course.findUnique({
      where: { id: row.courseId },
      include: {
        program: { include: { department: { select: { code: true, name: true } } } },
        session: true,
        teacher: { select: { firstName: true, lastName: true, email: true } },
        _count: { select: { enrollments: true } },
      },
    });
    if (!course) throw new NotFoundError('Course');

    const [run, outcomes, matrix, students] = await Promise.all([
      attainmentService.findRun(row.runId),
      courseOutcomesService.listByCourse(row.courseId),
      copoMappingService.matrix(row.courseId),
      attainmentService.studentPerformance(row.courseId),
    ]);

    return {
      report,
      course: {
        id: course.id,
        code: course.code,
        title: course.title,
        credit: course.credit,
        section: course.section,
        status: course.status,
        statusLabel: COURSE_STATUS_LABELS[course.status as CourseStatus] ?? course.status,
        attainmentThreshold: course.attainmentThreshold,
        attainmentTarget: course.attainmentTarget,
        program: {
          code: course.program.code,
          name: course.program.name,
          degree: course.program.degree,
        },
        department: course.program.department,
        session: {
          name: course.session.name,
          startDate: course.session.startDate,
          endDate: course.session.endDate,
        },
        teacher: course.teacher,
        studentCount: course._count.enrollments,
      },
      run,
      outcomes,
      matrix,
      students,
    };
  },

  /** Filename stem shared by both exports, e.g. `cse-321-a-spring-2026`. */
  fileStem(payload: ReportPayload): string {
    return `${payload.course.code}-${payload.course.section}-${payload.course.session.name}`
      .replace(/[^\w-]+/g, '-')
      .toLowerCase();
  },
};
