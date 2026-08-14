import { Request, Response } from 'express';
import { reportsService, ReportConfig } from './reports.service';
import { renderReportPdf } from './reports.pdf';
import { renderReportExcel } from './reports.excel';
import { sendSuccess, sendCreated, sendNoContent } from '../../common/response';
import { BadRequestError } from '../../common/errors';
import { requireCourseAccess, requireCourseOwnership } from '../../common/scope';

export async function listReports(req: Request, res: Response): Promise<void> {
  const courseId = req.query['courseId'] ? String(req.query['courseId']) : '';
  if (!courseId) throw new BadRequestError('courseId is required', 'COURSE_ID_REQUIRED');

  await requireCourseAccess(req.user!, courseId);
  sendSuccess(res, await reportsService.listByCourse(courseId), 'Reports');
}

export async function generateReport(req: Request, res: Response): Promise<void> {
  const { courseId, runId, config } = req.body as {
    courseId: string;
    runId?: string;
    config?: Partial<ReportConfig>;
  };
  if (!courseId) throw new BadRequestError('courseId is required', 'COURSE_ID_REQUIRED');

  await requireCourseOwnership(req.user!, courseId);

  const report = await reportsService.generate(courseId, req.user!.id, config ?? {}, runId);
  sendCreated(res, report, 'Report generated');
}

export async function getReport(req: Request, res: Response): Promise<void> {
  const payload = await reportsService.payload(String(req.params['id']));
  await requireCourseAccess(req.user!, payload.course.id);
  sendSuccess(res, payload, 'Report');
}

export async function deleteReport(req: Request, res: Response): Promise<void> {
  const payload = await reportsService.payload(String(req.params['id']));
  await requireCourseOwnership(req.user!, payload.course.id);
  await reportsService.delete(String(req.params['id']));
  sendNoContent(res);
}

export async function exportPdf(req: Request, res: Response): Promise<void> {
  const payload = await reportsService.payload(String(req.params['id']));
  await requireCourseAccess(req.user!, payload.course.id);

  const buffer = await renderReportPdf(payload);
  const fileName = `${reportsService.fileStem(payload)}-attainment-report.pdf`;

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  res.setHeader('Content-Length', buffer.length);
  res.status(200).end(buffer);
}

export async function exportExcel(req: Request, res: Response): Promise<void> {
  const payload = await reportsService.payload(String(req.params['id']));
  await requireCourseAccess(req.user!, payload.course.id);

  const buffer = await renderReportExcel(payload);
  const fileName = `${reportsService.fileStem(payload)}-attainment-report.xlsx`;

  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  res.setHeader('Content-Length', buffer.length);
  res.status(200).end(buffer);
}
