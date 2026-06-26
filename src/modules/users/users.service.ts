import { Prisma } from '../../generated/prisma';
import { prisma } from '../../database/client';
import { hashPassword } from '../../common/crypto';
import { buildMeta } from '../../common/pagination';
import { ApiMeta } from '../../common/response';
import { ConflictError, NotFoundError } from '../../common/errors';

// ─────────────────────────────────────────────────────────────────────────────
// Users service — CRUD, search, filter, sort, pagination.
// ─────────────────────────────────────────────────────────────────────────────

const USER_SELECT = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  avatar: true,
  isEmailVerified: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  userRoles: {
    select: {
      role: { select: { id: true, name: true } },
    },
  },
} satisfies Prisma.UserSelect;

type UserRow = Prisma.UserGetPayload<{ select: typeof USER_SELECT }>;

export interface UserDto {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  avatar: string | null;
  isEmailVerified: boolean;
  isActive: boolean;
  roles: Array<{ id: string; name: string }>;
  createdAt: Date;
  updatedAt: Date;
}

function toDto(row: UserRow): UserDto {
  return {
    id: row.id,
    email: row.email,
    firstName: row.firstName,
    lastName: row.lastName,
    avatar: row.avatar,
    isEmailVerified: row.isEmailVerified,
    isActive: row.isActive,
    roles: row.userRoles.map((ur) => ur.role),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export interface ListUsersOptions {
  page: number;
  limit: number;
  skip: number;
  search?: string;
  isActive?: boolean;
  sortField: string;
  sortOrder: 'asc' | 'desc';
}

export const usersService = {
  /** List users with pagination, search, filter, and sort. */
  async list(opts: ListUsersOptions): Promise<{ data: UserDto[]; meta: ApiMeta }> {
    const where: Prisma.UserWhereInput = {};

    if (opts.search) {
      where.OR = [
        { email: { contains: opts.search, mode: 'insensitive' } },
        { firstName: { contains: opts.search, mode: 'insensitive' } },
        { lastName: { contains: opts.search, mode: 'insensitive' } },
      ];
    }

    if (opts.isActive !== undefined) where.isActive = opts.isActive;

    const allowedSortFields = ['createdAt', 'updatedAt', 'email', 'firstName', 'lastName'];
    const sortField = allowedSortFields.includes(opts.sortField) ? opts.sortField : 'createdAt';

    const [rows, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: USER_SELECT,
        orderBy: { [sortField]: opts.sortOrder },
        skip: opts.skip,
        take: opts.limit,
      }),
      prisma.user.count({ where }),
    ]);

    return {
      data: rows.map(toDto),
      meta: buildMeta(total, opts.page, opts.limit),
    };
  },

  /** Get a single user by ID. */
  async findById(id: string): Promise<UserDto> {
    const row = await prisma.user.findUnique({ where: { id }, select: USER_SELECT });
    if (!row) throw new NotFoundError('User');
    return toDto(row);
  },

  /** Admin: create a user (bypasses email verification flow). */
  async create(data: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    isActive?: boolean;
  }): Promise<UserDto> {
    const existing = await prisma.user.findUnique({ where: { email: data.email.toLowerCase() } });
    if (existing) throw new ConflictError('A user with this email already exists');

    const row = await prisma.user.create({
      data: {
        email: data.email.toLowerCase(),
        password: await hashPassword(data.password),
        firstName: data.firstName,
        lastName: data.lastName,
        isEmailVerified: true, // admin-created accounts are pre-verified
        isActive: data.isActive ?? true,
      },
      select: USER_SELECT,
    });
    return toDto(row);
  },

  /** Update a user's profile fields. */
  async update(
    id: string,
    data: Partial<{ firstName: string; lastName: string; avatar: string; isActive: boolean }>,
  ): Promise<UserDto> {
    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError('User');

    const row = await prisma.user.update({ where: { id }, data, select: USER_SELECT });
    return toDto(row);
  },

  /** Hard-delete a user and all associated data (cascade via Prisma schema). */
  async delete(id: string): Promise<void> {
    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError('User');
    await prisma.user.delete({ where: { id } });
  },

  /** Assign a role to a user. Idempotent. */
  async assignRole(userId: string, roleId: string): Promise<void> {
    const [user, role] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId } }),
      prisma.role.findUnique({ where: { id: roleId } }),
    ]);
    if (!user) throw new NotFoundError('User');
    if (!role) throw new NotFoundError('Role');

    await prisma.userRole.upsert({
      where: { userId_roleId: { userId, roleId } },
      create: { userId, roleId },
      update: {},
    });
  },

  /** Remove a role from a user. */
  async removeRole(userId: string, roleId: string): Promise<void> {
    const userRole = await prisma.userRole.findUnique({
      where: { userId_roleId: { userId, roleId } },
    });
    if (!userRole) throw new NotFoundError('User-Role assignment');
    await prisma.userRole.delete({ where: { id: userRole.id } });
  },

  /** Update own profile (firstName, lastName, avatar). */
  async updateProfile(
    userId: string,
    data: Partial<{ firstName: string; lastName: string; avatar: string }>,
  ): Promise<UserDto> {
    const row = await prisma.user.update({ where: { id: userId }, data, select: USER_SELECT });
    return toDto(row);
  },
};
