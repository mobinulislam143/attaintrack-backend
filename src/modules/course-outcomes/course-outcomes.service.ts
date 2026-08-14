import { prisma } from '../../database/client';
import { ConflictError, NotFoundError, UnprocessableError } from '../../common/errors';
import { recomputeStatus } from '../courses/courses.service';

// ─────────────────────────────────────────────────────────────────────────────
// Course Outcomes (COs) — the teacher's own statements of what the course
// teaches. Every question is mapped to one; every CO is mapped to at least one
// Program Outcome. Both halves of that sentence are enforced elsewhere and
// surfaced through `inspectSetup`.
// ─────────────────────────────────────────────────────────────────────────────

export interface CourseOutcomeDto {
  id: string;
  code: string;
  statement: string;
  target: number;
  order: number;
  courseId: string;
  /** PO codes this CO maps to, e.g. ["PO1", "PO3"]. */
  mappedPOs: string[];
  questionCount: number;
  /** Percentage from the course's most recent run, or null if never calculated. */
  attainment: number | null;
  createdAt: Date;
  updatedAt: Date;
}

interface RunCoEntry {
  code?: string;
  attainment?: number;
}

/** Pull per-CO attainment out of the latest run's stored JSON. */
async function latestAttainmentByCode(courseId: string): Promise<Map<string, number>> {
  const run = await prisma.attainmentRun.findFirst({
    where: { courseId },
    orderBy: { calculatedAt: 'desc' },
    select: { co: true },
  });

  const map = new Map<string, number>();
  if (!run) return map;

  for (const entry of (run.co as RunCoEntry[]) ?? []) {
    if (entry?.code && typeof entry.attainment === 'number') map.set(entry.code, entry.attainment);
  }
  return map;
}

export const courseOutcomesService = {
  /** All COs of a course, ordered, with mapping and question counts attached. */
  async listByCourse(courseId: string): Promise<CourseOutcomeDto[]> {
    const course = await prisma.course.findUnique({ where: { id: courseId } });
    if (!course) throw new NotFoundError('Course');

    const [rows, attainment] = await Promise.all([
      prisma.courseOutcome.findMany({
        where: { courseId },
        orderBy: [{ order: 'asc' }, { code: 'asc' }],
        include: {
          mappings: { include: { programOutcome: { select: { code: true, order: true } } } },
          _count: { select: { questions: true } },
        },
      }),
      latestAttainmentByCode(courseId),
    ]);

    return rows.map((row) => ({
      id: row.id,
      code: row.code,
      statement: row.statement,
      target: row.target,
      order: row.order,
      courseId: row.courseId,
      mappedPOs: row.mappings
        .slice()
        .sort((a, b) => a.programOutcome.order - b.programOutcome.order)
        .map((m) => m.programOutcome.code),
      questionCount: row._count.questions,
      attainment: attainment.get(row.code) ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
  },

  async findById(id: string): Promise<CourseOutcomeDto> {
    const row = await prisma.courseOutcome.findUnique({ where: { id } });
    if (!row) throw new NotFoundError('Course Outcome');

    const all = await courseOutcomesService.listByCourse(row.courseId);
    return all.find((co) => co.id === id)!;
  },

  async create(data: {
    courseId: string;
    code?: string;
    statement: string;
    target?: number;
  }): Promise<CourseOutcomeDto> {
    const course = await prisma.course.findUnique({ where: { id: data.courseId } });
    if (!course) throw new NotFoundError('Course');

    const existing = await prisma.courseOutcome.findMany({
      where: { courseId: data.courseId },
      orderBy: { order: 'desc' },
      take: 1,
    });
    const lastOrder = existing[0]?.order ?? -1;

    // Codes follow CO1, CO2, … so the teacher rarely types one.
    const code = (data.code?.trim().toUpperCase() || `CO${lastOrder + 2}`).replace(/\s+/g, '');

    const clash = await prisma.courseOutcome.findUnique({
      where: { courseId_code: { courseId: data.courseId, code } },
    });
    if (clash) throw new ConflictError(`${code} already exists in ${course.code}`);

    const row = await prisma.courseOutcome.create({
      data: {
        courseId: data.courseId,
        code,
        statement: data.statement.trim(),
        target: data.target ?? course.attainmentTarget,
        order: lastOrder + 1,
      },
    });

    await recomputeStatus(data.courseId);
    return courseOutcomesService.findById(row.id);
  },

  async update(
    id: string,
    data: Partial<{ code: string; statement: string; target: number }>,
  ): Promise<CourseOutcomeDto> {
    const existing = await prisma.courseOutcome.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError('Course Outcome');

    let code = existing.code;
    if (data.code !== undefined) {
      code = data.code.trim().toUpperCase().replace(/\s+/g, '');
      if (code !== existing.code) {
        const clash = await prisma.courseOutcome.findUnique({
          where: { courseId_code: { courseId: existing.courseId, code } },
        });
        if (clash) throw new ConflictError(`${code} already exists in this course`);
      }
    }

    await prisma.courseOutcome.update({
      where: { id },
      data: {
        code,
        ...(data.statement !== undefined && { statement: data.statement.trim() }),
        ...(data.target !== undefined && { target: data.target }),
      },
    });

    await recomputeStatus(existing.courseId);
    return courseOutcomesService.findById(id);
  },

  /**
   * Deleting a CO orphans every question mapped to it, which would silently
   * drop those marks out of attainment. Refuse and name the count.
   */
  async delete(id: string): Promise<void> {
    const existing = await prisma.courseOutcome.findUnique({
      where: { id },
      include: { _count: { select: { questions: true } } },
    });
    if (!existing) throw new NotFoundError('Course Outcome');

    if (existing._count.questions > 0) {
      throw new UnprocessableError(
        `${existing.code} is mapped by ${existing._count.questions} question(s). Remap those questions first.`,
        'CO_IN_USE',
      );
    }

    await prisma.courseOutcome.delete({ where: { id } });
    await recomputeStatus(existing.courseId);
  },

  async reorder(courseId: string, orderedIds: string[]): Promise<CourseOutcomeDto[]> {
    const owned = await prisma.courseOutcome.findMany({ where: { courseId }, select: { id: true } });
    const ownedIds = new Set(owned.map((o) => o.id));

    if (orderedIds.some((id) => !ownedIds.has(id))) {
      throw new UnprocessableError('The reorder list contains outcomes from another course');
    }

    await Promise.all(
      orderedIds.map((id, index) =>
        prisma.courseOutcome.update({ where: { id }, data: { order: index } }),
      ),
    );

    return courseOutcomesService.listByCourse(courseId);
  },
};
