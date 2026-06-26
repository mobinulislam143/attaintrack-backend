import 'dotenv/config';

// ─────────────────────────────────────────────────────────────────────────────
// Typed, validated environment configuration.
// Import `env` anywhere in the app — never read process.env directly.
// ─────────────────────────────────────────────────────────────────────────────

const REQUIRED_VARS = ['DATABASE_URL', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'] as const;

function assertEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
}

function getEnv(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

/** Call once at process startup — exits with code 1 on missing required vars. */
export function validateEnv(): void {
  const missing: string[] = [];
  for (const key of REQUIRED_VARS) {
    if (!process.env[key]) missing.push(key);
  }
  if (missing.length > 0) {
    console.error(`\n[env] FATAL — missing required environment variables:\n  ${missing.join('\n  ')}\n`);
    process.exit(1);
  }

  const optional = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'FRONTEND_URL'];
  for (const key of optional) {
    if (!process.env[key]) {
      console.warn(`[env] WARN — optional variable not set: ${key}`);
    }
  }
}

export const env = {
  // ── Server ────────────────────────────────────────────────────────────────
  port: parseInt(getEnv('PORT', '3000'), 10),
  nodeEnv: getEnv('NODE_ENV', 'development'),
  get isDev() { return this.nodeEnv === 'development'; },
  get isProd() { return this.nodeEnv === 'production'; },

  // ── Database ──────────────────────────────────────────────────────────────
  databaseUrl: assertEnv('DATABASE_URL'),

  // ── JWT ──────────────────────────────────────────────────────────────────
  jwtAccessSecret: assertEnv('JWT_ACCESS_SECRET'),
  jwtRefreshSecret: assertEnv('JWT_REFRESH_SECRET'),
  jwtAccessExpiresIn: getEnv('JWT_ACCESS_EXPIRES_IN', '15m'),
  jwtRefreshExpiresIn: getEnv('JWT_REFRESH_EXPIRES_IN', '7d'),

  // ── CORS ─────────────────────────────────────────────────────────────────
  frontendUrl: getEnv('FRONTEND_URL', 'http://localhost:3000'),

  // ── Email (nodemailer) ────────────────────────────────────────────────────
  smtpHost: process.env['SMTP_HOST'],
  smtpPort: parseInt(getEnv('SMTP_PORT', '587'), 10),
  smtpUser: process.env['SMTP_USER'],
  smtpPass: process.env['SMTP_PASS'],
  smtpFrom: getEnv('SMTP_FROM', 'noreply@example.com'),

  // ── Rate limiting ─────────────────────────────────────────────────────────
  rateLimitWindowMs: parseInt(getEnv('RATE_LIMIT_WINDOW_MS', '900000'), 10), // 15 min
  rateLimitMax: parseInt(getEnv('RATE_LIMIT_MAX', '100'), 10),
} as const;
