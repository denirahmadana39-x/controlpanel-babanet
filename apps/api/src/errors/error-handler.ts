import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { Prisma } from "@hosting/database";
import { isDomainError } from "@hosting/errors";

interface FastifyErrorLike {
  statusCode?: number;
  code?: string;
  message: string;
  validation?: unknown[];
}

/**
 * Unified error handler. Every error response shares the shape
 * `{ error: { code, message, requestId, timestamp, details? } }` and carries a
 * `x-request-id` header for end-to-end correlation.
 */
export function createErrorHandler(app: FastifyInstance) {
  return (error: Error, request: FastifyRequest, reply: FastifyReply): void => {
    const requestId = request.id;
    const send = (statusCode: number, code: string, message: string, details?: unknown): void => {
      const body: Record<string, unknown> = {
        code,
        message,
        requestId,
        timestamp: new Date().toISOString(),
      };
      if (details !== undefined) {
        body.details = details;
      }
      reply.status(statusCode).header("x-request-id", requestId).send({ error: body });
    };

    if (isDomainError(error)) {
      send(error.statusCode, error.code, error.message, error.details);
      return;
    }

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2002") {
        send(409, "CONFLICT", "Resource already exists");
        return;
      }
      if (error.code === "P2025") {
        send(404, "NOT_FOUND", "Resource not found");
        return;
      }
    }

    const fastifyError = error as FastifyErrorLike;
    if (typeof fastifyError.statusCode === "number" && fastifyError.statusCode < 500) {
      send(
        fastifyError.statusCode,
        fastifyError.code ?? "BAD_REQUEST",
        fastifyError.message,
        fastifyError.validation !== undefined ? { validation: fastifyError.validation } : undefined,
      );
      return;
    }

    app.log.error(error, "unhandled error");
    send(500, "INTERNAL_ERROR", "Internal server error");
  };
}
