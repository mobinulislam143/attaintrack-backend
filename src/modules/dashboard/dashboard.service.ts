import { prisma } from '../../database/client';
import { AuthUser } from '../../types/express';
import { isAdmin, isTeacher, requireStudentRecord } from '../../common/scope';
import { inspectSetup, coursesService, CourseDto } from '../courses/courses.service';
import { ForbiddenError } from '../../common/errors';

// ─────────────────────────────────────────────────────────────────────────────
// Dashboards.
//
// The teacher's dashboard is the only one that carries a to-do list, because
// the teacher is the only role with a workflow to be behind on. Each pending
// action names the object and the fault and deep-links to the screen that
// fixes it — a dashboard that only says "3 issues" makes the user hunt.
// ─────────────────────────────────────────────────────────────────────────────

export interface PendingAction {
  /** Lucide glyph name. */
  icon: string;
  title: string;
  detail: string;
  action: string;
  href: string;
  tone: 'error' | 'warning' | 'info';
}

export interface TeacherDashboard {
  kpis: {
    activeCourses: number;
    studentsTaught: number;
    averageCOAttainment: number | null;
    reportsReady: number;
  };
  pendingActions: PendingAction[];
  recentCourses: CourseDto[];
}

export interface AdminDashboard {
  kpis: { departments: number; programs: number; courses: number; users: number };
  coursesAwaitingSetup: CourseDto[];
  programsWithoutOutcomes: Array<{ id: string; name: string; code: string; departmentCode: string }>;
  usersByRole: Array<{ role: string; count: number }>;
}

export interface StudentDashboard {
  kpis: {
    enrolledCourses: number;
    assessmentsTaken: number;
    averagePercentage: number | null;
    outcomesAchieved: number;
  };
  coPerformance: Array<{
    code: string;
    courseCode: string;
    percentage: number;
    meetsThreshold: boolean;
  }>;
  courses: CourseDto[];
}

function round1(value: number): number {
  return Math.round(value * 10) / 10 + 0;
}

/** The first incomplete step of a course, phrased as something to do. */
const STEP_META: Record<string, { icon: string; action: string; tab: string; tone: PendingAction['tone'] }> = {
  'course-outcomes': { icon: 'target', action: 'Define Course Outcomes', tab: 'outcomes', tone: 'warning' },
  'copo-mapping': { icon: 'grid-3x3', action: 'Review Mapping', tab: 'mapping', tone: 'error' },
  assessments: { icon: 'clipboard-check', action: 'Create Assessment', tab: 'assessments', tone: 'warning' },
  'question-mapping': { icon: 'grid-3x3', action: 'Map Questions', tab: 'assessments', tone: 'error' },
  enrollment: { icon: 'users', action: 'Enroll Students', tab: 'students', tone: 'info' },
  marks: { icon: 'table', action: 'Enter Marks', tab: 'marks', tone: 'info' },
};

export const dashboardService = {
  async teacher(user: AuthUser): Promise<TeacherDashboard> {
    const courses = await prisma.course.findMany({
      where: isAdmin(user) ? {} : { teacherId: user.id },
      orderBy: { updatedAt: 'desc' },
      include: { _count: { select: { enrollments: true } } },
    });

    const courseIds = courses.map((c) => c.id);

    const [runs, reportCount] = await Promise.all([
      courseIds.length === 0
        ? []
        : prisma.attainmentRun.findMany({
            where: { courseId: { in: courseIds } },
            orderBy: { calculatedAt: 'desc' },
            select: { courseId: true, overallCO: true },
          }),
      courseIds.length === 0
        ? 0
        : prisma.report.count({ where: { courseId: { in: courseIds } } }),
    ]);

    const latestByCourse = new Map<string, number>();
    for (const run of runs) {
      if (!latestByCourse.has(run.courseId)) latestByCourse.set(run.courseId, run.overallCO);
    }

    const attainments = [...latestByCourse.values()];
    const averageCOAttainment =
      attainments.length === 0
        ? null
        : round1(attainments.reduce((sum, value) => sum + value, 0) / attainments.length);

    // Distinct students across every course this teacher runs.
    const enrollments =
      courseIds.length === 0
        ? []
        : await prisma.enrollment.findMany({
            where: { courseId: { in: courseIds } },
            select: { studentId: true },
          });
    const studentsTaught = new Set(enrollments.map((e) => e.studentId)).size;

    // ── Pending actions ─────────────────────────────────────────────────────
    const pendingActions: PendingAction[] = [];

    // Only the handful of most recently touched courses; a 40-item to-do list
    // is not a dashboard.
    for (const course of courses.slice(0, 6)) {
      const setup = await inspectSetup(course.id);
      const blocker = setup.checks.find((c) => !c.complete);

      if (blocker) {
        const meta = STEP_META[blocker.key] ?? {
          icon: 'triangle-alert',
          action: 'Open course',
          tab: 'setup',
          tone: 'warning' as const,
        };
        pendingActions.push({
          icon: meta.icon,
          title: `${course.code} · ${blocker.label.replace(/ (defined|complete|created|entered|enrolled)$/, '')}`,
          detail: blocker.detail,
          action: meta.action,
          href: `/teacher/courses/${course.id}?tab=${meta.tab}`,
          tone: meta.tone,
        });
        continue;
      }

      if (setup.readyToCalculate && !latestByCourse.has(course.id)) {
        pendingActions.push({
          icon: 'chart-column',
          title: `${course.code} · Ready to calculate`,
          detail: `${setup.marksEntered} of ${setup.marksExpected} marks entered. Attainment has not been calculated yet.`,
          action: 'Calculate Attainment',
          href: `/teacher/courses/${course.id}/attainment`,
          tone: 'info',
        });
      }
    }

    const dtos = await Promise.all(courses.slice(0, 6).map((c) => coursesService.findById(c.id)));

    return {
      kpis: {
        activeCourses: courses.length,
        studentsTaught,
        averageCOAttainment,
        reportsReady: reportCount,
      },
      pendingActions: pendingActions.slice(0, 6),
      recentCourses: dtos,
    };
  },

  async admin(user: AuthUser): Promise<AdminDashboard> {
    if (!isAdmin(user)) throw new ForbiddenError('Administrator access required');

    const [departments, programs, courses, users, roles] = await Promise.all([
      prisma.department.count(),
      prisma.program.count(),
      prisma.course.count(),
      prisma.user.count(),
      prisma.role.findMany({ include: { _count: { select: { userRoles: true } } } }),
    ]);

    const awaiting = await prisma.course.findMany({
      where: { OR: [{ status: 'setup-incomplete' }, { teacherId: null }] },
      orderBy: { updatedAt: 'desc' },
      take: 6,
      select: { id: true },
    });

    const programsWithoutOutcomes = await prisma.program.findMany({
      where: { outcomes: { none: {} } },
      take: 8,
      include: { department: { select: { code: true } } },
    });

    return {
      kpis: { departments, programs, courses, users },
      coursesAwaitingSetup: await Promise.all(awaiting.map((c) => coursesService.findById(c.id))),
      programsWithoutOutcomes: programsWithoutOutcomes.map((p) => ({
        id: p.id,
        name: p.name,
        code: p.code,
        departmentCode: p.department.code,
      })),
      usersByRole: roles.map((r) => ({ role: r.name, count: r._count.userRoles })),
    };
  },

  async student(user: AuthUser): Promise<StudentDashboard> {
    const student = await requireStudentRecord(user);

    const enrollments = await prisma.enrollment.findMany({
      where: { studentId: student.id },
      select: { courseId: true },
    });
    const courseIds = enrollments.map((e) => e.courseId);

    if (courseIds.length === 0) {
      return {
        kpis: {
          enrolledCourses: 0,
          assessmentsTaken: 0,
          averagePercentage: null,
          outcomesAchieved: 0,
        },
        coPerformance: [],
        courses: [],
      };
    }

    const courses = await prisma.course.findMany({
      where: { id: { in: courseIds } },
      select: { id: true, code: true, attainmentThreshold: true },
    });

    // Published assessments only — an unpublished mark does not exist yet as
    // far as the student is concerned.
    const assessments = await prisma.assessment.findMany({
      where: { courseId: { in: courseIds }, isPublished: true },
      include: {
        questions: {
          include: { courseOutcome: { select: { code: true, courseId: true } } },
        },
      },
    });

    const questionIds = assessments.flatMap((a) => a.questions.map((q) => q.id));
    const marks =
      questionIds.length === 0
        ? []
        : await prisma.mark.findMany({
            where: { questionId: { in: questionIds }, studentId: student.id },
            select: { questionId: true, obtained: true },
          });

    const obtainedByQuestion = new Map(marks.map((m) => [m.questionId, m.obtained]));

    // Aggregate per CO, within its course.
    const perCO = new Map<string, { code: string; courseCode: string; obtained: number; max: number; threshold: number }>();
    let totalObtained = 0;
    let totalMax = 0;
    const assessmentsTaken = new Set<string>();

    for (const assessment of assessments) {
      for (const question of assessment.questions) {
        const obtained = obtainedByQuestion.get(question.id);
        if (obtained === undefined || obtained === null) continue;

        assessmentsTaken.add(assessment.id);
        totalObtained += obtained;
        totalMax += question.maxMarks;

        if (!question.courseOutcome) continue;

        const course = courses.find((c) => c.id === question.courseOutcome!.courseId);
        const key = `${question.courseOutcome.courseId}:${question.courseOutcome.code}`;

        if (!perCO.has(key)) {
          perCO.set(key, {
            code: question.courseOutcome.code,
            courseCode: course?.code ?? '',
            obtained: 0,
            max: 0,
            threshold: course?.attainmentThreshold ?? 60,
          });
        }
        const entry = perCO.get(key)!;
        entry.obtained += obtained;
        entry.max += question.maxMarks;
      }
    }

    const coPerformance = [...perCO.values()]
      .map((entry) => {
        const percentage = entry.max === 0 ? 0 : round1((entry.obtained / entry.max) * 100);
        return {
          code: entry.code,
          courseCode: entry.courseCode,
          percentage,
          meetsThreshold: percentage >= entry.threshold,
        };
      })
      .sort((a, b) => a.courseCode.localeCompare(b.courseCode) || a.code.localeCompare(b.code));

    return {
      kpis: {
        enrolledCourses: courseIds.length,
        assessmentsTaken: assessmentsTaken.size,
        averagePercentage: totalMax === 0 ? null : round1((totalObtained / totalMax) * 100),
        outcomesAchieved: coPerformance.filter((c) => c.meetsThreshold).length,
      },
      coPerformance,
      courses: await Promise.all(courseIds.map((id) => coursesService.findById(id))),
    };
  },

  /** Route the caller to the dashboard their role earns. */
  async forUser(user: AuthUser): Promise<{
    role: 'admin' | 'teacher' | 'student';
    admin?: AdminDashboard;
    teacher?: TeacherDashboard;
    student?: StudentDashboard;
  }> {
    if (isAdmin(user)) return { role: 'admin', admin: await dashboardService.admin(user) };
    if (isTeacher(user)) return { role: 'teacher', teacher: await dashboardService.teacher(user) };
    return { role: 'student', student: await dashboardService.student(user) };
  },
};
