import { parse } from 'csv-parse/sync';
import { prisma } from '../../database/client';
import { generateSecureToken } from '../../common/crypto';
import { NotFoundError, UnprocessableError } from '../../common/errors';
import { recomputeStatus } from '../courses/courses.service';

// ─────────────────────────────────────────────────────────────────────────────
// Marks: the grid, and the CSV import that replaces the teacher's spreadsheet.
//
// Import is deliberately two-phase. Phase one parses, matches columns to
// questions and reports every fault with its row number; nothing is written.
// Phase two commits a staged upload by token. A teacher never discovers a bad
// row after it has already overwritten last week's marks.
// ─────────────────────────────────────────────────────────────────────────────

export interface GridQuestion {
  id: string;
  code: string;
  maxMarks: number;
  order: number;
  courseOutcomeCode: string | null;
}

export interface MarksGrid {
  assessment: { id: string; name: string; totalMarks: number; courseId: string; isPublished: boolean };
  questions: GridQuestion[];
  rows: Array<{
    student: { id: string; studentId: string; name: string };
    /** Keyed by question id. Null means not entered — distinct from a zero. */
    marks: Record<string, number | null>;
    total: number;
  }>;
}

export interface CsvValidationIssue {
  row: number;
  studentId: string | null;
  column: string | null;
  message: string;
  severity: 'error' | 'warning';
}

export interface CsvValidationResult {
  fileName: string;
  totalRows: number;
  validRows: number;
  detectedStudents: number;
  matchedColumns: Array<{ header: string; questionId: string | null }>;
  unmatchedHeaders: string[];
  issues: CsvValidationIssue[];
  /** Empty when the file cannot be committed at all. */
  uploadToken: string;
}

export interface CsvCommitResult {
  imported: number;
  updated: number;
  skipped: number;
}

/** Staged rows held in `MarksUpload.payload` between validate and commit. */
interface StagedRow {
  studentRecordId: string;
  values: Array<{ questionId: string; obtained: number | null }>;
}

const UPLOAD_TTL_MS = 60 * 60 * 1000; // 1 hour — long enough to review, short enough to expire

/** Column headers that identify the student rather than a question. */
const ID_HEADERS = ['studentid', 'student id', 'id', 'roll', 'roll no', 'registration', 'reg no'];
const NAME_HEADERS = ['name', 'student name', 'studentname'];

function normalise(header: string): string {
  return header.trim().toLowerCase().replace(/\s+/g, ' ');
}

export const marksService = {
  /** The spreadsheet the teacher types into. */
  async grid(assessmentId: string): Promise<MarksGrid> {
    const assessment = await prisma.assessment.findUnique({
      where: { id: assessmentId },
      include: {
        questions: {
          orderBy: { order: 'asc' },
          include: { courseOutcome: { select: { code: true } } },
        },
      },
    });
    if (!assessment) throw new NotFoundError('Assessment');

    const students = await prisma.student.findMany({
      where: { enrollments: { some: { courseId: assessment.courseId } } },
      orderBy: { studentId: 'asc' },
      select: { id: true, studentId: true, name: true },
    });

    const questionIds = assessment.questions.map((q) => q.id);
    const marks =
      questionIds.length === 0
        ? []
        : await prisma.mark.findMany({ where: { questionId: { in: questionIds } } });

    const byStudent = new Map<string, Map<string, number | null>>();
    for (const mark of marks) {
      if (!byStudent.has(mark.studentId)) byStudent.set(mark.studentId, new Map());
      byStudent.get(mark.studentId)!.set(mark.questionId, mark.obtained);
    }

    return {
      assessment: {
        id: assessment.id,
        name: assessment.name,
        totalMarks: assessment.totalMarks,
        courseId: assessment.courseId,
        isPublished: assessment.isPublished,
      },
      questions: assessment.questions.map((q) => ({
        id: q.id,
        code: q.code,
        maxMarks: q.maxMarks,
        order: q.order,
        courseOutcomeCode: q.courseOutcome?.code ?? null,
      })),
      rows: students.map((student) => {
        const own = byStudent.get(student.id) ?? new Map<string, number | null>();
        const marksRecord: Record<string, number | null> = {};
        let total = 0;
        for (const q of assessment.questions) {
          const value = own.get(q.id) ?? null;
          marksRecord[q.id] = value;
          if (value !== null) total += value;
        }
        return { student, marks: marksRecord, total };
      }),
    };
  },

  /** Save a batch of cell edits from the grid. */
  async save(
    assessmentId: string,
    entries: Array<{ studentId: string; questionId: string; obtained: number | null }>,
  ): Promise<{ saved: number }> {
    const assessment = await prisma.assessment.findUnique({
      where: { id: assessmentId },
      include: { questions: true },
    });
    if (!assessment) throw new NotFoundError('Assessment');

    const maxByQuestion = new Map(assessment.questions.map((q) => [q.id, q.maxMarks]));
    const enrolled = new Set(
      (
        await prisma.enrollment.findMany({
          where: { courseId: assessment.courseId },
          select: { studentId: true },
        })
      ).map((e) => e.studentId),
    );

    // Validate the whole batch before writing any of it.
    for (const entry of entries) {
      const max = maxByQuestion.get(entry.questionId);
      if (max === undefined) {
        throw new UnprocessableError('A mark references a question from another assessment');
      }
      if (!enrolled.has(entry.studentId)) {
        throw new UnprocessableError('A mark references a student not enrolled in this course');
      }
      if (entry.obtained !== null) {
        if (Number.isNaN(entry.obtained)) {
          throw new UnprocessableError('Marks must be numeric');
        }
        if (entry.obtained < 0) {
          throw new UnprocessableError('Marks cannot be negative');
        }
        if (entry.obtained > max) {
          const question = assessment.questions.find((q) => q.id === entry.questionId)!;
          throw new UnprocessableError(
            `${question.code} has a maximum mark of ${max}, but ${entry.obtained} was entered.`,
            'MARK_ABOVE_MAX',
          );
        }
      }
    }

    for (const entry of entries) {
      await prisma.mark.upsert({
        where: {
          questionId_studentId: { questionId: entry.questionId, studentId: entry.studentId },
        },
        create: {
          questionId: entry.questionId,
          studentId: entry.studentId,
          obtained: entry.obtained,
        },
        update: { obtained: entry.obtained },
      });
    }

    await recomputeStatus(assessment.courseId);
    return { saved: entries.length };
  },

  /** A CSV with the correct headers and one row per enrolled student. */
  async template(assessmentId: string): Promise<{ fileName: string; csv: string }> {
    const grid = await marksService.grid(assessmentId);
    const header = ['StudentID', 'Name', ...grid.questions.map((q) => q.code)];
    const lines = [header.join(',')];

    for (const row of grid.rows) {
      lines.push(
        [row.student.studentId, `"${row.student.name.replace(/"/g, '""')}"`, ...grid.questions.map(() => '')].join(
          ',',
        ),
      );
    }

    const safeName = grid.assessment.name.replace(/[^\w-]+/g, '-').toLowerCase();
    return { fileName: `${safeName}-marks-template.csv`, csv: lines.join('\r\n') };
  },

  // ── CSV import, phase one: validate ──────────────────────────────────────

  /**
   * Parse and check a CSV without writing anything. Every fault names the row,
   * the student and the column, because "Invalid input" is useless at row 22 of
   * 48.
   */
  async validateCsv(
    assessmentId: string,
    file: { originalname: string; buffer: Buffer },
    uploadedById: string,
  ): Promise<CsvValidationResult> {
    const assessment = await prisma.assessment.findUnique({
      where: { id: assessmentId },
      include: { questions: { orderBy: { order: 'asc' } } },
    });
    if (!assessment) throw new NotFoundError('Assessment');

    if (assessment.questions.length === 0) {
      throw new UnprocessableError(
        `${assessment.name} has no questions. Add questions before importing marks.`,
        'NO_QUESTIONS',
      );
    }

    let records: Record<string, string>[];
    try {
      records = parse(file.buffer, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        bom: true,
      }) as Record<string, string>[];
    } catch (err) {
      throw new UnprocessableError(
        `${file.originalname} could not be read as CSV. ${(err as Error).message}`,
        'CSV_UNPARSEABLE',
      );
    }

    const issues: CsvValidationIssue[] = [];
    const headers = records.length > 0 ? Object.keys(records[0]!) : [];

    if (headers.length === 0) {
      throw new UnprocessableError(`${file.originalname} is empty.`, 'CSV_EMPTY');
    }

    // ── Match headers to questions ─────────────────────────────────────────
    const questionByCode = new Map(assessment.questions.map((q) => [q.code.toLowerCase(), q]));
    const matchedColumns: Array<{ header: string; questionId: string | null }> = [];
    const unmatchedHeaders: string[] = [];

    let idHeader: string | null = null;
    for (const header of headers) {
      const key = normalise(header);
      if (idHeader === null && ID_HEADERS.includes(key)) {
        idHeader = header;
        matchedColumns.push({ header, questionId: null });
        continue;
      }
      if (NAME_HEADERS.includes(key)) {
        matchedColumns.push({ header, questionId: null });
        continue;
      }

      const question = questionByCode.get(key);
      if (question) {
        matchedColumns.push({ header, questionId: question.id });
      } else {
        unmatchedHeaders.push(header);
      }
    }

    if (!idHeader) {
      throw new UnprocessableError(
        `${file.originalname} has no student ID column. Expected a header named one of: ${ID_HEADERS.slice(0, 4).join(', ')}.`,
        'CSV_NO_ID_COLUMN',
      );
    }

    const matchedQuestionIds = new Set(
      matchedColumns.filter((c) => c.questionId).map((c) => c.questionId!),
    );
    const missingQuestions = assessment.questions.filter((q) => !matchedQuestionIds.has(q.id));
    for (const q of missingQuestions) {
      issues.push({
        row: 0,
        studentId: null,
        column: q.code,
        message: `${q.code} has no column in the file. Those marks will stay as they are.`,
        severity: 'warning',
      });
    }
    for (const header of unmatchedHeaders) {
      issues.push({
        row: 0,
        studentId: null,
        column: header,
        message: `Column "${header}" does not match any question in ${assessment.name}. It will be ignored.`,
        severity: 'warning',
      });
    }

    // ── Match rows to enrolled students ────────────────────────────────────
    const enrolled = await prisma.student.findMany({
      where: { enrollments: { some: { courseId: assessment.courseId } } },
      select: { id: true, studentId: true, name: true },
    });
    const studentByRegNo = new Map(enrolled.map((s) => [s.studentId.toLowerCase(), s]));

    const staged: StagedRow[] = [];
    const seen = new Set<string>();
    let validRows = 0;

    records.forEach((record, index) => {
      // +2: one for the header line, one because humans count from 1.
      const rowNumber = index + 2;
      const rawId = String(record[idHeader!] ?? '').trim();

      if (!rawId) {
        issues.push({
          row: rowNumber,
          studentId: null,
          column: idHeader,
          message: `Row ${rowNumber} has no student ID.`,
          severity: 'error',
        });
        return;
      }

      if (seen.has(rawId.toLowerCase())) {
        issues.push({
          row: rowNumber,
          studentId: rawId,
          column: idHeader,
          message: `Row ${rowNumber} — student ${rawId} appears more than once in the file.`,
          severity: 'error',
        });
        return;
      }
      seen.add(rawId.toLowerCase());

      const student = studentByRegNo.get(rawId.toLowerCase());
      if (!student) {
        issues.push({
          row: rowNumber,
          studentId: rawId,
          column: idHeader,
          message: `Row ${rowNumber} — student ${rawId} is not enrolled in this course.`,
          severity: 'error',
        });
        return;
      }

      const values: Array<{ questionId: string; obtained: number | null }> = [];
      let rowFailed = false;

      for (const column of matchedColumns) {
        if (!column.questionId) continue;

        const question = assessment.questions.find((q) => q.id === column.questionId)!;
        const raw = String(record[column.header] ?? '').trim();

        if (raw === '' || raw === '-') {
          values.push({ questionId: question.id, obtained: null });
          continue;
        }

        const value = Number(raw);
        if (Number.isNaN(value)) {
          issues.push({
            row: rowNumber,
            studentId: rawId,
            column: question.code,
            message: `Row ${rowNumber} — student ${rawId}, ${question.code} = "${raw}" is not a number.`,
            severity: 'error',
          });
          rowFailed = true;
          continue;
        }
        if (value < 0) {
          issues.push({
            row: rowNumber,
            studentId: rawId,
            column: question.code,
            message: `Row ${rowNumber} — student ${rawId}, ${question.code} = ${value} is negative.`,
            severity: 'error',
          });
          rowFailed = true;
          continue;
        }
        if (value > question.maxMarks) {
          issues.push({
            row: rowNumber,
            studentId: rawId,
            column: question.code,
            message: `Row ${rowNumber} — student ${rawId}, ${question.code} = ${value} (maximum ${question.maxMarks}).`,
            severity: 'error',
          });
          rowFailed = true;
          continue;
        }

        values.push({ questionId: question.id, obtained: value });
      }

      if (rowFailed) return;

      staged.push({ studentRecordId: student.id, values });
      validRows += 1;
    });

    // Students on the roster who are absent from the file.
    const importedIds = new Set(staged.map((s) => s.studentRecordId));
    const missingStudents = enrolled.filter((s) => !importedIds.has(s.id));
    if (missingStudents.length > 0 && missingStudents.length < enrolled.length) {
      issues.push({
        row: 0,
        studentId: null,
        column: null,
        message: `${missingStudents.length} enrolled student(s) are not in this file: ${missingStudents
          .slice(0, 5)
          .map((s) => s.studentId)
          .join(', ')}${missingStudents.length > 5 ? '…' : ''}. Their marks will stay as they are.`,
        severity: 'warning',
      });
    }

    // ── Stage the upload ───────────────────────────────────────────────────
    const hasErrors = issues.some((i) => i.severity === 'error');
    let uploadToken = '';

    if (!hasErrors && staged.length > 0) {
      uploadToken = generateSecureToken(24);
      await prisma.marksUpload.create({
        data: {
          token: uploadToken,
          courseId: assessment.courseId,
          assessmentId,
          fileName: file.originalname,
          uploadedById,
          payload: staged as unknown as object,
          expiresAt: new Date(Date.now() + UPLOAD_TTL_MS),
        },
      });
    }

    return {
      fileName: file.originalname,
      totalRows: records.length,
      validRows,
      detectedStudents: seen.size,
      matchedColumns,
      unmatchedHeaders,
      issues,
      uploadToken,
    };
  },

  // ── CSV import, phase two: commit ────────────────────────────────────────

  async commitCsv(uploadToken: string): Promise<CsvCommitResult> {
    const upload = await prisma.marksUpload.findUnique({ where: { token: uploadToken } });
    if (!upload) {
      throw new NotFoundError('Staged upload. Upload the file again', 'UPLOAD_NOT_FOUND');
    }
    if (upload.expiresAt < new Date()) {
      await prisma.marksUpload.delete({ where: { id: upload.id } });
      throw new UnprocessableError(
        'This upload expired after an hour. Upload the file again.',
        'UPLOAD_EXPIRED',
      );
    }

    const rows = upload.payload as unknown as StagedRow[];
    const result: CsvCommitResult = { imported: 0, updated: 0, skipped: 0 };

    for (const row of rows) {
      for (const value of row.values) {
        const existing = await prisma.mark.findUnique({
          where: {
            questionId_studentId: {
              questionId: value.questionId,
              studentId: row.studentRecordId,
            },
          },
        });

        if (existing) {
          if (existing.obtained === value.obtained) {
            result.skipped += 1;
            continue;
          }
          await prisma.mark.update({ where: { id: existing.id }, data: { obtained: value.obtained } });
          result.updated += 1;
        } else {
          await prisma.mark.create({
            data: {
              questionId: value.questionId,
              studentId: row.studentRecordId,
              obtained: value.obtained,
            },
          });
          result.imported += 1;
        }
      }
    }

    await prisma.marksUpload.delete({ where: { id: upload.id } });
    await recomputeStatus(upload.courseId);

    return result;
  },

  /** Housekeeping — drop staged uploads nobody committed. */
  async purgeExpiredUploads(): Promise<number> {
    const { count } = await prisma.marksUpload.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    return count;
  },
};
