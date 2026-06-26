import 'dotenv/config';
import { validateEnv } from './config/env';

// Validate environment variables before importing anything that reads them
validateEnv();

import { env } from './config/env';
import { logger } from './common/logger';
import { connectDB, disconnectDB } from './database/client';
import app from './app';

// ─────────────────────────────────────────────────────────────────────────────
// Server entry point.
// Connects the database then starts listening for HTTP requests.
// Handles graceful shutdown on SIGTERM / SIGINT.
// ─────────────────────────────────────────────────────────────────────────────

async function start(): Promise<void> {
  await connectDB();

  const server = app.listen(env.port, () => {
    logger.info('server', `Server running on http://localhost:${env.port} [${env.nodeEnv}]`);
    logger.info('server', `API base: http://localhost:${env.port}/api/v1`);
  });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info('server', `${signal} received — shutting down gracefully`);
    server.close(async () => {
      await disconnectDB();
      logger.info('server', 'Server closed.');
      process.exit(0);
    });

    // Force-exit if connections do not drain within 10 s
    setTimeout(() => {
      logger.error('server', 'Forced shutdown after timeout');
      process.exit(1);
    }, 10_000).unref();
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    logger.error('server', 'Unhandled promise rejection', reason);
  });

  process.on('uncaughtException', (err) => {
    logger.error('server', 'Uncaught exception', err);
    process.exit(1);
  });
}

start().catch((err) => {
  logger.error('server', 'Fatal startup error', err);
  process.exit(1);
});
