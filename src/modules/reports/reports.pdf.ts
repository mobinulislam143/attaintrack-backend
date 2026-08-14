import PDFDocument from 'pdfkit';
import { ReportPayload } from './reports.service';

// ─────────────────────────────────────────────────────────────────────────────
// PDF export.
//
// A4, white paper, indigo rules — the design system's report sheet rendered for
// print. pdfkit's built-in Helvetica stands in for Public Sans and Courier for
// IBM Plex Mono: no font binaries are vendored, and the numerals still align
// because Courier is monospaced.
// ─────────────────────────────────────────────────────────────────────────────

const BRAND = '#3730A3';
const INK = '#141A22';
const BODY = '#364152';
const MUTED = '#697586';
const HAIRLINE = '#E3E6EB';
const GREEN = '#067647';
const AMBER = '#B54708';

const PAGE_MARGIN = 48;
const A4_WIDTH = 595.28;
const CONTENT_WIDTH = A4_WIDTH - PAGE_MARGIN * 2;

type Doc = PDFKit.PDFDocument;

function toneFor(attainment: number, target: number): string {
  return attainment >= target ? GREEN : AMBER;
}

function heading(doc: Doc, text: string): void {
  ensureSpace(doc, 60);
  doc.moveDown(0.9);
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(13).text(text);
  doc.moveDown(0.15);
  const y = doc.y;
  doc
    .strokeColor(BRAND)
    .lineWidth(1.5)
    .moveTo(PAGE_MARGIN, y)
    .lineTo(PAGE_MARGIN + 34, y)
    .stroke();
  doc.moveDown(0.6);
}

function ensureSpace(doc: Doc, needed: number): void {
  if (doc.y + needed > doc.page.height - PAGE_MARGIN - 24) doc.addPage();
}

/** A simple fixed-column table with hairline rows. */
function table(
  doc: Doc,
  columns: Array<{ label: string; width: number; align?: 'left' | 'right' | 'center'; mono?: boolean }>,
  rows: Array<Array<{ text: string; color?: string }>>,
): void {
  const startX = PAGE_MARGIN;

  const drawHeader = (): void => {
    ensureSpace(doc, 40);
    const y = doc.y;
    doc.rect(startX, y, CONTENT_WIDTH, 20).fill('#F7F8FA');

    let x = startX;
    doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(7.5);
    for (const column of columns) {
      doc.text(column.label.toUpperCase(), x + 6, y + 6.5, {
        width: column.width - 12,
        align: column.align ?? 'left',
        characterSpacing: 0.6,
      });
      x += column.width;
    }
    doc.y = y + 20;
  };

  drawHeader();

  for (const row of rows) {
    // Height is driven by the tallest wrapped cell.
    let height = 18;
    columns.forEach((column, index) => {
      const cell = row[index];
      if (!cell) return;
      doc.font(column.mono ? 'Courier' : 'Helvetica').fontSize(8.5);
      const needed = doc.heightOfString(cell.text, { width: column.width - 12 }) + 9;
      if (needed > height) height = needed;
    });

    if (doc.y + height > doc.page.height - PAGE_MARGIN - 24) {
      doc.addPage();
      drawHeader();
    }

    const y = doc.y;
    let x = startX;
    columns.forEach((column, index) => {
      const cell = row[index];
      if (cell) {
        doc
          .fillColor(cell.color ?? BODY)
          .font(column.mono ? 'Courier' : 'Helvetica')
          .fontSize(8.5)
          .text(cell.text, x + 6, y + 5, {
            width: column.width - 12,
            align: column.align ?? 'left',
          });
      }
      x += column.width;
    });

    doc
      .strokeColor(HAIRLINE)
      .lineWidth(0.5)
      .moveTo(startX, y + height)
      .lineTo(startX + CONTENT_WIDTH, y + height)
      .stroke();

    doc.y = y + height;
  }

  doc.moveDown(0.5);
}

function keyValueGrid(doc: Doc, entries: Array<[string, string]>): void {
  const columnWidth = CONTENT_WIDTH / 2;
  let index = 0;

  while (index < entries.length) {
    ensureSpace(doc, 34);
    const y = doc.y;

    for (let column = 0; column < 2 && index < entries.length; column += 1, index += 1) {
      const [label, value] = entries[index]!;
      const x = PAGE_MARGIN + column * columnWidth;

      doc
        .fillColor(MUTED)
        .font('Helvetica')
        .fontSize(7.5)
        .text(label.toUpperCase(), x, y, { width: columnWidth - 12, characterSpacing: 0.6 });

      doc
        .fillColor(INK)
        .font('Helvetica-Bold')
        .fontSize(10)
        .text(value, x, y + 11, { width: columnWidth - 12 });
    }

    doc.y = y + 30;
  }
}

/** A horizontal attainment bar with a dashed target line — the system's only chart. */
function attainmentBar(
  doc: Doc,
  label: string,
  sublabel: string,
  attainment: number,
  target: number,
): void {
  ensureSpace(doc, 44);
  const y = doc.y;
  const labelWidth = 118;
  const trackX = PAGE_MARGIN + labelWidth;
  const trackWidth = CONTENT_WIDTH - labelWidth - 54;

  doc.fillColor(INK).font('Helvetica-Bold').fontSize(9).text(label, PAGE_MARGIN, y + 2, {
    width: labelWidth - 8,
  });
  if (sublabel) {
    doc.fillColor(MUTED).font('Helvetica').fontSize(7).text(sublabel, PAGE_MARGIN, y + 13, {
      width: labelWidth - 8,
      height: 10,
      ellipsis: true,
    });
  }

  doc.roundedRect(trackX, y + 3, trackWidth, 12, 2).fill('#EFF1F4');

  const filled = Math.max(0, Math.min(100, attainment)) / 100;
  if (filled > 0) {
    doc.roundedRect(trackX, y + 3, Math.max(2, trackWidth * filled), 12, 2).fill(toneFor(attainment, target));
  }

  const targetX = trackX + trackWidth * (Math.max(0, Math.min(100, target)) / 100);
  doc
    .strokeColor('#364152')
    .lineWidth(1)
    .dash(2, { space: 2 })
    .moveTo(targetX, y)
    .lineTo(targetX, y + 18)
    .stroke()
    .undash();

  doc
    .fillColor(toneFor(attainment, target))
    .font('Courier-Bold')
    .fontSize(9.5)
    .text(`${attainment}%`, trackX + trackWidth + 8, y + 4, { width: 46, align: 'right' });

  doc.y = y + 26;
}

/**
 * Render a report to a PDF buffer.
 * Everything the config switched off is skipped entirely — the sections are not
 * greyed out, they are absent.
 */
export function renderReportPdf(payload: ReportPayload): Promise<Buffer> {
  const { report, course, run, outcomes, matrix, students } = payload;
  const config = report.config;

  const doc = new PDFDocument({
    size: 'A4',
    // Required for the page-number pass at the end — without it the earlier
    // pages have already been flushed and cannot be switched back to.
    bufferPages: true,
    margins: { top: PAGE_MARGIN, bottom: PAGE_MARGIN, left: PAGE_MARGIN, right: PAGE_MARGIN },
    info: {
      Title: `${course.code} — CO/PO Attainment Report`,
      Author: course.teacher
        ? `${course.teacher.firstName} ${course.teacher.lastName}`
        : 'OBE Attainment System',
      Subject: `${course.title} · ${course.session.name}`,
    },
  });

  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));

  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  // ── Masthead ──────────────────────────────────────────────────────────────
  doc.rect(0, 0, A4_WIDTH, 92).fill(BRAND);
  doc
    .fillColor('#FFFFFF')
    .font('Helvetica-Bold')
    .fontSize(20)
    .text('OBE', PAGE_MARGIN, 24, { characterSpacing: 1.5 });
  doc
    .fillColor('#C4C4EB')
    .font('Helvetica')
    .fontSize(8)
    .text('CO–PO ATTAINMENT REPORT', PAGE_MARGIN, 49, { characterSpacing: 1.2 });
  doc
    .fillColor('#FFFFFF')
    .font('Helvetica-Bold')
    .fontSize(11)
    .text(`${course.code} · Section ${course.section}`, PAGE_MARGIN, 64);
  doc
    .fillColor('#C4C4EB')
    .font('Helvetica')
    .fontSize(9)
    .text(course.session.name, A4_WIDTH - PAGE_MARGIN - 160, 66, { width: 160, align: 'right' });

  doc.y = 112;
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(17).text(course.title);
  doc
    .fillColor(MUTED)
    .font('Helvetica')
    .fontSize(9)
    .text(`${course.program.name} · ${course.department.name}`);

  // ── Headline numbers ──────────────────────────────────────────────────────
  doc.moveDown(0.8);
  const statY = doc.y;
  const statWidth = CONTENT_WIDTH / 3;
  const stats: Array<[string, string, string]> = [
    ['Overall CO attainment', `${run.overallCO}%`, toneFor(run.overallCO, course.attainmentTarget)],
    ['Overall PO attainment', `${run.overallPO}%`, toneFor(run.overallPO, course.attainmentTarget)],
    ['Students assessed', String(course.studentCount), INK],
  ];

  doc.roundedRect(PAGE_MARGIN, statY, CONTENT_WIDTH, 54, 6).lineWidth(0.7).strokeColor(HAIRLINE).stroke();
  stats.forEach(([label, value, color], index) => {
    const x = PAGE_MARGIN + index * statWidth;
    if (index > 0) {
      doc.strokeColor(HAIRLINE).lineWidth(0.7).moveTo(x, statY + 8).lineTo(x, statY + 46).stroke();
    }
    doc
      .fillColor(MUTED)
      .font('Helvetica')
      .fontSize(7.5)
      .text(label.toUpperCase(), x + 14, statY + 12, { width: statWidth - 28, characterSpacing: 0.6 });
    doc
      .fillColor(color)
      .font('Courier-Bold')
      .fontSize(19)
      .text(value, x + 14, statY + 24, { width: statWidth - 28 });
  });
  doc.y = statY + 62;

  // ── Course information ────────────────────────────────────────────────────
  if (config.includeCourseInfo) {
    heading(doc, 'Course information');
    keyValueGrid(doc, [
      ['Course code', `${course.code} · Section ${course.section}`],
      ['Credit hours', String(course.credit)],
      ['Program', `${course.program.code} — ${course.program.degree}`],
      ['Department', course.department.name],
      ['Academic session', course.session.name],
      [
        'Course teacher',
        course.teacher ? `${course.teacher.firstName} ${course.teacher.lastName}` : 'Not assigned',
      ],
      ['Attainment threshold', `${course.attainmentThreshold}% per student`],
      ['Attainment target', `${course.attainmentTarget}% of students`],
      ['Students enrolled', String(course.studentCount)],
      ['Calculated on', new Date(run.calculatedAt).toDateString()],
    ]);
  }

  // ── Course Outcomes ───────────────────────────────────────────────────────
  if (config.includeCOList) {
    heading(doc, 'Course Outcomes');
    table(
      doc,
      [
        { label: 'CO', width: 48, mono: true },
        { label: 'Statement', width: CONTENT_WIDTH - 48 - 76 - 76 },
        { label: 'Mapped POs', width: 76, mono: true },
        { label: 'Target', width: 76, align: 'right', mono: true },
      ],
      outcomes.map((co) => [
        { text: co.code, color: BRAND },
        { text: co.statement },
        { text: co.mappedPOs.join(', ') || '—' },
        { text: `${co.target}%` },
      ]),
    );
  }

  // ── CO-PO matrix ──────────────────────────────────────────────────────────
  if (config.includeCOPOMatrix && matrix.pos.length > 0) {
    heading(doc, 'CO–PO mapping matrix');

    const strengths = new Map(
      matrix.entries.map((e) => [`${e.courseOutcomeId}:${e.programOutcomeId}`, e.strength]),
    );
    const firstColumn = 60;
    const cellWidth = Math.min(46, (CONTENT_WIDTH - firstColumn) / Math.max(1, matrix.pos.length));

    table(
      doc,
      [
        { label: 'CO / PO', width: firstColumn, mono: true },
        ...matrix.pos.map((po) => ({
          label: po.code,
          width: cellWidth,
          align: 'center' as const,
          mono: true,
        })),
      ],
      matrix.cos.map((co) => [
        { text: co.code, color: BRAND },
        ...matrix.pos.map((po) => {
          const strength = strengths.get(`${co.id}:${po.id}`) ?? 0;
          return { text: strength === 0 ? '–' : String(strength), color: strength === 0 ? MUTED : INK };
        }),
      ]),
    );

    doc
      .fillColor(MUTED)
      .font('Helvetica')
      .fontSize(7.5)
      .text('1 low · 2 medium · 3 high · – not mapped', PAGE_MARGIN, doc.y);
    doc.moveDown(0.4);
  }

  // ── CO attainment ─────────────────────────────────────────────────────────
  if (config.includeCOAttainment) {
    heading(doc, 'Course Outcome attainment');
    for (const co of run.co) {
      attainmentBar(doc, co.code, co.statement, co.attainment, co.target);
    }

    doc.moveDown(0.3);
    table(
      doc,
      [
        { label: 'CO', width: 48, mono: true },
        { label: 'Assessed', width: 68, align: 'right', mono: true },
        { label: 'At or above', width: 74, align: 'right', mono: true },
        { label: 'Mean score', width: 74, align: 'right', mono: true },
        { label: 'Attainment', width: 74, align: 'right', mono: true },
        { label: 'Target', width: 60, align: 'right', mono: true },
        { label: 'Status', width: CONTENT_WIDTH - 48 - 68 - 74 - 74 - 74 - 60, align: 'right' },
      ],
      run.co.map((co) => [
        { text: co.code, color: BRAND },
        { text: String(co.studentsAssessed) },
        { text: String(co.studentsAtOrAbove) },
        { text: `${co.averageScore}%` },
        { text: `${co.attainment}%`, color: toneFor(co.attainment, co.target) },
        { text: `${co.target}%` },
        {
          text:
            co.status === 'achieved'
              ? 'Achieved'
              : co.status === 'below-target'
                ? 'Below Target'
                : 'Not Started',
          color: co.status === 'achieved' ? GREEN : co.status === 'below-target' ? AMBER : MUTED,
        },
      ]),
    );
  }

  // ── PO attainment ─────────────────────────────────────────────────────────
  if (config.includePOAttainment && run.po.length > 0) {
    heading(doc, 'Program Outcome attainment');
    for (const po of run.po) {
      attainmentBar(doc, po.code, po.title, po.attainment, po.target);
    }

    doc.moveDown(0.3);
    table(
      doc,
      [
        { label: 'PO', width: 48, mono: true },
        { label: 'Contributing Course Outcomes', width: CONTENT_WIDTH - 48 - 74 - 60 - 88 },
        { label: 'Attainment', width: 74, align: 'right', mono: true },
        { label: 'Target', width: 60, align: 'right', mono: true },
        { label: 'Status', width: 88, align: 'right' },
      ],
      run.po.map((po) => [
        { text: po.code, color: BRAND },
        { text: po.contributingCOs.map((c) => `${c.code} (${c.strength})`).join(', ') || '—' },
        { text: `${po.attainment}%`, color: toneFor(po.attainment, po.target) },
        { text: `${po.target}%` },
        {
          text:
            po.status === 'achieved'
              ? 'Achieved'
              : po.status === 'below-target'
                ? 'Below Target'
                : 'Not Started',
          color: po.status === 'achieved' ? GREEN : po.status === 'below-target' ? AMBER : MUTED,
        },
      ]),
    );
  }

  // ── Gap analysis ──────────────────────────────────────────────────────────
  if (config.includeGapAnalysis) {
    heading(doc, 'Gap analysis');

    if (run.gaps.length === 0) {
      doc
        .fillColor(GREEN)
        .font('Helvetica')
        .fontSize(9.5)
        .text('Every Course Outcome and Program Outcome met its target. No gaps to report.');
      doc.moveDown(0.6);
    } else {
      for (const gap of run.gaps) {
        ensureSpace(doc, 74);
        const y = doc.y;

        doc.rect(PAGE_MARGIN, y, 2.5, 14).fill(AMBER);
        doc
          .fillColor(INK)
          .font('Helvetica-Bold')
          .fontSize(10)
          .text(`${gap.kind} ${gap.code}`, PAGE_MARGIN + 10, y);
        doc
          .fillColor(AMBER)
          .font('Courier-Bold')
          .fontSize(9.5)
          .text(
            `Gap ${gap.gap > 0 ? '+' : '−'}${Math.abs(gap.gap)}%`,
            A4_WIDTH - PAGE_MARGIN - 100,
            y + 1,
            { width: 100, align: 'right' },
          );

        doc
          .fillColor(MUTED)
          .font('Helvetica')
          .fontSize(8)
          .text(gap.label, PAGE_MARGIN + 10, y + 13, { width: CONTENT_WIDTH - 120 });

        doc.moveDown(0.35);
        for (const observation of gap.observations) {
          ensureSpace(doc, 16);
          doc
            .fillColor(BODY)
            .font('Helvetica')
            .fontSize(8.5)
            .text(`•  ${observation}`, PAGE_MARGIN + 12, doc.y, { width: CONTENT_WIDTH - 24 });
          doc.moveDown(0.12);
        }
        doc.moveDown(0.55);
      }

      ensureSpace(doc, 30);
      doc
        .fillColor(MUTED)
        .font('Helvetica-Oblique')
        .fontSize(8)
        .text(
          'These are observations drawn from the recorded marks. Interpretation and remedial planning remain with the course teacher.',
          PAGE_MARGIN,
          doc.y,
          { width: CONTENT_WIDTH },
        );
      doc.moveDown(0.5);
    }
  }

  // ── Student list ──────────────────────────────────────────────────────────
  if (config.includeStudentList && students.length > 0) {
    doc.addPage();
    heading(doc, 'Student performance');

    const coCodes = outcomes.map((co) => co.code);
    const coWidth = Math.min(44, (CONTENT_WIDTH - 78 - 132 - 62) / Math.max(1, coCodes.length));

    table(
      doc,
      [
        { label: 'Student ID', width: 78, mono: true },
        { label: 'Name', width: 132 },
        ...coCodes.map((code) => ({
          label: code,
          width: coWidth,
          align: 'right' as const,
          mono: true,
        })),
        {
          label: 'Total',
          width: CONTENT_WIDTH - 78 - 132 - coWidth * coCodes.length,
          align: 'right' as const,
          mono: true,
        },
      ],
      students.map((row) => [
        { text: row.student.studentId },
        { text: row.student.name },
        ...coCodes.map((code) => {
          const entry = row.perCO.find((c) => c.code === code);
          return {
            text: entry ? `${entry.percentage}%` : '—',
            color: entry?.meetsThreshold ? GREEN : AMBER,
          };
        }),
        { text: `${row.percentage}%`, color: INK },
      ]),
    );
  }

  // ── Signature block ───────────────────────────────────────────────────────
  ensureSpace(doc, 92);
  doc.moveDown(1.6);
  const signY = doc.y;
  doc
    .strokeColor('#98A2B3')
    .lineWidth(0.7)
    .moveTo(PAGE_MARGIN, signY)
    .lineTo(PAGE_MARGIN + 190, signY)
    .stroke();

  const signatory =
    config.signatoryName ||
    (course.teacher ? `${course.teacher.firstName} ${course.teacher.lastName}` : '');

  doc.fillColor(INK).font('Helvetica-Bold').fontSize(9.5).text(signatory || ' ', PAGE_MARGIN, signY + 6);
  doc
    .fillColor(MUTED)
    .font('Helvetica')
    .fontSize(8)
    .text(config.signatoryTitle || 'Course Teacher', PAGE_MARGIN, signY + 19);

  doc
    .fillColor(MUTED)
    .font('Helvetica')
    .fontSize(7.5)
    .text(
      `Generated ${new Date(report.generatedAt).toDateString()} by ${report.generatedByName} · Threshold method · Run ${run.id.slice(-8)}`,
      A4_WIDTH - PAGE_MARGIN - 260,
      signY + 6,
      { width: 260, align: 'right' },
    );

  // Page numbers across the whole document.
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    doc
      .fillColor(MUTED)
      .font('Helvetica')
      .fontSize(7.5)
      .text(
        `${course.code} · ${course.session.name} · Page ${i - range.start + 1} of ${range.count}`,
        PAGE_MARGIN,
        doc.page.height - PAGE_MARGIN + 10,
        { width: CONTENT_WIDTH, align: 'center' },
      );
  }

  doc.end();
  return done;
}
