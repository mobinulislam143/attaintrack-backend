import { Request, Response } from 'express';
import { dashboardService } from './dashboard.service';
import { sendSuccess } from '../../common/response';

export async function getMyDashboard(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await dashboardService.forUser(req.user!), 'Dashboard');
}

export async function getTeacherDashboard(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await dashboardService.teacher(req.user!), 'Teacher dashboard');
}

export async function getAdminDashboard(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await dashboardService.admin(req.user!), 'Admin dashboard');
}

export async function getStudentDashboard(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await dashboardService.student(req.user!), 'Student dashboard');
}
