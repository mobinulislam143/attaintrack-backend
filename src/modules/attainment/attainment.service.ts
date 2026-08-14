import { prisma } from '../../database/client';
import { NotFoundError, UnprocessableError } from '../../common/errors';
import { OutcomeStatus, MappingStrength, advanceStatus } from '../../common/vocabulary';
import { inspectSetup } from '../courses/courses.service';

// ═════════════════════════════════════════════════════════════════════════════
// The attainment engine.
//
// One method is implemented — the *threshold* method, which is what
// accreditation bodies in this region expect and what the teacher's
// spreadsheet already did by hand:
//
//   1. A student ATTAINS a Course Outcome when their total on the questions
//      mapped to that CO reaches the course threshold (default 60%).
//   2. A Course Outcome is ACHIEVED when the share of students who attained it
//      reaches the CO's target (default 70%).
//   3. A Program Outcome's attainment is the strength-weighted mean of the CO
//      attainments that map to it — a strength-3 mapping counts three times as
//      much as a strength-1 one.
//
// Two rules matter and are easy to get wrong:
//
//   • A null mark is "not entered", not a zero. A student with no marks at all
//     on a CO is *not assessed* on it and is excluded from the denominator;
//     including them would report a fake failure. A student with some marks
//     entered has their blanks counted as zero, because a blank on one question
//     of an attempted exam is a non-answer.
//   • Questions with no CO contribute to a student's total but never to
//     attainment. `inspectSetup` refuses to let the calculation run while any
//     question is unmapped, so this can only happen to historical runs.
// ═════════════════════════════════════════════════════════════════════════════

export interface COAttainmentResult {
  courseOutcomeId: string;
  code: string;
  statement: string;
  target: number;
  /** Percentage of assessed students who attained the CO, one decimal. */
  attainment: number;
  studentsAssessed: number;
  studentsAtOrAbove: number;
  /** Marks available across every question mapped to this CO. */
  maxMarks: number;
  questionCount: number;
  /** Mean score on this CO across assessed students, as a percentage. */
  averageScore: number;
  status: OutcomeStatus;
}

export interface POAttainmentResult {
  programOutcomeId: string;
  code: string;
  title: string;
  target: number;
  attainment: number;
  contributingCOs: Array<{ code: string; strength: MappingStrength; attainment: number }>;
  status: OutcomeStatus;
}

export interface GapEntry {
  kind: 'CO' | 'PO';
  code: string;
  label: string;
  attainment: number;
  target: number;
  /** Signed percentage points, e.g. -7. */
  gap: number;
  /** Observations drawn from the marks. Never teaching advice. */
  observations: string[];
}

export interface AttainmentRunDto {
  id: string;
  courseId: string;
  method: 'threshold';
  threshold: number;
  target: number;
  overallCO: number;
  overallPO: number;
  calculatedAt: Date;
  co: COAttainmentResult[];
  po: POAttainmentResult[];
  gaps: GapEntry[];
}

export interface StudentPerformance {
  student: { id: string; studentId: string; name: string };
  totalObtained: number;
  totalMax: number;
  percentage: number;
  perCO: Array<{
    code: string;
    obtained: number;
    max: number;
    percentage: number;
    meetsThreshold: boolean;
  }>;
}

/** One decimal, and never `-0`. */
function round1(value: number): number {
  return Math.round(value * 10) / 10 + 0;
}

function outcomeStatus(assessed: number, attainment: number, target: number): OutcomeStatus {
  if (assessed === 0) return 'not-started';
  return attainment >= target ? 'achieved' : 'below-target';
}

// ─────────────────────────────────────────────────────────────────────────────
// Core computation — pure enough to reason about, and reused by both the
// calculate endpoint and the student-facing performance breakdown.
// ─────────────────────────────────────────────────────────────────────────────

interface CourseData {
  course: NonNullable<Awaited<ReturnType<typeof loadCourseData>>>['course'];
  outcomes: Awaited<ReturnType<typeof loadCourseData>>['outcomes'];
  students: Awaited<ReturnType<typeof loadCourseData>>['students'];
  marksByStudent: Map<string, Map<string, number | null>>;
}

/**
 * @param publishedOnly  Restrict to questions from published assessments. Used
 *   by the student-facing breakdown so a grade never appears before release.
 *   The teacher's own calculation always uses everything.
 */
async function loadCourseData(courseId: string, publishedOnly = false) {
  const course = await prisma.course.findUnique({ where: { id: courseId } });
  if (!course) throw new NotFoundError('Course');

  const outcomes = await prisma.courseOutcome.findMany({
    where: { courseId },
    orderBy: [{ order: 'asc' }, { code: 'asc' }],
    include: {
      questions: {
        where: publishedOnly ? { assessment: { isPublished: true } } : {},
        select: { id: true, code: true, maxMarks: true, assessmentId: true },
      },
      mappings: {
        include: { programOutcome: { select: { id: true, code: true, title: true, target: true, order: true } } },
      },
    },
  });

  const students = await prisma.student.findMany({
    where: { enrollments: { some: { courseId } } },
    orderBy: { studentId: 'asc' },
    select: { id: true, studentId: true, name: true },
  });

  const questionIds = outcomes.flatMap((co) => co.questions.map((q) => q.id));
  const marks =
    questionIds.length === 0
      ? []
      : await prisma.mark.findMany({
          where: { questionId: { in: questionIds }, studentId: { in: students.map((s) => s.id) } },
          select: { questionId: true, studentId: true, obtained: true },
        });

  const marksByStudent = new Map<string, Map<string, number | null>>();
  for (const mark of marks) {
    if (!marksByStudent.has(mark.studentId)) marksByStudent.set(mark.studentId, new Map());
    marksByStudent.get(mark.studentId)!.set(mark.questionId, mark.obtained);
  }

  return { course, outcomes, students, marksByStudent };
}

/**
 * One student's score on one CO.
 * Returns null when the student was never assessed on it.
 */
function scoreForCO(
  studentMarks: Map<string, number | null> | undefined,
  questions: Array<{ id: string; maxMarks: number }>,
): { obtained: number; max: number } | null {
  if (questions.length === 0) return null;

  const max = questions.reduce((sum, q) => sum + q.maxMarks, 0);
  if (max === 0) return null;

  let obtained = 0;
  let anyEntered = false;

  for (const question of questions) {
    const value = studentMarks?.get(question.id);
    if (value !== undefined && value !== null) {
      obtained += value;
      anyEntered = true;
    }
  }

  // No mark at all on any of this CO's questions → not assessed.
  if (!anyEntered) return null;
  return { obtained, max };
}

function computeCO(data: CourseData): COAttainmentResult[] {
  const { course, outcomes, students, marksByStudent } = data;

  return outcomes.map((co) => {
    const questions = co.questions;
    const maxMarks = questions.reduce((sum, q) => sum + q.maxMarks, 0);

    let studentsAssessed = 0;
    let studentsAtOrAbove = 0;
    let scoreSum = 0;

    for (const student of students) {
      const score = scoreForCO(marksByStudent.get(student.id), questions);
      if (!score) continue;

      studentsAssessed += 1;
      const percentage = (score.obtained / score.max) * 100;
      scoreSum += percentage;
      if (percentage >= course.attainmentThreshold) studentsAtOrAbove += 1;
    }

    const attainment =
      studentsAssessed === 0 ? 0 : round1((studentsAtOrAbove / studentsAssessed) * 100);

    return {
      courseOutcomeId: co.id,
      code: co.code,
      statement: co.statement,
      target: co.target,
      attainment,
      studentsAssessed,
      studentsAtOrAbove,
      maxMarks,
      questionCount: questions.length,
      averageScore: studentsAssessed === 0 ? 0 : round1(scoreSum / studentsAssessed),
      status: outcomeStatus(studentsAssessed, attainment, co.target),
    };
  });
}

function computePO(data: CourseData, coResults: COAttainmentResult[]): POAttainmentResult[] {
  const byCoId = new Map(coResults.map((r) => [r.courseOutcomeId, r]));

  interface Accumulator {
    id: string;
    code: string;
    title: string;
    target: number;
    order: number;
    weighted: number;
    weight: number;
    assessed: number;
    contributingCOs: Array<{ code: string; strength: MappingStrength; attainment: number }>;
  }

  const pos = new Map<string, Accumulator>();

  for (const co of data.outcomes) {
    const result = byCoId.get(co.id);
    if (!result) continue;

    for (const mapping of co.mappings) {
      const po = mapping.programOutcome;
      if (!pos.has(po.id)) {
        pos.set(po.id, {
          id: po.id,
          code: po.code,
          title: po.title,
          target: po.target,
          order: po.order,
          weighted: 0,
          weight: 0,
          assessed: 0,
          contributingCOs: [],
        });
      }

      const acc = pos.get(po.id)!;
      acc.contributingCOs.push({
        code: result.code,
        strength: mapping.strength as MappingStrength,
        attainment: result.attainment,
      });

      // A CO nobody was assessed on carries no information, so it is left out
      // of the weighted mean rather than dragging the PO to zero.
      if (result.studentsAssessed > 0) {
        acc.weighted += result.attainment * mapping.strength;
        acc.weight += mapping.strength;
        acc.assessed += 1;
      }
    }
  }

  return [...pos.values()]
    .sort((a, b) => a.order - b.order)
    .map((acc) => {
      const attainment = acc.weight === 0 ? 0 : round1(acc.weighted / acc.weight);
      return {
        programOutcomeId: acc.id,
        code: acc.code,
        title: acc.title,
        target: acc.target,
        attainment,
        contributingCOs: acc.contributingCOs,
        status: outcomeStatus(acc.assessed, attainment, acc.target),
      };
    });
}

/**
 * Gap analysis.
 *
 * Every line here is a fact read off the marks — how many students fell short,
 * how thin the evidence is, which question dragged the outcome down.
 * Interpretation and remedial planning remain with the course teacher, so no
 * sentence in this function recommends anything.
 */
function computeGaps(
  data: CourseData,
  coResults: COAttainmentResult[],
  poResults: POAttainmentResult[],
): GapEntry[] {
  const { course, outcomes, students, marksByStudent } = data;
  const gaps: GapEntry[] = [];

  for (const co of coResults) {
    if (co.status !== 'below-target') continue;

    const source = outcomes.find((o) => o.id === co.courseOutcomeId)!;
    const observations: string[] = [];

    const below = co.studentsAssessed - co.studentsAtOrAbove;
    const belowShare = co.studentsAssessed === 0 ? 0 : Math.round((below / co.studentsAssessed) * 100);
    observations.push(
      `${belowShare}% of students (${below} of ${co.studentsAssessed}) scored below the ${course.attainmentThreshold}% threshold for ${co.code}.`,
    );

    observations.push(
      `Mean score on ${co.code} is ${co.averageScore}% across ${co.maxMarks} marks.`,
    );

    if (co.questionCount === 1) {
      const only = source.questions[0];
      observations.push(
        `${co.code} is assessed by a single question (${only?.code ?? '—'}, ${only?.maxMarks ?? 0} marks).`,
      );
    } else {
      observations.push(`${co.code} is assessed by ${co.questionCount} questions.`);
    }

    // Name the weakest question, if one stands out.
    let weakest: { code: string; share: number } | null = null;
    for (const question of source.questions) {
      let obtained = 0;
      let max = 0;
      for (const student of students) {
        const value = marksByStudent.get(student.id)?.get(question.id);
        if (value === undefined || value === null) continue;
        obtained += value;
        max += question.maxMarks;
      }
      if (max === 0) continue;
      const share = Math.round((obtained / max) * 100);
      if (!weakest || share < weakest.share) weakest = { code: question.code, share };
    }
    if (weakest && source.questions.length > 1) {
      observations.push(`The class averaged ${weakest.share}% on ${weakest.code}, its lowest question.`);
    }

    const notAssessed = students.length - co.studentsAssessed;
    if (notAssessed > 0) {
      observations.push(
        `${notAssessed} enrolled student(s) have no marks recorded against ${co.code}.`,
      );
    }

    gaps.push({
      kind: 'CO',
      code: co.code,
      label: co.statement,
      attainment: co.attainment,
      target: co.target,
      gap: round1(co.attainment - co.target),
      observations,
    });
  }

  for (const po of poResults) {
    if (po.status !== 'below-target') continue;

    const observations: string[] = [];
    const contributors = po.contributingCOs
      .slice()
      .sort((a, b) => a.attainment - b.attainment)
      .map((c) => `${c.code} ${c.attainment}% (strength ${c.strength})`);

    observations.push(
      `${po.code} draws on ${po.contributingCOs.length} Course Outcome(s): ${contributors.join(', ')}.`,
    );

    const belowCOs = po.contributingCOs.filter((c) => {
      const source = coResults.find((r) => r.code === c.code);
      return source ? source.status === 'below-target' : false;
    });
    if (belowCOs.length > 0) {
      observations.push(
        `${belowCOs.map((c) => c.code).join(', ')} ${belowCOs.length > 1 ? 'are' : 'is'} below target and ${
          belowCOs.length > 1 ? 'carry' : 'carries'
        } ${belowCOs.reduce((sum, c) => sum + c.strength, 0)} of ${po.contributingCOs.reduce(
          (sum, c) => sum + c.strength,
          0,
        )} total mapping weight.`,
      );
    }

    if (po.contributingCOs.length === 1) {
      observations.push(`${po.code} has a single contributing Course Outcome.`);
    }

    gaps.push({
      kind: 'PO',
      code: po.code,
      label: po.title,
      attainment: po.attainment,
      target: po.target,
      gap: round1(po.attainment - po.target),
      observations,
    });
  }

  return gaps;
}

// ─────────────────────────────────────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────────────────────────────────────

function toDto(run: {
  id: string;
  courseId: string;
  method: string;
  threshold: number;
  target: number;
  overallCO: number;
  overallPO: number;
  calculatedAt: Date;
  co: unknown;
  po: unknown;
  gaps: unknown;
}): AttainmentRunDto {
  return {
    id: run.id,
    courseId: run.courseId,
    method: 'threshold',
    threshold: run.threshold,
    target: run.target,
    overallCO: run.overallCO,
    overallPO: run.overallPO,
    calculatedAt: run.calculatedAt,
    co: (run.co as COAttainmentResult[]) ?? [],
    po: (run.po as POAttainmentResult[]) ?? [],
    gaps: (run.gaps as GapEntry[]) ?? [],
  };
}

export const attainmentService = {
  /**
   * Run the calculation and persist it as an immutable record, so a report can
   * always cite the numbers it was generated from.
   */
  async calculate(courseId: string): Promise<AttainmentRunDto> {
    const setup = await inspectSetup(courseId);
    if (!setup.readyToCalculate) {
      const blocker = setup.checks.find((c) => !c.complete);
      throw new UnprocessableError(
        blocker?.detail || 'The course setup is incomplete.',
        'SETUP_INCOMPLETE',
      );
    }

    const data = await loadCourseData(courseId);
    const co = computeCO(data);
    const po = computePO(data, co);
    const gaps = computeGaps(data, co, po);

    const assessedCO = co.filter((c) => c.studentsAssessed > 0);
    const overallCO =
      assessedCO.length === 0
        ? 0
        : round1(assessedCO.reduce((sum, c) => sum + c.attainment, 0) / assessedCO.length);

    const assessedPO = po.filter((p) => p.status !== 'not-started');
    const overallPO =
      assessedPO.length === 0
        ? 0
        : round1(assessedPO.reduce((sum, p) => sum + p.attainment, 0) / assessedPO.length);

    const run = await prisma.attainmentRun.create({
      data: {
        courseId,
        method: 'threshold',
        threshold: data.course.attainmentThreshold,
        target: data.course.attainmentTarget,
        overallCO,
        overallPO,
        co: co as unknown as object,
        po: po as unknown as object,
        gaps: gaps as unknown as object,
      },
    });

    await prisma.course.update({
      where: { id: courseId },
      data: { status: advanceStatus(data.course.status, 'calculated') },
    });

    return toDto(run);
  },

  /** The most recent run, or null if the course has never been calculated. */
  async latest(courseId: string): Promise<AttainmentRunDto | null> {
    const run = await prisma.attainmentRun.findFirst({
      where: { courseId },
      orderBy: { calculatedAt: 'desc' },
    });
    return run ? toDto(run) : null;
  },

  async history(courseId: string): Promise<Array<Pick<AttainmentRunDto, 'id' | 'overallCO' | 'overallPO' | 'calculatedAt'>>> {
    const runs = await prisma.attainmentRun.findMany({
      where: { courseId },
      orderBy: { calculatedAt: 'desc' },
      select: { id: true, overallCO: true, overallPO: true, calculatedAt: true },
      take: 20,
    });
    return runs;
  },

  async findRun(runId: string): Promise<AttainmentRunDto> {
    const run = await prisma.attainmentRun.findUnique({ where: { id: runId } });
    if (!run) throw new NotFoundError('Attainment run');
    return toDto(run);
  },

  /**
   * Per-student breakdown. Computed live rather than read from a run, because
   * the teacher opens this drawer while still entering marks.
   */
  async studentPerformance(
    courseId: string,
    options: { publishedOnly?: boolean } = {},
  ): Promise<StudentPerformance[]> {
    const data = await loadCourseData(courseId, options.publishedOnly ?? false);
    const { course, outcomes, students, marksByStudent } = data;

    return students.map((student) => {
      const own = marksByStudent.get(student.id);
      let totalObtained = 0;
      let totalMax = 0;

      const perCO = outcomes.map((co) => {
        const score = scoreForCO(own, co.questions);
        const max = co.questions.reduce((sum, q) => sum + q.maxMarks, 0);
        const obtained = score?.obtained ?? 0;
        const percentage = max === 0 ? 0 : round1((obtained / max) * 100);

        if (score) {
          totalObtained += score.obtained;
          totalMax += score.max;
        }

        return {
          code: co.code,
          obtained,
          max,
          percentage,
          meetsThreshold: Boolean(score) && percentage >= course.attainmentThreshold,
        };
      });

      return {
        student,
        totalObtained,
        totalMax,
        percentage: totalMax === 0 ? 0 : round1((totalObtained / totalMax) * 100),
        perCO,
      };
    });
  },

  /** One student's own breakdown — the student portal's only numeric surface. */
  async studentPerformanceFor(
    courseId: string,
    studentRecordId: string,
    options: { publishedOnly?: boolean } = {},
  ): Promise<StudentPerformance | null> {
    const all = await attainmentService.studentPerformance(courseId, options);
    return all.find((p) => p.student.id === studentRecordId) ?? null;
  },
};
