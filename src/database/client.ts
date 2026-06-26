import { PrismaClient } from '../generated/prisma';
import { env } from '../config/env';
import { logger } from '../common/logger';

// ─────────────────────────────────────────────────────────────────────────────
// Prisma singleton.
// The global trick prevents multiple client instances during hot-reload in dev.
// ─────────────────────────────────────────────────────────────────────────────

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

export const prisma: PrismaClient =
  global.__prisma ??
  new PrismaClient({
    log: env.isDev ? ['query', 'warn', 'error'] : ['warn', 'error'],
  });

// Always store — prevents multiple PrismaClient instances in serverless (Vercel/Lambda)
global.__prisma = prisma;

/**
 * Connect to the database.  Call once at server startup.
 */
export async function connectDB(): Promise<void> {
  await prisma.$connect();
  logger.info('database', 'MongoDB connected via Prisma');
}

/**
 * Disconnect gracefully.  Call during shutdown.
 */
export async function disconnectDB(): Promise<void> {
  await prisma.$disconnect();
  logger.info('database', 'MongoDB disconnected');
}
