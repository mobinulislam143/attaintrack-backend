import { scrypt, randomBytes, timingSafeEqual } from 'crypto';
import { promisify } from 'util';

// ─────────────────────────────────────────────────────────────────────────────
// Cryptographic helpers using Node.js built-in `crypto` module.
// Uses scrypt (RFC 7914) for password hashing — more memory-hard than bcrypt.
// ─────────────────────────────────────────────────────────────────────────────

const scryptAsync = promisify(scrypt);
const SALT_BYTES = 32;
const KEY_BYTES = 64;

/**
 * Hash a plain-text password using scrypt + random salt.
 * Returns a `salt:hash` string safe to store in the database.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES).toString('hex');
  const derivedKey = (await scryptAsync(password, salt, KEY_BYTES)) as Buffer;
  return `${salt}:${derivedKey.toString('hex')}`;
}

/**
 * Verify a plain-text password against a stored `salt:hash` string.
 * Uses a timing-safe comparison to prevent timing attacks.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, storedKey] = stored.split(':');
  if (!salt || !storedKey) return false;
  const derivedKey = (await scryptAsync(password, salt, KEY_BYTES)) as Buffer;
  const storedBuffer = Buffer.from(storedKey, 'hex');
  if (derivedKey.length !== storedBuffer.length) return false;
  return timingSafeEqual(derivedKey, storedBuffer);
}

/**
 * Generate a cryptographically secure random hex token.
 * Default length is 32 bytes (64 hex characters).
 */
export function generateSecureToken(bytes = 32): string {
  return randomBytes(bytes).toString('hex');
}

/**
 * Generate a random 6-digit numeric OTP.
 */
export function generateOtp(): string {
  const bytes = randomBytes(4);
  const num = bytes.readUInt32BE(0) % 1_000_000;
  return num.toString().padStart(6, '0');
}
