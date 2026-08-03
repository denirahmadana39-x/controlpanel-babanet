import { ErrorCodes } from "./codes.js";
import { DomainError, type DomainErrorOptions, type ErrorDetails } from "./domain-error.js";

export class ValidationError extends DomainError {
  readonly code = ErrorCodes.VALIDATION_ERROR;
  readonly statusCode = 400;

  constructor(message: string, options?: DomainErrorOptions) {
    super(message, options);
  }
}

export class AuthenticationError extends DomainError {
  readonly code = ErrorCodes.AUTHENTICATION_ERROR;
  readonly statusCode = 401;

  constructor(message: string, options?: DomainErrorOptions) {
    super(message, options);
  }
}

export class AuthorizationError extends DomainError {
  readonly code = ErrorCodes.AUTHORIZATION_ERROR;
  readonly statusCode = 403;

  constructor(message: string, options?: DomainErrorOptions) {
    super(message, options);
  }
}

export class NotFoundError extends DomainError {
  readonly code = ErrorCodes.NOT_FOUND;
  readonly statusCode = 404;

  constructor(message: string, options?: DomainErrorOptions) {
    super(message, options);
  }
}

export class ConflictError extends DomainError {
  readonly code = ErrorCodes.CONFLICT;
  readonly statusCode = 409;

  constructor(message: string, options?: DomainErrorOptions) {
    super(message, options);
  }
}

export class RateLimitedError extends DomainError {
  readonly code = ErrorCodes.RATE_LIMITED;
  readonly statusCode = 429;

  constructor(message: string, options?: DomainErrorOptions) {
    super(message, options);
  }
}

export class PayloadTooLargeError extends DomainError {
  readonly code = ErrorCodes.PAYLOAD_TOO_LARGE;
  readonly statusCode = 413;

  constructor(message: string, options?: DomainErrorOptions) {
    super(message, options);
  }
}

export class InternalError extends DomainError {
  readonly code = ErrorCodes.INTERNAL_ERROR;
  readonly statusCode = 500;

  constructor(message: string, options?: DomainErrorOptions) {
    super(message, options);
  }
}

export class DeploymentError extends DomainError {
  readonly code = ErrorCodes.DEPLOYMENT_ERROR;
  readonly statusCode = 422;

  constructor(message: string, options?: DomainErrorOptions) {
    super(message, options);
  }
}

export class StorageError extends DomainError {
  readonly code = ErrorCodes.STORAGE_ERROR;
  readonly statusCode = 500;

  constructor(message: string, options?: DomainErrorOptions) {
    super(message, options);
  }
}

export class WorkerError extends DomainError {
  readonly code = ErrorCodes.WORKER_ERROR;
  readonly statusCode = 500;

  constructor(message: string, options?: DomainErrorOptions) {
    super(message, options);
  }
}

export class NginxError extends DomainError {
  readonly code = ErrorCodes.NGINX_ERROR;
  readonly statusCode = 500;

  constructor(message: string, options?: DomainErrorOptions) {
    super(message, options);
  }
}

export class DatabaseError extends DomainError {
  readonly code = ErrorCodes.DATABASE_ERROR;
  readonly statusCode = 500;

  constructor(message: string, options?: DomainErrorOptions) {
    super(message, options);
  }
}

/**
 * Backward-compatible generic error carrying an explicit HTTP status and
 * arbitrary code. Preserves the original `(statusCode, code, message, details)`
 * contract used by route handlers while adding `requestId`/`timestamp`.
 */
export class AppError extends DomainError {
  readonly statusCode: number;
  readonly code: string;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    details?: ErrorDetails,
    requestId?: string,
  ) {
    super(message, {
      ...(details !== undefined ? { details } : {}),
      ...(requestId !== undefined ? { requestId } : {}),
    });
    this.statusCode = statusCode;
    this.code = code;
  }
}

export function isDomainError(error: unknown): error is DomainError {
  return error instanceof DomainError;
}
