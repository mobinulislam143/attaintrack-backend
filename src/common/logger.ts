import { env } from '../config/env';

// ─────────────────────────────────────────────────────────────────────────────
// Lightweight structured logger.
// Output: [ISO-TIMESTAMP] [LEVEL] [context] message
// In production, replace this with Winston or Pino for JSON output + log drains.
// ─────────────────────────────────────────────────────────────────────────────

type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';

function format(level: LogLevel, context: string, message: string): string {
  return `[${new Date().toISOString()}] [${level}] [${context}] ${message}`;
}

function serialize(extra?: unknown): string {
  if (extra === undefined) return '';
  if (extra instanceof Error) return ` — ${extra.message}${env.isDev ? `\n${extra.stack}` : ''}`;
  try { return ` — ${JSON.stringify(extra)}`; } catch { return ''; }
}

export const logger = {
  info(context: string, message: string, extra?: unknown): void {
    console.info(format('INFO', context, message) + serialize(extra));
  },

  warn(context: string, message: string, extra?: unknown): void {
    console.warn(format('WARN', context, message) + serialize(extra));
  },

  error(context: string, message: string, extra?: unknown): void {
    console.error(format('ERROR', context, message) + serialize(extra));
  },

  debug(context: string, message: string, extra?: unknown): void {
    if (env.isDev) {
      console.debug(format('DEBUG', context, message) + serialize(extra));
    }
  },
};
