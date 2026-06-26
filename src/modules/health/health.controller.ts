import { Request, Response } from 'express';
import { prisma } from '../../database/client';
import { sendSuccess } from '../../common/response';

// ─────────────────────────────────────────────────────────────────────────────
// Health check endpoint.  Used by load balancers, uptime monitors, and CI.
// ─────────────────────────────────────────────────────────────────────────────

const START_TIME = Date.now();

export async function healthCheck(req: Request, res: Response): Promise<void> {
  let dbStatus: 'ok' | 'error' = 'ok';

  try {
    // Lightweight ping — does not read/write any collection
    await prisma.$runCommandRaw({ ping: 1 });
  } catch {
    dbStatus = 'error';
  }

  const uptimeSeconds = Math.floor((Date.now() - START_TIME) / 1000);
  const status = dbStatus === 'ok' ? 'ok' : 'degraded';

  sendSuccess(
    res,
    {
      status,
      uptime: uptimeSeconds,
      database: dbStatus,
      version: process.env['npm_package_version'] ?? '1.0.0',
      timestamp: new Date().toISOString(),
    },
    'Health check',
    dbStatus === 'ok' ? 200 : 503,
  );
}
