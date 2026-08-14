import { Prisma } from '../../generated/prisma';
import { prisma } from '../../database/client';
import { buildMeta } from '../../common/pagination';
import { ApiMeta } from '../../common/response';
import { ConflictError, NotFoundError, UnprocessableError } from '../../common/errors';

// ─────────────────────────────────────────────────────────────────────────────
// Departments — the root of the academic structure.
// Admin-owned; everyone else reads them to populate filters.
// ─────────────────────────────────────────────────────────────────────────────

export interface DepartmentDto {
  id: string;
  name: string;
  code: string;
  programCount: number;
  courseCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ListDepartmentsOptions {
  page: number;
  limit: number;
  skip: number;
  search?: string;
  sortField: string;
  sortOrder: 'asc' | 'desc';
}

const SORTABLE = ['name', 'code', 'createdAt', 'updatedAt'];

export const departmentsService = {
  async list(opts: ListDepartmentsOptions): Promise<{ data: DepartmentDto[]; meta: ApiMeta }> {
    const where: Prisma.DepartmentWhereInput = {};
    if (opts.search) {
      where.OR = [
        { name: { contains: opts.search, mode: 'insensitive' } },
        { code: { contains: opts.search, mode: 'insensitive' } },
      ];
    }

    const sortField = SORTABLE.includes(opts.sortField) ? opts.sortField : 'name';

    const [rows, total] = await Promise.all([
      prisma.department.findMany({
        where,
        orderBy: { [sortField]: opts.sortOrder },
        skip: opts.skip,
        take: opts.limit,
        include: { _count: { select: { programs: true } } },
      }),
      prisma.department.count({ where }),
    ]);

    // Courses hang off programs, so a per-department course count needs its own
    // pass. One grouped query beats N per-row counts.
    const programs = await prisma.program.findMany({
      where: { departmentId: { in: rows.map((r) => r.id) } },
      select: { id: true, departmentId: true, _count: { select: { courses: true } } },
    });

    const courseCounts = new Map<string, number>();
    for (const p of programs) {
      courseCounts.set(p.departmentId, (courseCounts.get(p.departmentId) ?? 0) + p._count.courses);
    }

    return {
      data: rows.map((r) => ({
        id: r.id,
        name: r.name,
        code: r.code,
        programCount: r._count.programs,
        courseCount: courseCounts.get(r.id) ?? 0,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      })),
      meta: buildMeta(total, opts.page, opts.limit),
    };
  },

  async findById(id: string): Promise<DepartmentDto> {
    const row = await prisma.department.findUnique({
      where: { id },
      include: { _count: { select: { programs: true } } },
    });
    if (!row) throw new NotFoundError('Department');

    const programs = await prisma.program.findMany({
      where: { departmentId: id },
      select: { _count: { select: { courses: true } } },
    });

    return {
      id: row.id,
      name: row.name,
      code: row.code,
      programCount: row._count.programs,
      courseCount: programs.reduce((sum, p) => sum + p._count.courses, 0),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  },

  async create(data: { name: string; code: string }): Promise<DepartmentDto> {
    const code = data.code.trim().toUpperCase();
    const existing = await prisma.department.findUnique({ where: { code } });
    if (existing) throw new ConflictError(`Department code ${code} is already in use`);

    const row = await prisma.department.create({ data: { name: data.name.trim(), code } });
    return { ...row, programCount: 0, courseCount: 0 };
  },

  async update(id: string, data: Partial<{ name: string; code: string }>): Promise<DepartmentDto> {
    const existing = await prisma.department.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError('Department');

    const patch: Prisma.DepartmentUpdateInput = {};
    if (data.name !== undefined) patch.name = data.name.trim();
    if (data.code !== undefined) {
      const code = data.code.trim().toUpperCase();
      if (code !== existing.code) {
        const clash = await prisma.department.findUnique({ where: { code } });
        if (clash) throw new ConflictError(`Department code ${code} is already in use`);
      }
      patch.code = code;
    }

    await prisma.department.update({ where: { id }, data: patch });
    return departmentsService.findById(id);
  },

  /**
   * Deleting a department would cascade through programs, courses, outcomes and
   * marks. That is never what the user meant, so refuse and name the blocker.
   */
  async delete(id: string): Promise<void> {
    const existing = await prisma.department.findUnique({
      where: { id },
      include: { _count: { select: { programs: true } } },
    });
    if (!existing) throw new NotFoundError('Department');

    if (existing._count.programs > 0) {
      throw new UnprocessableError(
        `${existing.code} still has ${existing._count.programs} program(s). Delete or move them first.`,
        'DEPARTMENT_NOT_EMPTY',
      );
    }

    await prisma.department.delete({ where: { id } });
  },
};
