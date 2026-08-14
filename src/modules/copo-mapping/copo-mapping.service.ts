import { prisma } from '../../database/client';
import { NotFoundError, UnprocessableError } from '../../common/errors';
import { MAPPING_STRENGTHS, MappingStrength } from '../../common/vocabulary';
import { recomputeStatus } from '../courses/courses.service';

// ─────────────────────────────────────────────────────────────────────────────
// The CO-PO matrix.
//
// Strength 0 means "not mapped" and is never stored — writing a 0 deletes the
// row. That keeps `mappings.length > 0` a reliable answer to "is this CO
// mapped?" everywhere else in the codebase.
// ─────────────────────────────────────────────────────────────────────────────

export interface MatrixEntry {
  id: string;
  courseOutcomeId: string;
  programOutcomeId: string;
  strength: MappingStrength;
}

export interface MatrixView {
  courseId: string;
  cos: Array<{ id: string; code: string; statement: string }>;
  pos: Array<{ id: string; code: string; title: string }>;
  entries: MatrixEntry[];
  /** POs with no incoming mapping — the matrix highlights these in red. */
  invalidPOs: string[];
  /** COs with no outgoing mapping. */
  unmappedCOs: string[];
  complete: boolean;
}

export const copoMappingService = {
  /** Everything the matrix component needs, in one round trip. */
  async matrix(courseId: string): Promise<MatrixView> {
    const course = await prisma.course.findUnique({ where: { id: courseId } });
    if (!course) throw new NotFoundError('Course');

    const [cos, pos] = await Promise.all([
      prisma.courseOutcome.findMany({
        where: { courseId },
        orderBy: [{ order: 'asc' }, { code: 'asc' }],
        select: { id: true, code: true, statement: true },
      }),
      prisma.programOutcome.findMany({
        where: { programId: course.programId },
        orderBy: [{ order: 'asc' }, { code: 'asc' }],
        select: { id: true, code: true, title: true },
      }),
    ]);

    const rows = await prisma.cOPOMapping.findMany({
      where: { courseOutcomeId: { in: cos.map((c) => c.id) } },
    });

    const entries: MatrixEntry[] = rows.map((r) => ({
      id: r.id,
      courseOutcomeId: r.courseOutcomeId,
      programOutcomeId: r.programOutcomeId,
      strength: r.strength as MappingStrength,
    }));

    const mappedPOIds = new Set(entries.map((e) => e.programOutcomeId));
    const mappedCOIds = new Set(entries.map((e) => e.courseOutcomeId));

    const invalidPOs = pos.filter((po) => !mappedPOIds.has(po.id)).map((po) => po.code);
    const unmappedCOs = cos.filter((co) => !mappedCOIds.has(co.id)).map((co) => co.code);

    return {
      courseId,
      cos,
      pos,
      entries,
      invalidPOs,
      unmappedCOs,
      complete: cos.length > 0 && invalidPOs.length === 0 && unmappedCOs.length === 0,
    };
  },

  /**
   * Apply a batch of cell edits. Only the cells the teacher touched are sent,
   * so this is a patch and not a replace — untouched cells keep their value.
   */
  async save(
    courseId: string,
    entries: Array<{ courseOutcomeId: string; programOutcomeId: string; strength: number }>,
  ): Promise<MatrixView> {
    const course = await prisma.course.findUnique({ where: { id: courseId } });
    if (!course) throw new NotFoundError('Course');

    const [cos, pos] = await Promise.all([
      prisma.courseOutcome.findMany({ where: { courseId }, select: { id: true } }),
      prisma.programOutcome.findMany({
        where: { programId: course.programId },
        select: { id: true },
      }),
    ]);
    const coIds = new Set(cos.map((c) => c.id));
    const poIds = new Set(pos.map((p) => p.id));

    for (const entry of entries) {
      if (!coIds.has(entry.courseOutcomeId)) {
        throw new UnprocessableError('The mapping references a Course Outcome from another course');
      }
      if (!poIds.has(entry.programOutcomeId)) {
        throw new UnprocessableError(
          "The mapping references a Program Outcome outside this course's program",
        );
      }
      if (!(MAPPING_STRENGTHS as readonly number[]).includes(entry.strength)) {
        throw new UnprocessableError(
          `Mapping strength must be 0, 1, 2 or 3 — received ${entry.strength}`,
        );
      }
    }

    for (const entry of entries) {
      const where = {
        courseOutcomeId_programOutcomeId: {
          courseOutcomeId: entry.courseOutcomeId,
          programOutcomeId: entry.programOutcomeId,
        },
      };

      if (entry.strength === 0) {
        await prisma.cOPOMapping.deleteMany({
          where: {
            courseOutcomeId: entry.courseOutcomeId,
            programOutcomeId: entry.programOutcomeId,
          },
        });
        continue;
      }

      await prisma.cOPOMapping.upsert({
        where,
        create: {
          courseOutcomeId: entry.courseOutcomeId,
          programOutcomeId: entry.programOutcomeId,
          strength: entry.strength,
        },
        update: { strength: entry.strength },
      });
    }

    await recomputeStatus(courseId);
    return copoMappingService.matrix(courseId);
  },
};
