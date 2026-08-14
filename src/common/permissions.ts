// ─────────────────────────────────────────────────────────────────────────────
// The permission catalogue.
//
// This file is the single authority. `prisma/seed.ts` writes exactly these
// rows, every route guards on a member of `PERMISSIONS`, and
// obe-frontend/src/lib/permissions.ts mirrors the same strings so a hidden
// button and a 403 always agree.
//
// Naming: `<resource>:<action>`. `write` covers create, update and delete —
// splitting them produced four rows nobody ever assigned separately.
// ─────────────────────────────────────────────────────────────────────────────

export const PERMISSIONS = {
  // ── Academic structure (admin) ──────────────────────────────────────────
  departmentsRead: 'departments:read',
  departmentsWrite: 'departments:write',
  programsRead: 'programs:read',
  programsWrite: 'programs:write',
  programOutcomesRead: 'program-outcomes:read',
  programOutcomesWrite: 'program-outcomes:write',
  sessionsRead: 'sessions:read',
  sessionsWrite: 'sessions:write',

  // ── Courses ─────────────────────────────────────────────────────────────
  coursesRead: 'courses:read',
  coursesWrite: 'courses:write',
  coursesAssign: 'courses:assign',

  // ── Teacher workflow ────────────────────────────────────────────────────
  courseOutcomesWrite: 'course-outcomes:write',
  copoMappingWrite: 'copo-mapping:write',
  assessmentsWrite: 'assessments:write',
  marksRead: 'marks:read',
  marksWrite: 'marks:write',
  attainmentRead: 'attainment:read',
  attainmentCalculate: 'attainment:calculate',
  reportsGenerate: 'reports:generate',
  reportsExport: 'reports:export',

  // ── Students ────────────────────────────────────────────────────────────
  studentsRead: 'students:read',
  studentsWrite: 'students:write',

  // ── Identity (admin) ────────────────────────────────────────────────────
  usersRead: 'users:read',
  usersWrite: 'users:write',
  rolesRead: 'roles:read',
  rolesWrite: 'roles:write',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

/** Descriptions shown in the admin's permissions table. */
export const PERMISSION_DESCRIPTIONS: Record<Permission, string> = {
  'departments:read': 'View departments',
  'departments:write': 'Create, edit and delete departments',
  'programs:read': 'View programs',
  'programs:write': 'Create, edit and delete programs',
  'program-outcomes:read': 'View Program Outcomes',
  'program-outcomes:write': 'Author and edit Program Outcomes',
  'sessions:read': 'View academic sessions',
  'sessions:write': 'Create and edit academic sessions',
  'courses:read': 'View courses',
  'courses:write': 'Create, edit and delete courses',
  'courses:assign': 'Assign a teacher to a course',
  'course-outcomes:write': 'Author and edit Course Outcomes',
  'copo-mapping:write': 'Edit the CO-PO mapping matrix',
  'assessments:write': 'Create assessments and map questions to Course Outcomes',
  'marks:read': 'View the marks grid',
  'marks:write': 'Enter and import marks',
  'attainment:read': 'View attainment results',
  'attainment:calculate': 'Run the attainment calculation',
  'reports:generate': 'Generate accreditation reports',
  'reports:export': 'Export reports as PDF or Excel',
  'students:read': 'View students',
  'students:write': 'Create, edit and enroll students',
  'users:read': 'View user accounts',
  'users:write': 'Create, edit and deactivate user accounts',
  'roles:read': 'View roles',
  'roles:write': 'Create roles and change role permissions',
};

// ─────────────────────────────────────────────────────────────────────────────
// Role → permission assignments.
//
// A teacher owns the whole value chain for their own courses but authors no
// academic structure; a student reads only their own records and therefore
// holds no permissions at all — every student route is scoped by identity, not
// by permission.
// ─────────────────────────────────────────────────────────────────────────────

const P = PERMISSIONS;

export const ROLE_PERMISSIONS: Record<string, Permission[]> = {
  admin: Object.values(P),

  teacher: [
    P.departmentsRead,
    P.programsRead,
    P.programOutcomesRead,
    P.sessionsRead,
    P.coursesRead,
    P.courseOutcomesWrite,
    P.copoMappingWrite,
    P.assessmentsWrite,
    P.marksRead,
    P.marksWrite,
    P.attainmentRead,
    P.attainmentCalculate,
    P.reportsGenerate,
    P.reportsExport,
    P.studentsRead,
    P.studentsWrite,
  ],

  // `courses:read` is the student's only permission, and it is safe because
  // every course query runs through `courseScope`, which narrows a student to
  // the courses they are enrolled in. Their marks and CO performance come from
  // identity-scoped routes (`/attainment/me`, `/dashboard/student`) that carry
  // no permission gate at all — there is no permission that would let a student
  // see class-wide numbers, because no such route accepts them.
  student: [P.coursesRead],
};

export const ROLE_DESCRIPTIONS: Record<string, string> = {
  admin: 'Departments, programs, courses, users and Program Outcomes',
  teacher: 'The full outcome workflow for their own courses',
  student: 'Their own courses, published marks and CO-level performance',
};
