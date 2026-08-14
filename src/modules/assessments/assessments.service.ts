import { Prisma } from '../../generated/prisma';
import { prisma } from '../../database/client';
import { ConflictError, NotFoundError, UnprocessableError } from '../../common/errors';
import { ASSESSMENT_TYPES } from '../../common/vocabulary';
import { recomputeStatus } from '../courses/courses.service';

// ─────────────────────────────────────────────────────────────────────────────
// Assessments and their questions.
//
// The question is the atom of the whole system: it carries a maximum mark, it
// belongs to exactly one Course Outcome, and every mark row hangs off it.
// `totalMarks` on the assessment is always the sum of its questions and is
// never accepted from a client — a mismatch there would silently distort every
// attainment percentage downstream.
// ─────────────────────────────────────────────────────────────────────────────

const ASSESSMENT_INCLUDE = {
  questions: {
    orderBy: { order: 'asc' },
    include: { courseOutcome: { select: { id: true, code: true } } },
  },
} satisfies Prisma.AssessmentInclude;

type AssessmentRow = Prisma.AssessmentGetPayload<{ include: typeof ASSESSMENT_INCLUDE }>;

export interface QuestionDto {
  id: string;
  code: string;
  maxMarks: number;
  order: number;
  assessmentId: string;
  courseOutcomeId: string | null;
  courseOutcomeCode: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AssessmentDto {
  id: string;
  name: string;
  type: string;
  totalMarks: number;
  weight: number;
  conductedOn: Date | null;
  isPublished: boolean;
  courseId: string;
  questions: QuestionDto[];
  createdAt: Date;
  updatedAt: Date;
}

function toDto(row: AssessmentRow): AssessmentDto {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    totalMarks: row.totalMarks,
    weight: row.weight,
    conductedOn: row.conductedOn,
    isPublished: row.isPublished,
    courseId: row.courseId,
    questions: row.questions.map((q) => ({
      id: q.id,
      code: q.code,
      maxMarks: q.maxMarks,
      order: q.order,
      assessmentId: q.assessmentId,
      courseOutcomeId: q.courseOutcomeId,
      courseOutcomeCode: q.courseOutcome?.code ?? null,
      createdAt: q.createdAt,
      updatedAt: q.updatedAt,
    })),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Re-sum `totalMarks` from the questions. Called after any question change. */
async function syncTotalMarks(assessmentId: string): Promise<void> {
  const questions = await prisma.question.findMany({
    where: { assessmentId },
    select: { maxMarks: true },
  });
  const total = questions.reduce((sum, q) => sum + q.maxMarks, 0);
  await prisma.assessment.update({ where: { id: assessmentId }, data: { totalMarks: total } });
}

/** A question's CO must belong to the same course as its assessment. */
async function assertOutcomeInCourse(courseId: string, courseOutcomeId: string): Promise<void> {
  const co = await prisma.courseOutcome.findUnique({ where: { id: courseOutcomeId } });
  if (!co) throw new NotFoundError('Course Outcome');
  if (co.courseId !== courseId) {
    throw new UnprocessableError('That Course Outcome belongs to a different course');
  }
}

export interface QuestionInput {
  code: string;
  maxMarks: number;
  courseOutcomeId?: string | null;
}

export const assessmentsService = {
  async listByCourse(courseId: string): Promise<AssessmentDto[]> {
    const course = await prisma.course.findUnique({ where: { id: courseId } });
    if (!course) throw new NotFoundError('Course');

    const rows = await prisma.assessment.findMany({
      where: { courseId },
      include: ASSESSMENT_INCLUDE,
      orderBy: [{ conductedOn: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map(toDto);
  },

  async findById(id: string): Promise<AssessmentDto> {
    const row = await prisma.assessment.findUnique({ where: { id }, include: ASSESSMENT_INCLUDE });
    if (!row) throw new NotFoundError('Assessment');
    return toDto(row);
  },

  async create(data: {
    courseId: string;
    name: string;
    type?: string;
    weight?: number;
    conductedOn?: string | null;
    questions?: QuestionInput[];
  }): Promise<AssessmentDto> {
    const course = await prisma.course.findUnique({ where: { id: data.courseId } });
    if (!course) throw new NotFoundError('Course');

    const type = data.type ?? 'quiz';
    if (!(ASSESSMENT_TYPES as readonly string[]).includes(type)) {
      throw new UnprocessableError(`Assessment type must be one of: ${ASSESSMENT_TYPES.join(', ')}`);
    }

    const assessment = await prisma.assessment.create({
      data: {
        courseId: data.courseId,
        name: data.name.trim(),
        type,
        weight: data.weight ?? 0,
        conductedOn: data.conductedOn ? new Date(data.conductedOn) : null,
        totalMarks: 0,
      },
    });

    if (data.questions?.length) {
      await assessmentsService.replaceQuestions(assessment.id, data.questions);
    }

    await recomputeStatus(data.courseId);
    return assessmentsService.findById(assessment.id);
  },

  async update(
    id: string,
    data: Partial<{
      name: string;
      type: string;
      weight: number;
      conductedOn: string | null;
    }>,
  ): Promise<AssessmentDto> {
    const existing = await prisma.assessment.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError('Assessment');

    if (data.type !== undefined && !(ASSESSMENT_TYPES as readonly string[]).includes(data.type)) {
      throw new UnprocessableError(`Assessment type must be one of: ${ASSESSMENT_TYPES.join(', ')}`);
    }

    await prisma.assessment.update({
      where: { id },
      data: {
        ...(data.name !== undefined && { name: data.name.trim() }),
        ...(data.type !== undefined && { type: data.type }),
        ...(data.weight !== undefined && { weight: data.weight }),
        ...(data.conductedOn !== undefined && {
          conductedOn: data.conductedOn ? new Date(data.conductedOn) : null,
        }),
      },
    });

    return assessmentsService.findById(id);
  },

  async setPublished(id: string, isPublished: boolean): Promise<AssessmentDto> {
    const existing = await prisma.assessment.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError('Assessment');

    await prisma.assessment.update({ where: { id }, data: { isPublished } });
    return assessmentsService.findById(id);
  },

  async delete(id: string): Promise<void> {
    const existing = await prisma.assessment.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError('Assessment');

    await prisma.assessment.delete({ where: { id } });
    await recomputeStatus(existing.courseId);
  },

  // ── Questions ─────────────────────────────────────────────────────────────

  /**
   * Replace the whole question set in one call — the question editor is a grid
   * the teacher edits as a unit, so a diffed save keeps existing marks attached
   * to questions whose code did not change.
   */
  async replaceQuestions(assessmentId: string, questions: QuestionInput[]): Promise<AssessmentDto> {
    const assessment = await prisma.assessment.findUnique({
      where: { id: assessmentId },
      include: { questions: true },
    });
    if (!assessment) throw new NotFoundError('Assessment');

    const codes = questions.map((q) => q.code.trim().toUpperCase());
    const duplicates = codes.filter((code, i) => codes.indexOf(code) !== i);
    if (duplicates.length > 0) {
      throw new ConflictError(`Question code ${duplicates[0]} appears more than once`);
    }

    for (const q of questions) {
      if (!(q.maxMarks > 0)) {
        throw new UnprocessableError(`${q.code} must have a maximum mark greater than 0`);
      }
      if (q.courseOutcomeId) await assertOutcomeInCourse(assessment.courseId, q.courseOutcomeId);
    }

    const existingByCode = new Map(assessment.questions.map((q) => [q.code, q]));

    // Remove questions the teacher deleted — their marks go with them.
    const keep = new Set(codes);
    const removed = assessment.questions.filter((q) => !keep.has(q.code));
    if (removed.length > 0) {
      await prisma.question.deleteMany({ where: { id: { in: removed.map((q) => q.id) } } });
    }

    for (const [index, q] of questions.entries()) {
      const code = codes[index]!;
      const existing = existingByCode.get(code);

      if (existing) {
        await prisma.question.update({
          where: { id: existing.id },
          data: {
            maxMarks: q.maxMarks,
            order: index,
            courseOutcomeId: q.courseOutcomeId ?? null,
          },
        });
      } else {
        await prisma.question.create({
          data: {
            assessmentId,
            code,
            maxMarks: q.maxMarks,
            order: index,
            courseOutcomeId: q.courseOutcomeId ?? null,
          },
        });
      }
    }

    await syncTotalMarks(assessmentId);
    await recomputeStatus(assessment.courseId);
    return assessmentsService.findById(assessmentId);
  },

  /** Map (or unmap) a single question to a Course Outcome. */
  async mapQuestion(questionId: string, courseOutcomeId: string | null): Promise<QuestionDto> {
    const question = await prisma.question.findUnique({
      where: { id: questionId },
      include: { assessment: true },
    });
    if (!question) throw new NotFoundError('Question');

    if (courseOutcomeId) {
      await assertOutcomeInCourse(question.assessment.courseId, courseOutcomeId);
    }

    await prisma.question.update({ where: { id: questionId }, data: { courseOutcomeId } });
    await recomputeStatus(question.assessment.courseId);

    const updated = await prisma.question.findUnique({
      where: { id: questionId },
      include: { courseOutcome: { select: { id: true, code: true } } },
    });

    return {
      id: updated!.id,
      code: updated!.code,
      maxMarks: updated!.maxMarks,
      order: updated!.order,
      assessmentId: updated!.assessmentId,
      courseOutcomeId: updated!.courseOutcomeId,
      courseOutcomeCode: updated!.courseOutcome?.code ?? null,
      createdAt: updated!.createdAt,
      updatedAt: updated!.updatedAt,
    };
  },
};
