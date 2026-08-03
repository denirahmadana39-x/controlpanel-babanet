import type { ErrorCode } from "./codes.js";

export interface ErrorDetails {
  [key: string]: unknown;
}

export interface DomainErrorOptions {
  details?: ErrorDetails;
  requestId?: string;
}

/**
 * Base class for every platform error. All errors carry:
 * - `code`: stable machine-readable code
 * - `message`: human-readable description
 * - `details`: optional structured context (validation failures, constraints)
 * - `requestId`: correlation identifier attached by the transport layer
 * - `timestamp`: when the error was created (ISO 8601)
 */
export abstract class DomainError extends Error {
  abstract readonly code: ErrorCode | string;
  abstract readonly statusCode: number;
  readonly details: ErrorDetails | undefined;
  readonly requestId: string | undefined;
  readonly timestamp: string;

  constructor(message: string, options: DomainErrorOptions = {}) {
    super(message);
    this.name = new.target.name;
    this.details = options.details;
    this.requestId = options.requestId;
    this.timestamp = new Date().toISOString();
  }
}
