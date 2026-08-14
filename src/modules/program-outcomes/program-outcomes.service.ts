import { prisma } from '../../database/client';
import { ConflictError, NotFoundError, UnprocessableError } from '../../common/errors';

// ─────────────────────────────────────────────────────────────────────────────
// Program Outcomes (POs).
//
// Authored only by admin. The teacher maps Course Outcomes onto them but never
// edits them — the whole point of a PO is that it is stable across courses.
// Always returned in `order`, never in insertion order.
// ─────────────────────────────────────────────────────────────────────────────

export interface ProgramOutcomeDto {
  id: string;
  code: string;
  title: string;
  description: string;
  target: number;
  order: number;
  programId: string;
  createdAt: Date;
  updatedAt: Date;
}

export const programOutcomesService = {
  /** All POs of a program, ordered. Not paginated — a program has 8–15. */
  async listByProgram(programId: string): Promise<ProgramOutcomeDto[]> {
    const program = await prisma.program.findUnique({ where: { id: programId } });
    if (!program) throw new NotFoundError('Program');

    return prisma.programOutcome.findMany({
      where: { programId },
      orderBy: [{ order: 'asc' }, { code: 'asc' }],
    });
  },

  async findById(id: string): Promise<ProgramOutcomeDto> {
    const row = await prisma.programOutcome.findUnique({ where: { id } });
    if (!row) throw new NotFoundError('Program Outcome');
    return row;
  },

  async create(data: {
    programId: string;
    code: string;
    title: string;
    description?: string;
    target?: number;
  }): Promise<ProgramOutcomeDto> {
    const program = await prisma.program.findUnique({ where: { id: data.programId } });
    if (!program) throw new NotFoundError('Program');

    const code = data.code.trim().toUpperCase();
    const clash = await prisma.programOutcome.findUnique({
      where: { programId_code: { programId: data.programId, code } },
    });
    if (clash) throw new ConflictError(`${code} already exists in ${program.code}`);

    const last = await prisma.programOutcome.findFirst({
      where: { programId: data.programId },
      orderBy: { order: 'desc' },
      select: { order: true },
    });

    return prisma.programOutcome.create({
      data: {
        programId: data.programId,
        code,
        title: data.title.trim(),
        description: data.description?.trim() ?? '',
        target: data.target ?? 70,
        order: (last?.order ?? -1) + 1,
      },
    });
  },

  async update(
    id: string,
    data: Partial<{ code: string; title: string; description: string; target: number }>,
  ): Promise<ProgramOutcomeDto> {
    const existing = await prisma.programOutcome.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError('Program Outcome');

    if (data.code !== undefined) {
      const code = data.code.trim().toUpperCase();
      if (code !== existing.code) {
        const clash = await prisma.programOutcome.findUnique({
          where: { programId_code: { programId: existing.programId, code } },
        });
        if (clash) throw new ConflictError(`${code} already exists in this program`);
      }
      data.code = code;
    }

    return prisma.programOutcome.update({
      where: { id },
      data: {
        ...(data.code !== undefined && { code: data.code }),
        ...(data.title !== undefined && { title: data.title.trim() }),
        ...(data.description !== undefined && { description: data.description.trim() }),
        ...(data.target !== undefined && { target: data.target }),
      },
    });
  },

  /**
   * Deleting a PO that courses already map to would silently change their
   * attainment history, so it is refused while mappings exist.
   */
  async delete(id: string): Promise<void> {
    const existing = await prisma.programOutcome.findUnique({
      where: { id },
      include: { _count: { select: { mappings: true } } },
    });
    if (!existing) throw new NotFoundError('Program Outcome');

    if (existing._count.mappings > 0) {
      throw new UnprocessableError(
        `${existing.code} is mapped by ${existing._count.mappings} Course Outcome(s). Remove those mappings first.`,
        'PO_IN_USE',
      );
    }

    await prisma.programOutcome.delete({ where: { id } });
  },

  /** Persist a drag-and-drop reorder. Ids not in the list keep their position. */
  async reorder(programId: string, orderedIds: string[]): Promise<ProgramOutcomeDto[]> {
    const owned = await prisma.programOutcome.findMany({
      where: { programId },
      select: { id: true },
    });
    const ownedIds = new Set(owned.map((o) => o.id));

    const foreign = orderedIds.filter((id) => !ownedIds.has(id));
    if (foreign.length > 0) {
      throw new UnprocessableError('The reorder list contains outcomes from another program');
    }

    await Promise.all(
      orderedIds.map((id, index) =>
        prisma.programOutcome.update({ where: { id }, data: { order: index } }),
      ),
    );

    return programOutcomesService.listByProgram(programId);
  },
};
