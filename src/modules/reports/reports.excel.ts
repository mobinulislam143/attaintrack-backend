import ExcelJS from 'exceljs';
import { ReportPayload } from './reports.service';

// ─────────────────────────────────────────────────────────────────────────────
// Excel export.
//
// The teacher's original workflow was a spreadsheet, so this is not a
// consolation prize — it is the format they will actually forward to the
// accreditation committee. One sheet per section, frozen headers, real numbers
// rather than pre-formatted strings so the committee can sort and re-total.
// ─────────────────────────────────────────────────────────────────────────────

const BRAND = 'FF3730A3';
const HEAD_BG = 'FFF7F8FA';
const GREEN = 'FF067647';
const AMBER = 'FFB54708';
const MUTED = 'FF697586';
const INK = 'FF141A22';
const HAIRLINE = 'FFE3E6EB';

type Sheet = ExcelJS.Worksheet;

function titleRow(sheet: Sheet, text: string, span: number): void {
  const row = sheet.addRow([text]);
  row.font = { bold: true, size: 13, color: { argb: INK } };
  row.height = 22;
  sheet.mergeCells(row.number, 1, row.number, Math.max(1, span));
}

function subtitleRow(sheet: Sheet, text: string, span: number): void {
  const row = sheet.addRow([text]);
  row.font = { size: 9, color: { argb: MUTED } };
  sheet.mergeCells(row.number, 1, row.number, Math.max(1, span));
}

function headerRow(sheet: Sheet, headers: string[]): ExcelJS.Row {
  const row = sheet.addRow(headers);
  row.height = 20;
  row.eachCell((cell) => {
    cell.font = { bold: true, size: 9, color: { argb: MUTED } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEAD_BG } };
    cell.alignment = { vertical: 'middle' };
    cell.border = { bottom: { style: 'thin', color: { argb: HAIRLINE } } };
  });
  return row;
}

function statusColor(status: string): string {
  if (status === 'achieved') return GREEN;
  if (status === 'below-target') return AMBER;
  return MUTED;
}

function statusLabel(status: string): string {
  if (status === 'achieved') return 'Achieved';
  if (status === 'below-target') return 'Below Target';
  return 'Not Started';
}

/** Render a report to an .xlsx buffer. */
export async function renderReportExcel(payload: ReportPayload): Promise<Buffer> {
  const { report, course, run, outcomes, matrix, students } = payload;
  const config = report.config;

  const workbook = new ExcelJS.Workbook();
  workbook.creator = report.generatedByName;
  workbook.created = new Date(report.generatedAt);
  workbook.title = `${course.code} — CO/PO Attainment`;

  // ── Summary ───────────────────────────────────────────────────────────────
  const summary = workbook.addWorksheet('Summary', {
    views: [{ showGridLines: false }],
  });
  summary.columns = [{ width: 30 }, { width: 46 }];

  titleRow(summary, `${course.code} · ${course.title}`, 2);
  subtitleRow(summary, `${course.program.name} · ${course.department.name} · ${course.session.name}`, 2);
  summary.addRow([]);

  const facts: Array<[string, string | number]> = [
    ['Course code', `${course.code} · Section ${course.section}`],
    ['Credit hours', course.credit],
    ['Program', `${course.program.code} — ${course.program.degree}`],
    ['Department', course.department.name],
    ['Academic session', course.session.name],
    [
      'Course teacher',
      course.teacher ? `${course.teacher.firstName} ${course.teacher.lastName}` : 'Not assigned',
    ],
    ['Students enrolled', course.studentCount],
    ['Attainment threshold (per student)', `${course.attainmentThreshold}%`],
    ['Attainment target (share of students)', `${course.attainmentTarget}%`],
    ['Calculation method', 'Threshold'],
    ['Calculated on', new Date(run.calculatedAt).toDateString()],
    ['Overall CO attainment', `${run.overallCO}%`],
    ['Overall PO attainment', `${run.overallPO}%`],
    ['Report generated', `${new Date(report.generatedAt).toDateString()} by ${report.generatedByName}`],
  ];

  for (const [label, value] of facts) {
    const row = summary.addRow([label, value]);
    row.getCell(1).font = { size: 9, color: { argb: MUTED } };
    row.getCell(2).font = { size: 10, bold: true, color: { argb: INK } };
    row.getCell(1).border = { bottom: { style: 'hair', color: { argb: HAIRLINE } } };
    row.getCell(2).border = { bottom: { style: 'hair', color: { argb: HAIRLINE } } };
  }

  // ── Course Outcomes ───────────────────────────────────────────────────────
  if (config.includeCOList) {
    const sheet = workbook.addWorksheet('Course Outcomes', { views: [{ showGridLines: false }] });
    sheet.columns = [{ width: 10 }, { width: 72 }, { width: 20 }, { width: 12 }, { width: 14 }];

    titleRow(sheet, 'Course Outcomes', 5);
    sheet.addRow([]);
    headerRow(sheet, ['CO', 'Statement', 'Mapped POs', 'Target', 'Questions']);
    sheet.views = [{ state: 'frozen', ySplit: 3, showGridLines: false }];

    for (const co of outcomes) {
      const row = sheet.addRow([
        co.code,
        co.statement,
        co.mappedPOs.join(', ') || '—',
        co.target / 100,
        co.questionCount,
      ]);
      row.getCell(1).font = { bold: true, color: { argb: BRAND } };
      row.getCell(2).alignment = { wrapText: true, vertical: 'top' };
      row.getCell(4).numFmt = '0%';
    }
  }

  // ── CO-PO matrix ──────────────────────────────────────────────────────────
  if (config.includeCOPOMatrix && matrix.pos.length > 0) {
    const sheet = workbook.addWorksheet('CO-PO Matrix', { views: [{ showGridLines: false }] });
    sheet.columns = [{ width: 12 }, ...matrix.pos.map(() => ({ width: 8 }))];

    titleRow(sheet, 'CO–PO mapping matrix', matrix.pos.length + 1);
    subtitleRow(sheet, '1 low · 2 medium · 3 high · blank means not mapped', matrix.pos.length + 1);
    sheet.addRow([]);
    headerRow(sheet, ['CO / PO', ...matrix.pos.map((po) => po.code)]);
    sheet.views = [{ state: 'frozen', xSplit: 1, ySplit: 4, showGridLines: false }];

    const strengths = new Map(
      matrix.entries.map((e) => [`${e.courseOutcomeId}:${e.programOutcomeId}`, e.strength]),
    );

    for (const co of matrix.cos) {
      const row = sheet.addRow([
        co.code,
        ...matrix.pos.map((po) => strengths.get(`${co.id}:${po.id}`) ?? null),
      ]);
      row.getCell(1).font = { bold: true, color: { argb: BRAND } };
      row.eachCell((cell, index) => {
        if (index === 1) return;
        cell.alignment = { horizontal: 'center' };
        const value = Number(cell.value ?? 0);
        if (value > 0) {
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: value === 3 ? 'FF45409E' : value === 2 ? 'FF9E9CDC' : 'FFE1E1F5' },
          };
          cell.font = { bold: true, color: { argb: value >= 2 ? 'FFFFFFFF' : 'FF2B2680' } };
        }
      });
    }
  }

  // ── CO attainment ─────────────────────────────────────────────────────────
  if (config.includeCOAttainment) {
    const sheet = workbook.addWorksheet('CO Attainment', { views: [{ showGridLines: false }] });
    sheet.columns = [
      { width: 10 },
      { width: 50 },
      { width: 12 },
      { width: 14 },
      { width: 13 },
      { width: 13 },
      { width: 10 },
      { width: 15 },
    ];

    titleRow(sheet, 'Course Outcome attainment', 8);
    subtitleRow(
      sheet,
      `Threshold method — a student attains a CO at ${course.attainmentThreshold}%; a CO is achieved when the share of students reaches its target.`,
      8,
    );
    sheet.addRow([]);
    headerRow(sheet, [
      'CO',
      'Statement',
      'Assessed',
      'At or above',
      'Mean score',
      'Attainment',
      'Target',
      'Status',
    ]);
    sheet.views = [{ state: 'frozen', ySplit: 4, showGridLines: false }];

    for (const co of run.co) {
      const row = sheet.addRow([
        co.code,
        co.statement,
        co.studentsAssessed,
        co.studentsAtOrAbove,
        co.averageScore / 100,
        co.attainment / 100,
        co.target / 100,
        statusLabel(co.status),
      ]);
      row.getCell(1).font = { bold: true, color: { argb: BRAND } };
      row.getCell(2).alignment = { wrapText: true, vertical: 'top' };
      row.getCell(5).numFmt = '0.0%';
      row.getCell(6).numFmt = '0.0%';
      row.getCell(6).font = { bold: true, color: { argb: statusColor(co.status) } };
      row.getCell(7).numFmt = '0%';
      row.getCell(8).font = { bold: true, color: { argb: statusColor(co.status) } };
    }

    const total = sheet.addRow(['', 'Overall CO attainment', '', '', '', run.overallCO / 100, '', '']);
    total.getCell(2).font = { bold: true, color: { argb: INK } };
    total.getCell(6).numFmt = '0.0%';
    total.getCell(6).font = { bold: true, color: { argb: INK } };
  }

  // ── PO attainment ─────────────────────────────────────────────────────────
  if (config.includePOAttainment && run.po.length > 0) {
    const sheet = workbook.addWorksheet('PO Attainment', { views: [{ showGridLines: false }] });
    sheet.columns = [
      { width: 10 },
      { width: 44 },
      { width: 34 },
      { width: 13 },
      { width: 10 },
      { width: 15 },
    ];

    titleRow(sheet, 'Program Outcome attainment', 6);
    subtitleRow(
      sheet,
      'Strength-weighted mean of the contributing Course Outcomes (weights 1 low · 2 medium · 3 high).',
      6,
    );
    sheet.addRow([]);
    headerRow(sheet, ['PO', 'Title', 'Contributing COs', 'Attainment', 'Target', 'Status']);
    sheet.views = [{ state: 'frozen', ySplit: 4, showGridLines: false }];

    for (const po of run.po) {
      const row = sheet.addRow([
        po.code,
        po.title,
        po.contributingCOs.map((c) => `${c.code} (${c.strength})`).join(', ') || '—',
        po.attainment / 100,
        po.target / 100,
        statusLabel(po.status),
      ]);
      row.getCell(1).font = { bold: true, color: { argb: BRAND } };
      row.getCell(2).alignment = { wrapText: true, vertical: 'top' };
      row.getCell(4).numFmt = '0.0%';
      row.getCell(4).font = { bold: true, color: { argb: statusColor(po.status) } };
      row.getCell(5).numFmt = '0%';
      row.getCell(6).font = { bold: true, color: { argb: statusColor(po.status) } };
    }

    const total = sheet.addRow(['', 'Overall PO attainment', '', run.overallPO / 100, '', '']);
    total.getCell(2).font = { bold: true, color: { argb: INK } };
    total.getCell(4).numFmt = '0.0%';
    total.getCell(4).font = { bold: true, color: { argb: INK } };
  }

  // ── Gap analysis ──────────────────────────────────────────────────────────
  if (config.includeGapAnalysis) {
    const sheet = workbook.addWorksheet('Gap Analysis', { views: [{ showGridLines: false }] });
    sheet.columns = [{ width: 8 }, { width: 10 }, { width: 40 }, { width: 12 }, { width: 10 }, { width: 66 }];

    titleRow(sheet, 'Gap analysis', 6);
    sheet.addRow([]);

    if (run.gaps.length === 0) {
      const row = sheet.addRow(['Every Course Outcome and Program Outcome met its target. No gaps to report.']);
      row.font = { color: { argb: GREEN }, bold: true };
    } else {
      headerRow(sheet, ['Kind', 'Code', 'Outcome', 'Attainment', 'Gap', 'Observation']);
      sheet.views = [{ state: 'frozen', ySplit: 3, showGridLines: false }];

      for (const gap of run.gaps) {
        gap.observations.forEach((observation, index) => {
          const row = sheet.addRow([
            index === 0 ? gap.kind : '',
            index === 0 ? gap.code : '',
            index === 0 ? gap.label : '',
            index === 0 ? gap.attainment / 100 : null,
            index === 0 ? gap.gap / 100 : null,
            observation,
          ]);
          if (index === 0) {
            row.getCell(2).font = { bold: true, color: { argb: BRAND } };
            row.getCell(4).numFmt = '0.0%';
            row.getCell(5).numFmt = '+0.0%;−0.0%';
            row.getCell(5).font = { bold: true, color: { argb: AMBER } };
          }
          row.getCell(3).alignment = { wrapText: true, vertical: 'top' };
          row.getCell(6).alignment = { wrapText: true, vertical: 'top' };
        });
      }

      sheet.addRow([]);
      const note = sheet.addRow([
        'These are observations drawn from the recorded marks. Interpretation and remedial planning remain with the course teacher.',
      ]);
      note.font = { italic: true, size: 9, color: { argb: MUTED } };
      sheet.mergeCells(note.number, 1, note.number, 6);
    }
  }

  // ── Student performance ───────────────────────────────────────────────────
  if (config.includeStudentList && students.length > 0) {
    const sheet = workbook.addWorksheet('Student Performance', { views: [{ showGridLines: false }] });
    const coCodes = outcomes.map((co) => co.code);

    sheet.columns = [
      { width: 14 },
      { width: 28 },
      ...coCodes.map(() => ({ width: 10 })),
      { width: 12 },
      { width: 12 },
    ];

    titleRow(sheet, 'Student performance', coCodes.length + 4);
    subtitleRow(
      sheet,
      `Per-CO percentage. A cell in green means the student reached the ${course.attainmentThreshold}% threshold.`,
      coCodes.length + 4,
    );
    sheet.addRow([]);
    headerRow(sheet, ['Student ID', 'Name', ...coCodes, 'Total', 'Percentage']);
    sheet.views = [{ state: 'frozen', xSplit: 2, ySplit: 4, showGridLines: false }];

    for (const entry of students) {
      const row = sheet.addRow([
        entry.student.studentId,
        entry.student.name,
        ...coCodes.map((code) => {
          const co = entry.perCO.find((c) => c.code === code);
          return co ? co.percentage / 100 : null;
        }),
        entry.totalObtained,
        entry.percentage / 100,
      ]);

      coCodes.forEach((code, index) => {
        const cell = row.getCell(3 + index);
        cell.numFmt = '0%';
        const co = entry.perCO.find((c) => c.code === code);
        if (co) cell.font = { color: { argb: co.meetsThreshold ? GREEN : AMBER } };
      });

      row.getCell(3 + coCodes.length + 1).numFmt = '0.0%';
      row.getCell(3 + coCodes.length + 1).font = { bold: true, color: { argb: INK } };
    }
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
