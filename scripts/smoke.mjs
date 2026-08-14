// End-to-end API smoke test. Walks the whole value chain as each role.
//   node smoke.mjs
const BASE = process.env.BASE ?? 'http://localhost:5021/api/v1';

let pass = 0;
let fail = 0;
const failures = [];

function ok(name, detail = '') {
  pass += 1;
  console.log(`  PASS  ${name}${detail ? `  — ${detail}` : ''}`);
}

function bad(name, detail) {
  fail += 1;
  failures.push(`${name}: ${detail}`);
  console.log(`  FAIL  ${name}  — ${detail}`);
}

async function call(method, path, { token, body, raw } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (raw) return { status: res.status, res };
  if (res.status === 204) return { status: 204, json: null };

  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  return { status: res.status, json };
}

async function expect(name, promise, check) {
  try {
    const result = await promise;
    const problem = check(result);
    if (problem) bad(name, problem);
    else ok(name, result.json?.message ?? `${result.status}`);
    return result;
  } catch (err) {
    bad(name, err.message);
    return { status: 0, json: null };
  }
}

const is = (status) => (r) =>
  r.status === status ? null : `expected ${status}, got ${r.status} — ${JSON.stringify(r.json)?.slice(0, 180)}`;

async function main() {
  console.log(`\n═══ OBE API smoke test — ${BASE} ═══\n`);

  // ── Health ────────────────────────────────────────────────────────────────
  console.log('Health');
  await expect('GET /health', call('GET', '/health'), is(200));

  // ── Auth ──────────────────────────────────────────────────────────────────
  console.log('\nAuthentication');
  const logins = {};
  for (const [role, email, password] of [
    ['admin', 'admin@gmail.com', 'admin12345'],
    ['teacher', 'teacher@obe.edu', 'Teacher@1234'],
    ['student', 'student@obe.edu', 'Student@1234'],
  ]) {
    const r = await expect(
      `POST /auth/login (${role})`,
      call('POST', '/auth/login', { body: { email, password } }),
      is(200),
    );
    logins[role] = r.json?.data?.tokens?.accessToken;
    const roles = r.json?.data?.user?.roles ?? [];
    if (!roles.includes(role)) bad(`${role} carries the ${role} role`, `roles = ${roles.join(',')}`);
    else ok(`${role} carries the ${role} role`, `${r.json.data.user.permissions.length} permissions`);
  }

  const admin = logins.admin;
  const teacher = logins.teacher;
  const student = logins.student;

  await expect('POST /auth/login rejects a wrong password',
    call('POST', '/auth/login', { body: { email: 'teacher@obe.edu', password: 'nope' } }), is(401));
  await expect('GET /auth/me', call('GET', '/auth/me', { token: teacher }), is(200));
  await expect('GET /auth/me without a token is 401', call('GET', '/auth/me'), is(401));

  // ── Academic structure ────────────────────────────────────────────────────
  console.log('\nAcademic structure');
  const departments = await expect('GET /departments', call('GET', '/departments', { token: admin }), is(200));
  const programs = await expect('GET /programs', call('GET', '/programs', { token: admin }), is(200));
  const programId = programs.json?.data?.find((p) => p.code === 'BSCSE')?.id;

  await expect('GET /program-outcomes',
    call('GET', `/program-outcomes?programId=${programId}`, { token: admin }),
    (r) => (r.json?.data?.length === 12 ? null : `expected 12 POs, got ${r.json?.data?.length}`));

  await expect('GET /sessions', call('GET', '/sessions', { token: admin }), is(200));
  await expect('GET /sessions/active', call('GET', '/sessions/active', { token: admin }), is(200));

  await expect('POST /departments as teacher is 403',
    call('POST', '/departments', { token: teacher, body: { name: 'X', code: 'XX' } }), is(403));

  // Full CRUD round trip on a throwaway department.
  const created = await expect('POST /departments',
    call('POST', '/departments', { token: admin, body: { name: 'Smoke Test Dept', code: 'SMK' } }), is(201));
  const smokeId = created.json?.data?.id;
  if (smokeId) {
    await expect('PATCH /departments/:id',
      call('PATCH', `/departments/${smokeId}`, { token: admin, body: { name: 'Smoke Renamed' } }), is(200));
    await expect('DELETE /departments/:id',
      call('DELETE', `/departments/${smokeId}`, { token: admin }), is(204));
  }
  await expect('DELETE a department with programs is refused',
    call('DELETE', `/departments/${departments.json?.data?.[0]?.id}`, { token: admin }), is(422));

  // ── Courses ───────────────────────────────────────────────────────────────
  console.log('\nCourses');
  const courses = await expect('GET /courses (teacher scope)', call('GET', '/courses', { token: teacher }), is(200));
  const dbms = courses.json?.data?.find((c) => c.code === 'CSE 321');
  if (!dbms) {
    bad('CSE 321 is visible to its teacher', 'not found');
    return report_();
  }
  ok('CSE 321 is visible to its teacher', `status "${dbms.status}" · ${dbms.studentCount} students · CO ${dbms.coAttainment}%`);

  const unassigned = courses.json?.data?.find((c) => c.code === 'CSE 205');
  if (unassigned) bad('teacher scope excludes unassigned courses', 'CSE 205 leaked into the teacher list');
  else ok('teacher scope excludes unassigned courses');

  await expect('GET /courses/:id/setup',
    call('GET', `/courses/${dbms.id}/setup`, { token: teacher }),
    (r) => (r.json?.data?.readyToCalculate === true ? null : `readyToCalculate = ${r.json?.data?.readyToCalculate}`));

  // ── Outcomes and mapping ──────────────────────────────────────────────────
  console.log('\nOutcomes and mapping');
  await expect('GET /course-outcomes',
    call('GET', `/course-outcomes?courseId=${dbms.id}`, { token: teacher }),
    (r) => (r.json?.data?.length === 5 ? null : `expected 5 COs, got ${r.json?.data?.length}`));

  await expect('GET /copo-mapping',
    call('GET', `/copo-mapping?courseId=${dbms.id}`, { token: teacher }),
    (r) => (r.json?.data?.complete === true ? null : `mapping incomplete: ${JSON.stringify(r.json?.data?.invalidPOs)}`));

  // ── Assessments and marks ─────────────────────────────────────────────────
  console.log('\nAssessments and marks');
  const assessments = await expect('GET /assessments',
    call('GET', `/assessments?courseId=${dbms.id}`, { token: teacher }),
    (r) => (r.json?.data?.length === 4 ? null : `expected 4 assessments, got ${r.json?.data?.length}`));

  const midterm = assessments.json?.data?.find((a) => a.type === 'midterm');
  const grid = await expect('GET /marks',
    call('GET', `/marks?assessmentId=${midterm.id}`, { token: teacher }),
    (r) => (r.json?.data?.rows?.length === 48 ? null : `expected 48 rows, got ${r.json?.data?.rows?.length}`));

  const row = grid.json?.data?.rows?.[0];
  const question = grid.json?.data?.questions?.[0];

  await expect('PUT /marks accepts a valid mark',
    call('PUT', '/marks', {
      token: teacher,
      body: {
        assessmentId: midterm.id,
        entries: [{ studentId: row.student.id, questionId: question.id, obtained: row.marks[question.id] }],
      },
    }), is(200));

  await expect('PUT /marks rejects a mark above the maximum',
    call('PUT', '/marks', {
      token: teacher,
      body: {
        assessmentId: midterm.id,
        entries: [{ studentId: row.student.id, questionId: question.id, obtained: question.maxMarks + 5 }],
      },
    }), is(422));

  await expect('GET /marks/template',
    call('GET', `/marks/template?assessmentId=${midterm.id}`, { token: teacher, raw: true }),
    (r) => (r.status === 200 ? null : `status ${r.status}`));

  // ── CSV import, both phases ───────────────────────────────────────────────
  console.log('\nCSV import');
  const questions = grid.json.data.questions;
  const goodCsv = [
    ['StudentID', 'Name', ...questions.map((q) => q.code)].join(','),
    ...grid.json.data.rows.slice(0, 10).map((r) =>
      [r.student.studentId, r.student.name, ...questions.map((q) => r.marks[q.id] ?? '')].join(','),
    ),
  ].join('\n');

  async function upload(csv, name) {
    const form = new FormData();
    form.append('assessmentId', midterm.id);
    form.append('file', new Blob([csv], { type: 'text/csv' }), name);
    const res = await fetch(`${BASE}/marks/import/validate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${teacher}` },
      body: form,
    });
    return { status: res.status, json: await res.json() };
  }

  const validUpload = await expect('POST /marks/import/validate (clean file)', upload(goodCsv, 'marks.csv'),
    (r) => {
      if (r.status !== 200) return `status ${r.status}`;
      const errors = r.json.data.issues.filter((i) => i.severity === 'error');
      return errors.length === 0 ? null : `unexpected errors: ${errors[0].message}`;
    });

  await expect('POST /marks/import/commit',
    call('POST', '/marks/import/commit', { token: teacher, body: { uploadToken: validUpload.json.data.uploadToken } }),
    is(200));

  const badCsv = goodCsv.replace(/\n(\S+),([^,]*),(\d+(\.\d+)?)/, (m, id, name) =>
    `\n${id},${name},${questions[0].maxMarks + 7}`);
  const badUpload = await expect('POST /marks/import/validate catches an over-maximum mark',
    upload(badCsv, 'bad-marks.csv'),
    (r) => {
      const errors = r.json?.data?.issues?.filter((i) => i.severity === 'error') ?? [];
      if (errors.length === 0) return 'no error reported for an out-of-range mark';
      if (r.json.data.uploadToken !== '') return 'a file with errors was still staged for commit';
      return null;
    });
  if (badUpload.json?.data?.issues?.length) {
    console.log(`        └─ "${badUpload.json.data.issues.find((i) => i.severity === 'error').message}"`);
  }

  await expect('POST /marks/import/validate rejects a non-CSV',
    upload('not,a,csv\x00binary', 'payload.exe'), is(400));

  // ── Attainment ────────────────────────────────────────────────────────────
  console.log('\nAttainment');
  const run = await expect('POST /attainment/calculate',
    call('POST', '/attainment/calculate', { token: teacher, body: { courseId: dbms.id } }), is(200));

  if (run.json?.data) {
    const d = run.json.data;
    ok('  overall figures', `CO ${d.overallCO}% · PO ${d.overallPO}% · ${d.co.length} COs · ${d.po.length} POs · ${d.gaps.length} gaps`);
    const sum = d.co.every((c) => c.studentsAtOrAbove <= c.studentsAssessed);
    if (!sum) bad('CO counts are internally consistent', 'studentsAtOrAbove exceeds studentsAssessed');
    else ok('CO counts are internally consistent');

    const recomputed = d.co.map((c) =>
      c.studentsAssessed === 0 ? 0 : Math.round((c.studentsAtOrAbove / c.studentsAssessed) * 1000) / 10);
    const matches = d.co.every((c, i) => Math.abs(c.attainment - recomputed[i]) < 0.11);
    if (!matches) bad('CO attainment matches its own counts', JSON.stringify(recomputed));
    else ok('CO attainment matches its own counts');

    const gapsSigned = d.gaps.every((g) => Math.abs(g.gap - (g.attainment - g.target)) < 0.11);
    if (!gapsSigned) bad('gaps are signed percentage points', 'gap != attainment - target');
    else ok('gaps are signed percentage points');
  }

  await expect('GET /attainment', call('GET', `/attainment?courseId=${dbms.id}`, { token: teacher }), is(200));
  await expect('GET /attainment/history', call('GET', `/attainment/history?courseId=${dbms.id}`, { token: teacher }), is(200));
  await expect('GET /attainment/students',
    call('GET', `/attainment/students?courseId=${dbms.id}`, { token: teacher }),
    (r) => (r.json?.data?.length === 48 ? null : `expected 48 students, got ${r.json?.data?.length}`));

  // Setup-incomplete course must refuse to calculate.
  const swe = courses.json.data.find((c) => c.code === 'CSE 401');
  await expect('calculate refuses a course with incomplete setup',
    call('POST', '/attainment/calculate', { token: teacher, body: { courseId: swe.id } }), is(422));

  // ── Reports ───────────────────────────────────────────────────────────────
  console.log('\nReports');
  const report = await expect('POST /reports',
    call('POST', '/reports', {
      token: teacher,
      body: { courseId: dbms.id, config: { includeStudentList: true, signatoryName: 'Mobinul Islam' } },
    }), is(201));

  const reportId = report.json?.data?.id;
  await expect('GET /reports/:id', call('GET', `/reports/${reportId}`, { token: teacher }), is(200));

  for (const [format, mime] of [['pdf', 'application/pdf'], ['excel', 'spreadsheetml']]) {
    const { status, res } = await call('GET', `/reports/${reportId}/${format}`, { token: teacher, raw: true });
    const buffer = await res.arrayBuffer();
    const type = res.headers.get('content-type') ?? '';
    if (status !== 200) bad(`GET /reports/:id/${format}`, `status ${status}`);
    else if (!type.includes(mime)) bad(`GET /reports/:id/${format}`, `content-type ${type}`);
    else if (buffer.byteLength < 2000) bad(`GET /reports/:id/${format}`, `only ${buffer.byteLength} bytes`);
    else ok(`GET /reports/:id/${format}`, `${(buffer.byteLength / 1024).toFixed(1)} KB`);
  }

  // ── Dashboards ────────────────────────────────────────────────────────────
  console.log('\nDashboards');
  const teacherDash = await expect('GET /dashboard/teacher', call('GET', '/dashboard/teacher', { token: teacher }), is(200));
  if (teacherDash.json?.data) {
    const d = teacherDash.json.data;
    ok('  teacher KPIs', `${d.kpis.activeCourses} courses · ${d.kpis.studentsTaught} students · avg CO ${d.kpis.averageCOAttainment}% · ${d.pendingActions.length} pending`);
    if (d.pendingActions[0]) console.log(`        └─ "${d.pendingActions[0].detail}"`);
  }

  const adminDash = await expect('GET /dashboard/admin', call('GET', '/dashboard/admin', { token: admin }), is(200));
  if (adminDash.json?.data) {
    const k = adminDash.json.data.kpis;
    ok('  admin KPIs', `${k.departments} departments · ${k.programs} programs · ${k.courses} courses · ${k.users} users`);
  }

  const studentDash = await expect('GET /dashboard/student', call('GET', '/dashboard/student', { token: student }), is(200));
  if (studentDash.json?.data) {
    const k = studentDash.json.data.kpis;
    ok('  student KPIs', `${k.enrolledCourses} courses · ${k.assessmentsTaken} assessments · ${k.averagePercentage}% · ${k.outcomesAchieved} outcomes met`);
  }

  await expect('GET /dashboard/admin as teacher is 403', call('GET', '/dashboard/admin', { token: teacher }), is(403));

  // ── Student isolation ─────────────────────────────────────────────────────
  console.log('\nStudent isolation');
  await expect('a student cannot read the marks grid',
    call('GET', `/marks?assessmentId=${midterm.id}`, { token: student }), is(403));
  await expect('a student cannot calculate attainment',
    call('POST', '/attainment/calculate', { token: student, body: { courseId: dbms.id } }), is(403));
  await expect('a student cannot list all students',
    call('GET', '/students', { token: student }), is(403));
  const studentCourses = await expect('a student can see their own enrolled courses',
    call('GET', '/courses', { token: student }),
    (r) => (r.json?.data?.length > 0 ? null : `no courses returned (status ${r.status})`));
  await expect('a student cannot see a course they are not enrolled in',
    call('GET', `/courses/${swe.id}`, { token: student }), is(403));
  await expect('GET /attainment/me returns the student\'s own breakdown',
    call('GET', `/attainment/me?courseId=${studentCourses.json?.data?.[0]?.id}`, { token: student }),
    (r) => (r.json?.data?.performance?.perCO?.length > 0 ? null : `no CO breakdown (status ${r.status})`));
  await expect('a student cannot read the whole class breakdown',
    call('GET', `/attainment/students?courseId=${dbms.id}`, { token: student }), is(403));
  await expect('a student sees published assessments only',
    call('GET', `/assessments?courseId=${dbms.id}`, { token: student }),
    (r) => (r.json?.data?.every((a) => a.isPublished) ? null : 'an unpublished assessment leaked'));

  report_();
}

function report_() {
  console.log(`\n═══ ${pass} passed · ${fail} failed ═══`);
  if (failures.length) {
    console.log('\nFailures:');
    for (const f of failures) console.log(`  · ${f}`);
  }
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('\nSmoke test crashed:', err);
  process.exit(1);
});
