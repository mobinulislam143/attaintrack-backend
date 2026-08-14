import { prisma } from '../../database/client';
import { ConflictError, NotFoundError, UnprocessableError } from '../../common/errors';

// ─────────────────────────────────────────────────────────────────────────────
// Academic sessions — "Spring 2026", "Fall 2025".
//
// Exactly one session is active at a time; activating one deactivates the rest
// in the same operation so the UI never has to reconcile two.
// ─────────────────────────────────────────────────────────────────────────────

export interface SessionDto {
  id: string;
  name: string;
  startDate: Date;
  endDate: Date;
  isActive: boolean;
  courseCount?: number;
  createdAt: Date;
  updatedAt: Date;
}

export const sessionsService = {
  /** Newest first. A department has a handful, so no pagination. */
  async list(): Promise<SessionDto[]> {
    const rows = await prisma.academicSession.findMany({
      orderBy: [{ isActive: 'desc' }, { startDate: 'desc' }],
      include: { _count: { select: { courses: true } } },
    });
    return rows.map(({ _count, ...row }) => ({ ...row, courseCount: _count.courses }));
  },

  async findById(id: string): Promise<SessionDto> {
    const row = await prisma.academicSession.findUnique({
      where: { id },
      include: { _count: { select: { courses: true } } },
    });
    if (!row) throw new NotFoundError('Academic session');
    const { _count, ...rest } = row;
    return { ...rest, courseCount: _count.courses };
  },

  /** The session new courses default into. Null when none is marked active. */
  async findActive(): Promise<SessionDto | null> {
    return prisma.academicSession.findFirst({ where: { isActive: true } });
  },

  async create(data: {
    name: string;
    startDate: string | Date;
    endDate: string | Date;
    isActive?: boolean;
  }): Promise<SessionDto> {
    const name = data.name.trim();
    const clash = await prisma.academicSession.findUnique({ where: { name } });
    if (clash) throw new ConflictError(`Session ${name} already exists`);

    const startDate = new Date(data.startDate);
    const endDate = new Date(data.endDate);
    if (endDate <= startDate) {
      throw new UnprocessableError('The end date must fall after the start date', 'INVALID_DATE_RANGE');
    }

    const row = await prisma.academicSession.create({
      data: { name, startDate, endDate, isActive: false },
    });

    if (data.isActive) return sessionsService.activate(row.id);
    return { ...row, courseCount: 0 };
  },

  async update(
    id: string,
    data: Partial<{ name: string; startDate: string | Date; endDate: string | Date }>,
  ): Promise<SessionDto> {
    const existing = await prisma.academicSession.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError('Academic session');

    const startDate = data.startDate ? new Date(data.startDate) : existing.startDate;
    const endDate = data.endDate ? new Date(data.endDate) : existing.endDate;
    if (endDate <= startDate) {
      throw new UnprocessableError('The end date must fall after the start date', 'INVALID_DATE_RANGE');
    }

    if (data.name !== undefined && data.name.trim() !== existing.name) {
      const clash = await prisma.academicSession.findUnique({ where: { name: data.name.trim() } });
      if (clash) throw new ConflictError(`Session ${data.name.trim()} already exists`);
    }

    await prisma.academicSession.update({
      where: { id },
      data: {
        ...(data.name !== undefined && { name: data.name.trim() }),
        startDate,
        endDate,
      },
    });
    return sessionsService.findById(id);
  },

  /** Make this the one active session. */
  async activate(id: string): Promise<SessionDto> {
    const existing = await prisma.academicSession.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError('Academic session');

    await prisma.academicSession.updateMany({
      where: { isActive: true, NOT: { id } },
      data: { isActive: false },
    });
    await prisma.academicSession.update({ where: { id }, data: { isActive: true } });

    return sessionsService.findById(id);
  },

  async delete(id: string): Promise<void> {
    const existing = await prisma.academicSession.findUnique({
      where: { id },
      include: { _count: { select: { courses: true } } },
    });
    if (!existing) throw new NotFoundError('Academic session');

    if (existing._count.courses > 0) {
      throw new UnprocessableError(
        `${existing.name} still has ${existing._count.courses} course(s). Delete or move them first.`,
        'SESSION_NOT_EMPTY',
      );
    }

    await prisma.academicSession.delete({ where: { id } });
  },
};
