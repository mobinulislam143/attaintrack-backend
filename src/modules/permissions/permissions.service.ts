import { prisma } from '../../database/client';
import { ConflictError, NotFoundError } from '../../common/errors';

// ─────────────────────────────────────────────────────────────────────────────
// Permissions service — manage fine-grained permission records.
// Permission names follow a `resource:action` convention: e.g. `users:read`.
// ─────────────────────────────────────────────────────────────────────────────

export interface PermissionDto {
  id: string;
  name: string;
  description: string;
  createdAt: Date;
  updatedAt: Date;
}

const PERMISSION_SELECT = {
  id: true,
  name: true,
  description: true,
  createdAt: true,
  updatedAt: true,
} as const;

export const permissionsService = {
  async list(): Promise<PermissionDto[]> {
    return prisma.permission.findMany({
      select: PERMISSION_SELECT,
      orderBy: { name: 'asc' },
    });
  },

  async findById(id: string): Promise<PermissionDto> {
    const row = await prisma.permission.findUnique({ where: { id }, select: PERMISSION_SELECT });
    if (!row) throw new NotFoundError('Permission');
    return row;
  },

  async create(data: { name: string; description?: string }): Promise<PermissionDto> {
    const name = data.name.toLowerCase();
    const existing = await prisma.permission.findUnique({ where: { name } });
    if (existing) throw new ConflictError(`Permission '${name}' already exists`);

    return prisma.permission.create({
      data: { name, description: data.description ?? '' },
      select: PERMISSION_SELECT,
    });
  },

  async update(id: string, data: { name?: string; description?: string }): Promise<PermissionDto> {
    const existing = await prisma.permission.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError('Permission');

    if (data.name) {
      const nameConflict = await prisma.permission.findFirst({
        where: { name: data.name.toLowerCase(), NOT: { id } },
      });
      if (nameConflict) throw new ConflictError(`Permission '${data.name}' already exists`);
    }

    return prisma.permission.update({
      where: { id },
      data: {
        ...(data.name && { name: data.name.toLowerCase() }),
        ...(data.description !== undefined && { description: data.description }),
      },
      select: PERMISSION_SELECT,
    });
  },

  async delete(id: string): Promise<void> {
    const existing = await prisma.permission.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError('Permission');
    await prisma.permission.delete({ where: { id } });
  },
};
