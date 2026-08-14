import { Request, Response } from 'express';
import { sessionsService } from './sessions.service';
import { sendSuccess, sendCreated, sendNoContent } from '../../common/response';
import { Validator } from '../../common/validator';

interface SessionBody {
  name: string;
  startDate: string;
  endDate: string;
  isActive?: boolean;
}

export async function listSessions(_req: Request, res: Response): Promise<void> {
  sendSuccess(res, await sessionsService.list(), 'Academic sessions');
}

export async function getActiveSession(_req: Request, res: Response): Promise<void> {
  sendSuccess(res, await sessionsService.findActive(), 'Active session');
}

export async function getSession(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await sessionsService.findById(String(req.params['id'])), 'Academic session');
}

export async function createSession(req: Request, res: Response): Promise<void> {
  const v = new Validator(req.body);
  v.required('name').maxLength('name', 60);
  v.required('startDate');
  v.required('endDate');
  v.throw();

  const session = await sessionsService.create(req.body as SessionBody);
  sendCreated(res, session, `${session.name} created`);
}

export async function updateSession(req: Request, res: Response): Promise<void> {
  const v = new Validator(req.body);
  v.maxLength('name', 60);
  v.throw();

  const session = await sessionsService.update(
    String(req.params['id']),
    req.body as Partial<SessionBody>,
  );
  sendSuccess(res, session, `${session.name} updated`);
}

export async function activateSession(req: Request, res: Response): Promise<void> {
  const session = await sessionsService.activate(String(req.params['id']));
  sendSuccess(res, session, `${session.name} is now the active session`);
}

export async function deleteSession(req: Request, res: Response): Promise<void> {
  await sessionsService.delete(String(req.params['id']));
  sendNoContent(res);
}
