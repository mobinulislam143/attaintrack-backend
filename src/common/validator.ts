import { ValidationError } from './errors';

// ─────────────────────────────────────────────────────────────────────────────
// Minimal validation DSL — no external dependencies.
// Usage:
//   const v = new Validator(req.body);
//   v.required('email').email('email');
//   v.required('password').minLength('password', 8);
//   v.throw();
// ─────────────────────────────────────────────────────────────────────────────

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const STRONG_PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])/;

export class Validator {
  private readonly data: Record<string, unknown>;
  private readonly errs: Record<string, string> = {};

  constructor(data: unknown) {
    this.data = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  }

  private get(field: string): unknown {
    return this.data[field];
  }

  private add(field: string, message: string): this {
    if (!this.errs[field]) this.errs[field] = message;
    return this;
  }

  /** Field must be present and non-empty. */
  required(field: string, label = field): this {
    const v = this.get(field);
    if (v === undefined || v === null || v === '') {
      this.add(field, `${label} is required`);
    }
    return this;
  }

  /** Field must be a valid email address. */
  email(field: string, label = field): this {
    const v = this.get(field);
    if (v !== undefined && v !== '' && !EMAIL_REGEX.test(String(v))) {
      this.add(field, `${label} must be a valid email address`);
    }
    return this;
  }

  /** Field must be a string with a minimum length. */
  minLength(field: string, min: number, label = field): this {
    const v = this.get(field);
    if (v !== undefined && String(v).length < min) {
      this.add(field, `${label} must be at least ${min} characters`);
    }
    return this;
  }

  /** Field must be a string with a maximum length. */
  maxLength(field: string, max: number, label = field): this {
    const v = this.get(field);
    if (v !== undefined && String(v).length > max) {
      this.add(field, `${label} must be at most ${max} characters`);
    }
    return this;
  }

  /** Password must meet complexity requirements. */
  strongPassword(field: string, label = field): this {
    const v = String(this.get(field) ?? '');
    if (v && !STRONG_PASSWORD_REGEX.test(v)) {
      this.add(
        field,
        `${label} must contain uppercase, lowercase, number, and special character (@$!%*?&)`,
      );
    }
    return this;
  }

  /** Two fields must match (e.g. password confirmation). */
  matches(field: string, otherField: string, label = field): this {
    if (this.get(field) !== this.get(otherField)) {
      this.add(field, `${label} does not match`);
    }
    return this;
  }

  /** Field must be a non-empty string when present. */
  string(field: string, label = field): this {
    const v = this.get(field);
    if (v !== undefined && typeof v !== 'string') {
      this.add(field, `${label} must be a string`);
    }
    return this;
  }

  /** Field must be one of the allowed values. */
  oneOf(field: string, allowed: readonly string[], label = field): this {
    const v = this.get(field);
    if (v !== undefined && !allowed.includes(String(v))) {
      this.add(field, `${label} must be one of: ${allowed.join(', ')}`);
    }
    return this;
  }

  /** Add a custom validation rule. */
  custom(field: string, condition: boolean, message: string): this {
    if (!condition) this.add(field, message);
    return this;
  }

  /** Returns true if there are no validation errors. */
  isValid(): boolean {
    return Object.keys(this.errs).length === 0;
  }

  /** Throw a ValidationError if any errors were recorded. */
  throw(): void {
    if (!this.isValid()) throw new ValidationError(this.errs);
  }

  /** Return the current error map (for inspection without throwing). */
  errors(): Record<string, string> {
    return { ...this.errs };
  }
}
