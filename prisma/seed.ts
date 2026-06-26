import 'dotenv/config';
import { PrismaClient } from '../src/generated/prisma';
import { hashPassword } from '../src/common/crypto';

// ─────────────────────────────────────────────────────────────────────────────
// Database seed script.
// Run: npm run prisma:seed
//
// Seeds:
//   - Core permissions  (users:*, roles:*, permissions:*)
//   - Core roles        (admin, user)
//   - Admin user        (admin@example.com / Admin@1234)
// ─────────────────────────────────────────────────────────────────────────────

const prisma = new PrismaClient();

const PERMISSIONS = [
  // Users
  { name: 'users:read',   description: 'Read any user' },
  { name: 'users:create', description: 'Create users' },
  { name: 'users:update', description: 'Update any user' },
  { name: 'users:delete', description: 'Delete any user' },
  // Roles
  { name: 'roles:read',   description: 'Read roles' },
  { name: 'roles:create', description: 'Create roles' },
  { name: 'roles:update', description: 'Update roles' },
  { name: 'roles:delete', description: 'Delete roles' },
  // Permissions
  { name: 'permissions:read',   description: 'Read permissions' },
  { name: 'permissions:create', description: 'Create permissions' },
  { name: 'permissions:update', description: 'Update permissions' },
  { name: 'permissions:delete', description: 'Delete permissions' },
];

const ROLES = [
  {
    name: 'admin',
    description: 'Full access to all resources',
    permissions: PERMISSIONS.map((p) => p.name),
  },
  {
    name: 'user',
    description: 'Standard authenticated user with read-only access',
    permissions: ['users:read', 'roles:read', 'permissions:read'],
  },
];

async function main(): Promise<void> {
  console.log('Seeding database...\n');

  // ── Permissions ────────────────────────────────────────────────────────────
  console.log('  Upserting permissions...');
  const permMap = new Map<string, string>();

  for (const perm of PERMISSIONS) {
    const record = await prisma.permission.upsert({
      where: { name: perm.name },
      update: { description: perm.description },
      create: perm,
    });
    permMap.set(perm.name, record.id);
    console.log(`    ✓ ${perm.name}`);
  }

  // ── Roles ──────────────────────────────────────────────────────────────────
  console.log('\n  Upserting roles...');
  const roleMap = new Map<string, string>();

  for (const role of ROLES) {
    const record = await prisma.role.upsert({
      where: { name: role.name },
      update: { description: role.description },
      create: { name: role.name, description: role.description },
    });
    roleMap.set(role.name, record.id);

    // Assign permissions to role
    for (const permName of role.permissions) {
      const permId = permMap.get(permName);
      if (!permId) continue;
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: record.id, permissionId: permId } },
        create: { roleId: record.id, permissionId: permId },
        update: {},
      });
    }
    console.log(`    ✓ ${role.name} (${role.permissions.length} permissions)`);
  }

  // ── Admin user ─────────────────────────────────────────────────────────────
  console.log('\n  Creating admin user...');
  const adminEmail = process.env['ADMIN_EMAIL'] ?? 'admin@example.com';
  const adminPassword = process.env['ADMIN_PASSWORD'] ?? 'Admin@1234';

  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      email: adminEmail,
      password: await hashPassword(adminPassword),
      firstName: 'Admin',
      lastName: 'User',
      isEmailVerified: true,
      isActive: true,
    },
  });

  const adminRoleId = roleMap.get('admin');
  if (adminRoleId) {
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: admin.id, roleId: adminRoleId } },
      create: { userId: admin.id, roleId: adminRoleId },
      update: {},
    });
  }

  console.log(`    ✓ ${adminEmail}`);
  console.log('\nSeed complete!\n');
  console.log(`Admin credentials:`);
  console.log(`  Email:    ${adminEmail}`);
  console.log(`  Password: ${adminPassword}`);
  console.log(`\nChange the admin password after first login.\n`);
}

main()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
