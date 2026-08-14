import 'dotenv/config';
import { PrismaClient } from '../src/generated/prisma';
import { hashPassword } from '../src/common/crypto';
import {
  PERMISSIONS,
  PERMISSION_DESCRIPTIONS,
  ROLE_PERMISSIONS,
  ROLE_DESCRIPTIONS,
  Permission,
} from '../src/common/permissions';

// ═════════════════════════════════════════════════════════════════════════════
// Database seed.
//   npm run prisma:seed
//
// Two halves:
//
//   1. IDENTITY — permissions, roles and the three sign-in accounts. Always
//      applied, always idempotent. This half is what a real deployment needs.
//
//   2. DEMONSTRATION — a Computer Science department carried all the way down
//      the value chain: a program with 12 Program Outcomes, an active session,
//      four courses at four different stages of the workflow, 48 students, and
//      marks generated from a fixed seed so the attainment numbers are the same
//      on every machine. Skip it with SEED_DEMO=false.
//
// The demo marks are shaped deliberately: CO2 and CO5 land below target so the
// gap analysis screen has something real to say. Nothing is hard-coded — the
// percentages come out of the same engine the product uses.
// ═════════════════════════════════════════════════════════════════════════════

const prisma = new PrismaClient();

const SEED_DEMO = process.env['SEED_DEMO'] !== 'false';

const ADMIN_EMAIL = process.env['ADMIN_EMAIL'] ?? 'admin@obe.edu';
const ADMIN_PASSWORD = process.env['ADMIN_PASSWORD'] ?? 'Admin@1234';
const TEACHER_EMAIL = process.env['TEACHER_EMAIL'] ?? 'teacher@obe.edu';
const TEACHER_PASSWORD = process.env['TEACHER_PASSWORD'] ?? 'Teacher@1234';
const STUDENT_EMAIL = process.env['STUDENT_EMAIL'] ?? 'student@obe.edu';
const STUDENT_PASSWORD = process.env['STUDENT_PASSWORD'] ?? 'Student@1234';

// ─────────────────────────────────────────────────────────────────────────────
// A tiny deterministic PRNG (mulberry32). Math.random would make every seed run
// produce different attainment, which makes the demo impossible to talk about.
// ─────────────────────────────────────────────────────────────────────────────
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const random = mulberry32(20260814);

/** Normally distributed value, clamped to [0, 1]. Marks cluster; they are not uniform. */
function bell(mean: number, spread: number): number {
  const u = 1 - random();
  const v = random();
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return Math.max(0, Math.min(1, mean + z * spread));
}

function log(message: string): void {
  console.log(message);
}

// ═════════════════════════════════════════════════════════════════════════════
// 1 — Identity
// ═════════════════════════════════════════════════════════════════════════════

async function seedIdentity(): Promise<{
  adminId: string;
  teacherId: string;
  studentUserId: string;
}> {
  log('\n── Permissions ──────────────────────────────────────────────');

  const permissionIds = new Map<string, string>();
  for (const name of Object.values(PERMISSIONS)) {
    const record = await prisma.permission.upsert({
      where: { name },
      update: { description: PERMISSION_DESCRIPTIONS[name] },
      create: { name, description: PERMISSION_DESCRIPTIONS[name] },
    });
    permissionIds.set(name, record.id);
  }
  log(`   ${permissionIds.size} permissions`);

  log('\n── Roles ────────────────────────────────────────────────────');

  const roleIds = new Map<string, string>();
  for (const [roleName, permissions] of Object.entries(ROLE_PERMISSIONS)) {
    const role = await prisma.role.upsert({
      where: { name: roleName },
      update: { description: ROLE_DESCRIPTIONS[roleName] ?? '' },
      create: { name: roleName, description: ROLE_DESCRIPTIONS[roleName] ?? '' },
    });
    roleIds.set(roleName, role.id);

    // Reconcile rather than append: a permission removed from the catalogue
    // must actually disappear from the role.
    const desired = new Set(permissions as Permission[]);
    const current = await prisma.rolePermission.findMany({
      where: { roleId: role.id },
      include: { permission: { select: { name: true } } },
    });

    for (const link of current) {
      if (!desired.has(link.permission.name as Permission)) {
        await prisma.rolePermission.delete({ where: { id: link.id } });
      }
    }

    for (const name of desired) {
      const permissionId = permissionIds.get(name);
      if (!permissionId) continue;
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId } },
        create: { roleId: role.id, permissionId },
        update: {},
      });
    }

    log(`   ${roleName.padEnd(8)} ${desired.size} permissions`);
  }

  log('\n── Accounts ─────────────────────────────────────────────────');

  async function upsertUser(
    email: string,
    password: string,
    firstName: string,
    lastName: string,
    roleName: string,
  ): Promise<string> {
    const user = await prisma.user.upsert({
      where: { email: email.toLowerCase() },
      update: { firstName, lastName, isActive: true, isEmailVerified: true },
      create: {
        email: email.toLowerCase(),
        password: await hashPassword(password),
        firstName,
        lastName,
        isEmailVerified: true,
        isActive: true,
      },
    });

    const roleId = roleIds.get(roleName);
    if (roleId) {
      await prisma.userRole.upsert({
        where: { userId_roleId: { userId: user.id, roleId } },
        create: { userId: user.id, roleId },
        update: {},
      });
    }

    log(`   ${roleName.padEnd(8)} ${email}`);
    return user.id;
  }

  const adminId = await upsertUser(ADMIN_EMAIL, ADMIN_PASSWORD, 'System', 'Administrator', 'admin');
  const teacherId = await upsertUser(TEACHER_EMAIL, TEACHER_PASSWORD, 'Mobinul', 'Islam', 'teacher');
  const studentUserId = await upsertUser(STUDENT_EMAIL, STUDENT_PASSWORD, 'Ayesha', 'Rahman', 'student');

  return { adminId, teacherId, studentUserId };
}

// ═════════════════════════════════════════════════════════════════════════════
// 2 — Demonstration data
// ═════════════════════════════════════════════════════════════════════════════

const PROGRAM_OUTCOMES = [
  ['PO1', 'Engineering knowledge', 'Apply knowledge of mathematics, science and engineering fundamentals to the solution of complex engineering problems.'],
  ['PO2', 'Problem analysis', 'Identify, formulate, review research literature and analyse complex engineering problems reaching substantiated conclusions.'],
  ['PO3', 'Design and development', 'Design solutions for complex engineering problems and design system components that meet specified needs.'],
  ['PO4', 'Investigation', 'Use research-based knowledge and research methods including design of experiments and analysis of data.'],
  ['PO5', 'Modern tool usage', 'Create, select and apply appropriate techniques, resources and modern engineering and IT tools.'],
  ['PO6', 'The engineer and society', 'Apply reasoning informed by contextual knowledge to assess societal, health, safety and legal issues.'],
  ['PO7', 'Environment and sustainability', 'Understand the impact of professional engineering solutions in societal and environmental contexts.'],
  ['PO8', 'Ethics', 'Apply ethical principles and commit to professional ethics and responsibilities and norms of engineering practice.'],
  ['PO9', 'Individual and team work', 'Function effectively as an individual, and as a member or leader in diverse teams.'],
  ['PO10', 'Communication', 'Communicate effectively on complex engineering activities with the engineering community and with society at large.'],
  ['PO11', 'Project management', 'Demonstrate knowledge and understanding of engineering and management principles in multidisciplinary environments.'],
  ['PO12', 'Life-long learning', 'Recognise the need for, and have the preparation and ability to engage in independent and life-long learning.'],
] as const;

const FIRST_NAMES = [
  'Ayesha', 'Rakib', 'Nusrat', 'Tanvir', 'Sadia', 'Imran', 'Farhana', 'Shakib',
  'Mehjabin', 'Arif', 'Tasnim', 'Rifat', 'Sumaiya', 'Nayeem', 'Jannat', 'Fahim',
  'Anika', 'Sabbir', 'Maliha', 'Rayhan', 'Tahmina', 'Zubair', 'Nafisa', 'Ashiq',
];

const LAST_NAMES = [
  'Rahman', 'Hossain', 'Akter', 'Islam', 'Chowdhury', 'Ahmed', 'Karim', 'Sultana',
  'Mahmud', 'Begum', 'Uddin', 'Haque',
];

interface CourseOutcomeSpec {
  code: string;
  statement: string;
  /** Mean share of marks the class scores on this CO — shapes the demo story. */
  difficulty: number;
  /** Which POs this CO maps to, with strength. */
  mapping: Array<[string, number]>;
}

const DBMS_OUTCOMES: CourseOutcomeSpec[] = [
  {
    code: 'CO1',
    statement: 'Explain the relational model, keys and integrity constraints of a database system.',
    difficulty: 0.8,
    mapping: [['PO1', 3], ['PO2', 2], ['PO12', 1]],
  },
  {
    code: 'CO2',
    statement: 'Apply normalisation up to BCNF to remove redundancy from a relational schema.',
    difficulty: 0.62, // the deliberate gap the demo is built around
    mapping: [['PO2', 3], ['PO3', 2], ['PO4', 1]],
  },
  {
    code: 'CO3',
    statement: 'Write SQL queries involving joins, aggregation, sub-queries and views.',
    difficulty: 0.82,
    mapping: [['PO3', 3], ['PO5', 3], ['PO1', 1]],
  },
  {
    code: 'CO4',
    statement: 'Analyse transaction concurrency, isolation levels and recovery mechanisms.',
    difficulty: 0.77,
    mapping: [['PO4', 3], ['PO2', 2], ['PO11', 1]],
  },
  {
    code: 'CO5',
    statement: 'Design and present a normalised database for a real-world case study as a team.',
    difficulty: 0.68, // a second, milder gap on the teamwork and communication POs
    mapping: [['PO9', 3], ['PO10', 3], ['PO6', 2], ['PO7', 1], ['PO8', 2]],
  },
];

interface AssessmentSpec {
  name: string;
  type: string;
  weight: number;
  conductedOn: string;
  isPublished: boolean;
  questions: Array<{ code: string; maxMarks: number; co: string }>;
}

const DBMS_ASSESSMENTS: AssessmentSpec[] = [
  {
    name: 'Quiz 1',
    type: 'quiz',
    weight: 10,
    conductedOn: '2026-02-12',
    isPublished: true,
    questions: [
      { code: 'Q1', maxMarks: 5, co: 'CO1' },
      { code: 'Q2', maxMarks: 5, co: 'CO1' },
      { code: 'Q3', maxMarks: 10, co: 'CO2' },
    ],
  },
  {
    name: 'Midterm Examination',
    type: 'midterm',
    weight: 30,
    conductedOn: '2026-03-09',
    isPublished: true,
    questions: [
      { code: 'Q1', maxMarks: 10, co: 'CO1' },
      { code: 'Q2', maxMarks: 10, co: 'CO2' },
      { code: 'Q3', maxMarks: 15, co: 'CO3' },
      { code: 'Q4', maxMarks: 15, co: 'CO4' },
    ],
  },
  {
    name: 'Course Project',
    type: 'project',
    weight: 20,
    conductedOn: '2026-04-20',
    isPublished: true,
    questions: [
      { code: 'P1', maxMarks: 15, co: 'CO5' },
      { code: 'P2', maxMarks: 10, co: 'CO5' },
      { code: 'P3', maxMarks: 5, co: 'CO3' },
    ],
  },
  {
    name: 'Final Examination',
    type: 'final',
    weight: 40,
    conductedOn: '2026-05-25',
    isPublished: true,
    questions: [
      { code: 'Q1', maxMarks: 12, co: 'CO1' },
      { code: 'Q2', maxMarks: 16, co: 'CO2' },
      { code: 'Q3', maxMarks: 16, co: 'CO3' },
      { code: 'Q4', maxMarks: 16, co: 'CO4' },
      { code: 'Q5', maxMarks: 10, co: 'CO5' },
    ],
  },
];

async function seedDemo(ids: { adminId: string; teacherId: string; studentUserId: string }): Promise<void> {
  log('\n── Academic structure ───────────────────────────────────────');

  const department = await prisma.department.upsert({
    where: { code: 'CSE' },
    update: { name: 'Computer Science and Engineering' },
    create: { code: 'CSE', name: 'Computer Science and Engineering' },
  });

  const eee = await prisma.department.upsert({
    where: { code: 'EEE' },
    update: { name: 'Electrical and Electronic Engineering' },
    create: { code: 'EEE', name: 'Electrical and Electronic Engineering' },
  });

  const program = await prisma.program.upsert({
    where: { code: 'BSCSE' },
    update: { name: 'BSc in Computer Science and Engineering', departmentId: department.id },
    create: {
      code: 'BSCSE',
      name: 'BSc in Computer Science and Engineering',
      degree: 'BSc',
      departmentId: department.id,
    },
  });

  await prisma.program.upsert({
    where: { code: 'BSEEE' },
    update: { name: 'BSc in Electrical and Electronic Engineering', departmentId: eee.id },
    create: {
      code: 'BSEEE',
      name: 'BSc in Electrical and Electronic Engineering',
      degree: 'BSc',
      departmentId: eee.id,
    },
  });

  log(`   2 departments · 2 programs`);

  const poIds = new Map<string, string>();
  for (const [index, [code, title, description]] of PROGRAM_OUTCOMES.entries()) {
    const po = await prisma.programOutcome.upsert({
      where: { programId_code: { programId: program.id, code } },
      update: { title, description, order: index, target: 70 },
      create: { programId: program.id, code, title, description, order: index, target: 70 },
    });
    poIds.set(code, po.id);
  }
  log(`   ${poIds.size} Program Outcomes on ${program.code}`);

  const session = await prisma.academicSession.upsert({
    where: { name: 'Spring 2026' },
    update: { startDate: new Date('2026-01-15'), endDate: new Date('2026-06-15') },
    create: {
      name: 'Spring 2026',
      startDate: new Date('2026-01-15'),
      endDate: new Date('2026-06-15'),
      isActive: false,
    },
  });

  await prisma.academicSession.upsert({
    where: { name: 'Fall 2025' },
    update: {},
    create: {
      name: 'Fall 2025',
      startDate: new Date('2025-07-01'),
      endDate: new Date('2025-12-20'),
      isActive: false,
    },
  });

  await prisma.academicSession.updateMany({ where: {}, data: { isActive: false } });
  await prisma.academicSession.update({ where: { id: session.id }, data: { isActive: true } });
  log(`   2 sessions · ${session.name} active`);

  // ── Students ──────────────────────────────────────────────────────────────
  log('\n── Roster ───────────────────────────────────────────────────');

  const students: Array<{ id: string; studentId: string; name: string }> = [];

  for (let i = 0; i < 48; i += 1) {
    const registration = `2023${String(1001 + i)}`;
    const name =
      i === 0
        ? 'Ayesha Rahman'
        : `${FIRST_NAMES[i % FIRST_NAMES.length]} ${LAST_NAMES[(i * 7) % LAST_NAMES.length]}`;

    const record = await prisma.student.upsert({
      where: { studentId: registration },
      update: { name, programId: program.id },
      create: {
        studentId: registration,
        name,
        email: `${registration}@student.obe.edu`,
        programId: program.id,
        // The demo student login is the first person on the roll.
        userId: i === 0 ? ids.studentUserId : null,
      },
    });
    students.push({ id: record.id, studentId: record.studentId, name: record.name });
  }

  // Re-link in case the student record already existed without an account.
  await prisma.student.update({
    where: { id: students[0]!.id },
    data: { userId: ids.studentUserId },
  });

  log(`   ${students.length} students · ${students[0]!.name} linked to ${STUDENT_EMAIL}`);

  // ── The flagship course ───────────────────────────────────────────────────
  log('\n── Courses ──────────────────────────────────────────────────');

  const dbms = await prisma.course.upsert({
    where: { code_section_sessionId: { code: 'CSE 321', section: 'A', sessionId: session.id } },
    update: {
      title: 'Database Management System',
      teacherId: ids.teacherId,
      attainmentThreshold: 60,
      attainmentTarget: 70,
    },
    create: {
      code: 'CSE 321',
      title: 'Database Management System',
      credit: 3,
      section: 'A',
      programId: program.id,
      sessionId: session.id,
      teacherId: ids.teacherId,
      attainmentThreshold: 60,
      attainmentTarget: 70,
      status: 'setup-incomplete',
    },
  });

  // Course Outcomes
  const coIds = new Map<string, string>();
  for (const [index, spec] of DBMS_OUTCOMES.entries()) {
    const co = await prisma.courseOutcome.upsert({
      where: { courseId_code: { courseId: dbms.id, code: spec.code } },
      update: { statement: spec.statement, order: index, target: 70 },
      create: {
        courseId: dbms.id,
        code: spec.code,
        statement: spec.statement,
        order: index,
        target: 70,
      },
    });
    coIds.set(spec.code, co.id);
  }

  // CO-PO mapping
  let mappingCount = 0;
  for (const spec of DBMS_OUTCOMES) {
    const courseOutcomeId = coIds.get(spec.code)!;
    for (const [poCode, strength] of spec.mapping) {
      const programOutcomeId = poIds.get(poCode);
      if (!programOutcomeId) continue;
      await prisma.cOPOMapping.upsert({
        where: { courseOutcomeId_programOutcomeId: { courseOutcomeId, programOutcomeId } },
        update: { strength },
        create: { courseOutcomeId, programOutcomeId, strength },
      });
      mappingCount += 1;
    }
  }

  // Every PO must be covered for the mapping to count complete; the five COs
  // above reach ten of twelve, so the remaining two are attached to the COs
  // they genuinely relate to rather than left as a red cell.
  for (const [poCode, coCode, strength] of [
    ['PO5', 'CO4', 2],
    ['PO11', 'CO5', 2],
    ['PO12', 'CO3', 1],
  ] as const) {
    const programOutcomeId = poIds.get(poCode);
    const courseOutcomeId = coIds.get(coCode);
    if (!programOutcomeId || !courseOutcomeId) continue;
    await prisma.cOPOMapping.upsert({
      where: { courseOutcomeId_programOutcomeId: { courseOutcomeId, programOutcomeId } },
      update: { strength },
      create: { courseOutcomeId, programOutcomeId, strength },
    });
    mappingCount += 1;
  }

  // Enrollment
  for (const student of students) {
    await prisma.enrollment.upsert({
      where: { courseId_studentId: { courseId: dbms.id, studentId: student.id } },
      create: { courseId: dbms.id, studentId: student.id },
      update: {},
    });
  }

  // Assessments, questions and marks
  const difficultyByCO = new Map(DBMS_OUTCOMES.map((co) => [co.code, co.difficulty]));

  // A per-student ability factor, so the same people tend to do well across
  // assessments — random marks per cell would produce an unrealistically tidy
  // bell curve on every single outcome.
  const ability = new Map(students.map((s) => [s.id, bell(0.5, 0.16) - 0.5]));

  let markCount = 0;

  for (const spec of DBMS_ASSESSMENTS) {
    // Assessments have no natural unique key, so match on course + name.
    const fields = {
      type: spec.type,
      weight: spec.weight,
      conductedOn: new Date(spec.conductedOn),
      isPublished: spec.isPublished,
    };

    const found = await prisma.assessment.findFirst({
      where: { courseId: dbms.id, name: spec.name },
      select: { id: true },
    });

    const assessment = found
      ? await prisma.assessment.update({ where: { id: found.id }, data: fields })
      : await prisma.assessment.create({
          data: { courseId: dbms.id, name: spec.name, totalMarks: 0, ...fields },
        });

    for (const [index, q] of spec.questions.entries()) {
      const question = await prisma.question.upsert({
        where: { assessmentId_code: { assessmentId: assessment.id, code: q.code } },
        update: { maxMarks: q.maxMarks, order: index, courseOutcomeId: coIds.get(q.co) ?? null },
        create: {
          assessmentId: assessment.id,
          code: q.code,
          maxMarks: q.maxMarks,
          order: index,
          courseOutcomeId: coIds.get(q.co) ?? null,
        },
      });

      const mean = difficultyByCO.get(q.co) ?? 0.7;

      for (const student of students) {
        const share = Math.max(0, Math.min(1, bell(mean, 0.17) + (ability.get(student.id) ?? 0)));
        const obtained = Math.round(share * q.maxMarks * 2) / 2; // half-mark granularity

        await prisma.mark.upsert({
          where: { questionId_studentId: { questionId: question.id, studentId: student.id } },
          create: { questionId: question.id, studentId: student.id, obtained },
          update: { obtained },
        });
        markCount += 1;
      }
    }

    const total = spec.questions.reduce((sum, q) => sum + q.maxMarks, 0);
    await prisma.assessment.update({ where: { id: assessment.id }, data: { totalMarks: total } });
  }

  log(
    `   CSE 321 Database Management System — ${DBMS_OUTCOMES.length} COs · ${mappingCount} mappings · ${DBMS_ASSESSMENTS.length} assessments · ${markCount} marks`,
  );

  // ── Three more courses, each stalled at a different step ───────────────────

  // Ready for assessment: outcomes and mapping done, no marks yet.
  const os = await prisma.course.upsert({
    where: { code_section_sessionId: { code: 'CSE 313', section: 'A', sessionId: session.id } },
    update: { title: 'Operating Systems', teacherId: ids.teacherId },
    create: {
      code: 'CSE 313',
      title: 'Operating Systems',
      credit: 3,
      section: 'A',
      programId: program.id,
      sessionId: session.id,
      teacherId: ids.teacherId,
      status: 'setup-incomplete',
    },
  });

  const OS_OUTCOMES: Array<[string, string, string]> = [
    ['CO1', 'Explain process scheduling, context switching and CPU utilisation metrics.', 'PO1'],
    ['CO2', 'Analyse deadlock conditions and apply avoidance and detection algorithms.', 'PO2'],
    ['CO3', 'Compare memory management strategies including paging and segmentation.', 'PO3'],
  ];

  for (const [index, [code, statement, poCode]] of OS_OUTCOMES.entries()) {
    const co = await prisma.courseOutcome.upsert({
      where: { courseId_code: { courseId: os.id, code } },
      update: { statement, order: index },
      create: { courseId: os.id, code, statement, order: index, target: 70 },
    });

    const programOutcomeId = poIds.get(poCode);
    if (programOutcomeId) {
      await prisma.cOPOMapping.upsert({
        where: { courseOutcomeId_programOutcomeId: { courseOutcomeId: co.id, programOutcomeId } },
        update: { strength: 3 },
        create: { courseOutcomeId: co.id, programOutcomeId, strength: 3 },
      });
    }
  }

  for (const student of students.slice(0, 32)) {
    await prisma.enrollment.upsert({
      where: { courseId_studentId: { courseId: os.id, studentId: student.id } },
      create: { courseId: os.id, studentId: student.id },
      update: {},
    });
  }

  // Setup incomplete: nothing but a title, so the workflow stepper has a course
  // to walk from the very first step.
  await prisma.course.upsert({
    where: { code_section_sessionId: { code: 'CSE 401', section: 'A', sessionId: session.id } },
    update: { title: 'Software Engineering', teacherId: ids.teacherId },
    create: {
      code: 'CSE 401',
      title: 'Software Engineering',
      credit: 3,
      section: 'A',
      programId: program.id,
      sessionId: session.id,
      teacherId: ids.teacherId,
      status: 'setup-incomplete',
    },
  });

  // Unassigned: shows on the admin dashboard as awaiting a teacher.
  await prisma.course.upsert({
    where: { code_section_sessionId: { code: 'CSE 205', section: 'B', sessionId: session.id } },
    update: { title: 'Data Structures' },
    create: {
      code: 'CSE 205',
      title: 'Data Structures',
      credit: 3,
      section: 'B',
      programId: program.id,
      sessionId: session.id,
      teacherId: null,
      status: 'setup-incomplete',
    },
  });

  log('   CSE 313 Operating Systems — mapped, awaiting marks');
  log('   CSE 401 Software Engineering — setup incomplete');
  log('   CSE 205 Data Structures — no teacher assigned');

  // ── Derive every course status from its own data ──────────────────────────
  const { recomputeStatus } = await import('../src/modules/courses/courses.service');
  const allCourses = await prisma.course.findMany({ select: { id: true, code: true } });
  for (const course of allCourses) {
    await recomputeStatus(course.id);
  }

  // ── Run the real attainment engine over the flagship course ───────────────
  log('\n── Attainment ───────────────────────────────────────────────');

  const { attainmentService } = await import('../src/modules/attainment/attainment.service');
  const run = await attainmentService.calculate(dbms.id);

  log(`   Overall CO ${run.overallCO}% · overall PO ${run.overallPO}%`);
  for (const co of run.co) {
    const mark = co.status === 'achieved' ? '✓' : '!';
    log(
      `   ${mark} ${co.code}  ${String(co.attainment).padStart(5)}%  target ${co.target}%  (${co.studentsAtOrAbove}/${co.studentsAssessed} students)`,
    );
  }
  if (run.gaps.length > 0) {
    log(`   ${run.gaps.length} gap(s) recorded for the gap analysis screen`);
  }
}

// ═════════════════════════════════════════════════════════════════════════════

async function main(): Promise<void> {
  log('\n══ Seeding the OBE CO–PO Attainment System ══════════════════');

  const ids = await seedIdentity();

  if (SEED_DEMO) {
    await seedDemo(ids);
  } else {
    log('\n   SEED_DEMO=false — identity only, no demonstration data.');
  }

  log('\n── Sign in ──────────────────────────────────────────────────');
  log(`   Admin     ${ADMIN_EMAIL.padEnd(22)} ${ADMIN_PASSWORD}`);
  log(`   Teacher   ${TEACHER_EMAIL.padEnd(22)} ${TEACHER_PASSWORD}`);
  log(`   Student   ${STUDENT_EMAIL.padEnd(22)} ${STUDENT_PASSWORD}`);
  log('\n   Change these passwords before any real deployment.\n');
}

main()
  .catch((err) => {
    console.error('\nSeed failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
