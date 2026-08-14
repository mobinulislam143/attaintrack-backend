import { Prisma } from '../../generated/prisma';
import { prisma } from '../../database/client';
import { buildMeta } from '../../common/pagination';
import { ApiMeta } from '../../common/response';
import { ConflictError, NotFoundError, UnprocessableError } from '../../common/errors';

// ─────────────────────────────────────────────────────────────────────────────
// Programs — a degree programme inside a department. Owns the Program Outcomes
// that every course in it maps to.
// ─────────────────────────────────────────────────────────────────────────────

const PROGRAM_INCLUDE = {
  department: { select: { id: true, name: true, code: true } },
  _count: { select: { outcomes: true, courses: true } },
} satisfies Prisma.ProgramInclude;

type ProgramRow = Prisma.ProgramGetPayload<{ include: typeof PROGRAM_INCLUDE }>;

export interface ProgramDto {
  id: string;
  name: string;
  code: string;
  degree: string;
  departmentId: string;
  department: { id: string; name: string; code: string };
  outcomeCount: number;
  courseCount: number;
  createdAt: Date;
  updatedAt: Date;
}

function toDto(row: ProgramRow): ProgramDto {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    degree: row.degree,
    departmentId: row.departmentId,
    department: row.department,
    outcomeCount: row._count.outcomes,
    courseCount: row._count.courses,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export interface ListProgramsOptions {
  page: number;
  limit: number;
  skip: number;
  search?: string;
  departmentId?: string;
  sortField: string;
  sortOrder: 'asc' | 'desc';
}

const SORTABLE = ['name', 'code', 'degree', 'createdAt', 'updatedAt'];

export const programsService = {
  async list(opts: ListProgramsOptions): Promise<{ data: ProgramDto[]; meta: ApiMeta }> {
    const where: Prisma.ProgramWhereInput = {};
    if (opts.departmentId) where.departmentId = opts.departmentId;
    if (opts.search) {
      where.OR = [
        { name: { contains: opts.search, mode: 'insensitive' } },
        { code: { contains: opts.search, mode: 'insensitive' } },
      ];
    }

    const sortField = SORTABLE.includes(opts.sortField) ? opts.sortField : 'name';

    const [rows, total] = await Promise.all([
      prisma.program.findMany({
        where,
        include: PROGRAM_INCLUDE,
        orderBy: { [sortField]: opts.sortOrder },
        skip: opts.skip,
        take: opts.limit,
      }),
      prisma.program.count({ where }),
    ]);

    return { data: rows.map(toDto), meta: buildMeta(total, opts.page, opts.limit) };
  },

  async findById(id: string): Promise<ProgramDto> {
    const row = await prisma.program.findUnique({ where: { id }, include: PROGRAM_INCLUDE });
    if (!row) throw new NotFoundError('Program');
    return toDto(row);
  },

  async create(data: {
    name: string;
    code: string;
    degree?: string;
    departmentId: string;
  }): Promise<ProgramDto> {
    const department = await prisma.department.findUnique({ where: { id: data.departmentId } });
    if (!department) throw new NotFoundError('Department');

    const code = data.code.trim().toUpperCase();
    const clash = await prisma.program.findUnique({ where: { code } });
    if (clash) throw new ConflictError(`Program code ${code} is already in use`);

    const row = await prisma.program.create({
      data: {
        name: data.name.trim(),
        code,
        degree: data.degree?.trim() || 'BSc',
        departmentId: data.departmentId,
      },
      include: PROGRAM_INCLUDE,
    });
    return toDto(row);
  },

  async update(
    id: string,
    data: Partial<{ name: string; code: string; degree: string; departmentId: string }>,
  ): Promise<ProgramDto> {
    const existing = await prisma.program.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError('Program');

    const patch: Prisma.ProgramUpdateInput = {};
    if (data.name !== undefined) patch.name = data.name.trim();
    if (data.degree !== undefined) patch.degree = data.degree.trim();
    if (data.code !== undefined) {
      const code = data.code.trim().toUpperCase();
      if (code !== existing.code) {
        const clash = await prisma.program.findUnique({ where: { code } });
        if (clash) throw new ConflictError(`Program code ${code} is already in use`);
      }
      patch.code = code;
    }
    if (data.departmentId !== undefined) {
      const department = await prisma.department.findUnique({ where: { id: data.departmentId } });
      if (!department) throw new NotFoundError('Department');
      patch.department = { connect: { id: data.departmentId } };
    }

    const row = await prisma.program.update({ where: { id }, data: patch, include: PROGRAM_INCLUDE });
    return toDto(row);
  },

  async delete(id: string): Promise<void> {
    const existing = await prisma.program.findUnique({
      where: { id },
      include: { _count: { select: { courses: true } } },
    });
    if (!existing) throw new NotFoundError('Program');

    if (existing._count.courses > 0) {
      throw new UnprocessableError(
        `${existing.code} still has ${existing._count.courses} course(s). Delete or move them first.`,
        'PROGRAM_NOT_EMPTY',
      );
    }

    await prisma.program.delete({ where: { id } });
  },
};
