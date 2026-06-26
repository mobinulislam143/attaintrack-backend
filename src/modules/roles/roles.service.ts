import { prisma } from '../../database/client';
import { ConflictError, NotFoundError } from '../../common/errors';

// ─────────────────────────────────────────────────────────────────────────────
// Roles service — manage roles and their permission assignments.
// ─────────────────────────────────────────────────────────────────────────────

const ROLE_SELECT = {
  id: true,
  name: true,
  description: true,
  createdAt: true,
  updatedAt: true,
  rolePermissions: {
    select: {
      permission: { select: { id: true, name: true, description: true } },
    },
  },
} as const;

export type RoleDto = {
  id: string;
  name: string;
  description: string;
  permissions: Array<{ id: string; name: string; description: string }>;
  createdAt: Date;
  updatedAt: Date;
};

function toDto(row: {
  id: string;
  name: string;
  description: string;
  createdAt: Date;
  updatedAt: Date;
  rolePermissions: Array<{ permission: { id: string; name: string; description: string } }>;
}): RoleDto {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    permissions: row.rolePermissions.map((rp) => rp.permission),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export const rolesService = {
  async list(): Promise<RoleDto[]> {
    const rows = await prisma.role.findMany({
      select: ROLE_SELECT,
      orderBy: { name: 'asc' },
    });
    return rows.map(toDto);
  },

  async findById(id: string): Promise<RoleDto> {
    const row = await prisma.role.findUnique({ where: { id }, select: ROLE_SELECT });
    if (!row) throw new NotFoundError('Role');
    return toDto(row);
  },

  async create(data: { name: string; description?: string }): Promise<RoleDto> {
    const existing = await prisma.role.findUnique({ where: { name: data.name.toLowerCase() } });
    if (existing) throw new ConflictError(`Role '${data.name}' already exists`);

    const row = await prisma.role.create({
      data: { name: data.name.toLowerCase(), description: data.description ?? '' },
      select: ROLE_SELECT,
    });
    return toDto(row);
  },

  async update(id: string, data: { name?: string; description?: string }): Promise<RoleDto> {
    const existing = await prisma.role.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError('Role');

    if (data.name) {
      const nameConflict = await prisma.role.findFirst({
        where: { name: data.name.toLowerCase(), NOT: { id } },
      });
      if (nameConflict) throw new ConflictError(`Role '${data.name}' already exists`);
    }

    const row = await prisma.role.update({
      where: { id },
      data: {
        ...(data.name && { name: data.name.toLowerCase() }),
        ...(data.description !== undefined && { description: data.description }),
      },
      select: ROLE_SELECT,
    });
    return toDto(row);
  },

  async delete(id: string): Promise<void> {
    const existing = await prisma.role.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError('Role');
    await prisma.role.delete({ where: { id } });
  },

  /** Assign a permission to a role. Idempotent. */
  async assignPermission(roleId: string, permissionId: string): Promise<void> {
    const [role, permission] = await Promise.all([
      prisma.role.findUnique({ where: { id: roleId } }),
      prisma.permission.findUnique({ where: { id: permissionId } }),
    ]);
    if (!role) throw new NotFoundError('Role');
    if (!permission) throw new NotFoundError('Permission');

    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId, permissionId } },
      create: { roleId, permissionId },
      update: {},
    });
  },

  /** Remove a permission from a role. */
  async removePermission(roleId: string, permissionId: string): Promise<void> {
    const rp = await prisma.rolePermission.findUnique({
      where: { roleId_permissionId: { roleId, permissionId } },
    });
    if (!rp) throw new NotFoundError('Role-Permission assignment');
    await prisma.rolePermission.delete({ where: { id: rp.id } });
  },
};
