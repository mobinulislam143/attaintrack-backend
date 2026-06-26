// ─────────────────────────────────────────────────────────────────────────────
// Centralized HTTP error hierarchy.
// Throw these anywhere in the app; the global error handler will catch them.
// ─────────────────────────────────────────────────────────────────────────────

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly isOperational: boolean;

  constructor(message: string, statusCode: number, code: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true;
    Object.setPrototypeOf(this, new.target.prototype);
    Error.captureStackTrace(this, this.constructor);
  }
}

export class BadRequestError extends AppError {
  constructor(message = 'Bad request', code = 'BAD_REQUEST') {
    super(message, 400, code);
  }
}

export class ValidationError extends AppError {
  readonly errors: Record<string, string>;

  constructor(errors: Record<string, string>, message = 'Validation failed') {
    super(message, 422, 'VALIDATION_ERROR');
    this.errors = errors;
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required', code = 'UNAUTHORIZED') {
    super(message, 401, code);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Access denied', code = 'FORBIDDEN') {
    super(message, 403, code);
  }
}

export class NotFoundError extends AppError {
  constructor(resource = 'Resource', code = 'NOT_FOUND') {
    super(`${resource} not found`, 404, code);
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Resource already exists', code = 'CONFLICT') {
    super(message, 409, code);
  }
}

export class UnprocessableError extends AppError {
  constructor(message = 'Unprocessable entity', code = 'UNPROCESSABLE') {
    super(message, 422, code);
  }
}

export class TooManyRequestsError extends AppError {
  constructor(message = 'Too many requests', code = 'RATE_LIMIT_EXCEEDED') {
    super(message, 429, code);
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message = 'Service temporarily unavailable', code = 'SERVICE_UNAVAILABLE') {
    super(message, 503, code);
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}

export function isValidationError(err: unknown): err is ValidationError {
  return err instanceof ValidationError;
}
