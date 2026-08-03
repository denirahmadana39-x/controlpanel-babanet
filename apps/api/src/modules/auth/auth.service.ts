import {
  COOKIE_NAMES,
  validateCsrfToken,
  validatePassword,
  verifyDummyPassword,
  type AccessTokenClaims,
} from "@hosting/auth";
import type { UserWithRoles } from "@hosting/database";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { AppError } from "../../errors/app-error.js";
import type { AuthUser } from "../../types/fastify.js";

const CSRF_HEADER_NAME = "x-csrf-token";

export interface SessionResult {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: AuthUser;
}

export class AuthService {
  constructor(private readonly deps: FastifyInstance) {}

  sessionExpirySeconds(rememberMe: boolean): number {
    return this.deps.auth.sessionExpirySeconds(rememberMe);
  }

  async login(
    email: string,
    password: string,
    rememberMe: boolean,
    request: FastifyRequest,
  ): Promise<SessionResult> {
    const userRecord = await this.deps.db.users.findByEmail(email);
    if (!userRecord) {
      await verifyDummyPassword(password);
      await this.deps.audit.audit(
        {
          action: "login_failed",
          entityType: "user",
          success: false,
          metadata: { email, reason: "user_not_found" },
        },
        request,
      );
      throw new AppError(401, "INVALID_CREDENTIALS", "Invalid credentials");
    }
    const passwordValid = await this.deps.auth.verifyPassword(password, userRecord.passwordHash);
    if (!passwordValid) {
      await this.deps.audit.audit(
        {
          userId: userRecord.id,
          action: "login_failed",
          entityType: "user",
          entityId: userRecord.id,
          success: false,
          metadata: { email, reason: "invalid_password" },
        },
        request,
      );
      throw new AppError(401, "INVALID_CREDENTIALS", "Invalid credentials");
    }
    if (!userRecord.isActive) {
      await this.deps.audit.audit(
        {
          userId: userRecord.id,
          action: "login_failed",
          entityType: "user",
          entityId: userRecord.id,
          success: false,
          metadata: { email, reason: "account_disabled" },
        },
        request,
      );
      throw new AppError(403, "ACCOUNT_DISABLED", "Account is disabled");
    }

    const result = await this.issueSession(userRecord, rememberMe, request);
    await this.deps.audit.audit(
      {
        userId: userRecord.id,
        action: "login",
        entityType: "session",
        entityId: result.user.sessionId,
        success: true,
        metadata: { email, rememberMe },
      },
      request,
    );
    return result;
  }

  async refresh(refreshToken: string, request: FastifyRequest): Promise<SessionResult> {
    const record = await this.deps.db.refreshTokens.findByTokenHash(
      this.deps.auth.hashRefreshToken(refreshToken),
    );
    if (!record) {
      await this.deps.audit.audit(
        {
          action: "refresh_failed",
          entityType: "session",
          success: false,
          metadata: { reason: "token_not_found" },
        },
        request,
      );
      throw new AppError(401, "INVALID_REFRESH_TOKEN", "Invalid refresh token");
    }
    if (record.revokedAt) {
      await this.deps.db.refreshTokens.revokeAllForSession(record.sessionId);
      await this.deps.db.sessions.revoke(record.sessionId);
      await this.deps.audit.audit(
        {
          userId: record.userId,
          action: "refresh_token_reuse",
          entityType: "session",
          entityId: record.sessionId,
          success: false,
        },
        request,
      );
      throw new AppError(401, "INVALID_REFRESH_TOKEN", "Invalid refresh token");
    }
    if (record.expiresAt.getTime() <= Date.now()) {
      await this.deps.audit.audit(
        {
          userId: record.userId,
          action: "refresh_failed",
          entityType: "session",
          entityId: record.sessionId,
          success: false,
          metadata: { reason: "expired" },
        },
        request,
      );
      throw new AppError(401, "INVALID_REFRESH_TOKEN", "Invalid refresh token");
    }
    const session = await this.deps.db.sessions.findById(record.sessionId);
    if (!session || session.revokedAt || session.expiresAt.getTime() <= Date.now()) {
      throw new AppError(401, "INVALID_REFRESH_TOKEN", "Invalid refresh token");
    }
    const userRecord = await this.deps.db.users.findById(record.userId);
    if (!userRecord || !userRecord.isActive) {
      throw new AppError(401, "INVALID_REFRESH_TOKEN", "Invalid refresh token");
    }

    const rotated = this.deps.auth.generateRefreshToken();
    const next = await this.deps.db.refreshTokens.create({
      tokenHash: rotated.tokenHash,
      sessionId: record.sessionId,
      userId: record.userId,
      expiresAt: record.expiresAt,
    });
    await this.deps.db.refreshTokens.markRotated(record.id, next.id);
    await this.deps.db.sessions.updateLastUsed(record.sessionId);

    const accessToken = await this.deps.auth.signAccessToken({
      userId: userRecord.id,
      sessionId: session.id,
    });
    await this.deps.audit.audit(
      {
        userId: userRecord.id,
        action: "token_refreshed",
        entityType: "session",
        entityId: session.id,
        success: true,
      },
      request,
    );
    return {
      accessToken,
      refreshToken: rotated.token,
      expiresIn: Math.max(0, Math.floor((session.expiresAt.getTime() - Date.now()) / 1000)),
      user: this.toAuthUser(userRecord, session.id),
    };
  }

  async logout(refreshToken: string | undefined, request: FastifyRequest): Promise<void> {
    if (!refreshToken) {
      return;
    }
    const record = await this.deps.db.refreshTokens.findByTokenHash(
      this.deps.auth.hashRefreshToken(refreshToken),
    );
    if (!record) {
      return;
    }
    await this.deps.db.refreshTokens.revoke(record.id);
    await this.deps.db.sessions.revoke(record.sessionId);
    await this.deps.audit.audit(
      {
        userId: record.userId,
        action: "logout",
        entityType: "session",
        entityId: record.sessionId,
        success: true,
      },
      request,
    );
  }

  async changePassword(
    userId: string,
    sessionId: string,
    currentPassword: string,
    newPassword: string,
    request: FastifyRequest,
  ): Promise<void> {
    const userRecord = await this.deps.db.users.findById(userId);
    if (!userRecord) {
      throw new AppError(404, "NOT_FOUND", "User not found");
    }
    const currentValid = await this.deps.auth.verifyPassword(
      currentPassword,
      userRecord.passwordHash,
    );
    if (!currentValid) {
      await this.deps.audit.audit(
        {
          userId,
          action: "password_change_failed",
          entityType: "user",
          entityId: userId,
          success: false,
          metadata: { reason: "invalid_current_password" },
        },
        request,
      );
      throw new AppError(400, "INVALID_CURRENT_PASSWORD", "Current password is incorrect");
    }
    const policy = validatePassword(newPassword);
    if (!policy.ok) {
      throw new AppError(400, "WEAK_PASSWORD", policy.errors.join("; "));
    }
    const passwordHash = await this.deps.auth.hashPassword(newPassword);
    await this.deps.db.users.update(userId, { passwordHash });
    await this.deps.db.sessions.revokeAllForUserExcept(userId, sessionId);
    await this.deps.audit.audit(
      { userId, action: "password_changed", entityType: "user", entityId: userId, success: true },
      request,
    );
    await this.deps.audit.activity({
      userId,
      action: "password_changed",
      entityType: "user",
      entityId: userId,
    });
  }

  async authenticate(request: FastifyRequest): Promise<void> {
    const cookieToken = request.cookies?.[COOKIE_NAMES.accessToken];
    const authorization = request.headers.authorization?.replace(/^Bearer\s+/i, "");
    const accessToken = cookieToken ?? authorization;
    if (!accessToken) {
      return;
    }
    let claims: AccessTokenClaims;
    try {
      claims = await this.deps.auth.verifyAccessToken(accessToken);
    } catch {
      return;
    }
    const session = await this.deps.db.sessions.findById(claims.sessionId);
    if (!session || session.revokedAt || session.expiresAt.getTime() <= Date.now()) {
      return;
    }
    const userRecord = await this.deps.db.users.findById(claims.userId);
    if (!userRecord || !userRecord.isActive) {
      return;
    }
    request.authVia = cookieToken ? "cookie" : "header";
    request.user = this.toAuthUser(userRecord, session.id);
  }

  validateCsrf(request: FastifyRequest): void {
    const provided = request.headers[CSRF_HEADER_NAME];
    const expected = request.cookies?.[COOKIE_NAMES.csrfToken];
    if (typeof provided !== "string" || !expected || !validateCsrfToken(provided, expected)) {
      throw new AppError(403, "INVALID_CSRF_TOKEN", "Invalid CSRF token");
    }
  }

  setSessionCookies(
    reply: FastifyReply,
    accessToken: string,
    refreshToken: string,
    sessionMaxAgeSeconds: number,
  ): string {
    reply.setCookie(
      COOKIE_NAMES.accessToken,
      accessToken,
      this.deps.auth.accessTokenCookieOptions(),
    );
    reply.setCookie(
      COOKIE_NAMES.refreshToken,
      refreshToken,
      this.deps.auth.refreshTokenCookieOptions(sessionMaxAgeSeconds),
    );
    return this.rotateCsrf(reply, sessionMaxAgeSeconds);
  }

  rotateCsrf(reply: FastifyReply, sessionMaxAgeSeconds: number): string {
    const csrfToken = this.deps.auth.generateCsrfToken();
    reply.setCookie(
      COOKIE_NAMES.csrfToken,
      csrfToken,
      this.deps.auth.csrfCookieOptions(sessionMaxAgeSeconds),
    );
    return csrfToken;
  }

  clearSessionCookies(reply: FastifyReply): void {
    reply.clearCookie(COOKIE_NAMES.accessToken);
    reply.clearCookie(COOKIE_NAMES.refreshToken);
    reply.clearCookie(COOKIE_NAMES.csrfToken);
  }

  private async issueSession(
    userRecord: UserWithRoles,
    rememberMe: boolean,
    request: FastifyRequest,
  ): Promise<SessionResult> {
    const sessionMaxAgeSeconds = this.deps.auth.sessionExpirySeconds(rememberMe);
    const session = await this.deps.db.sessions.create({
      userId: userRecord.id,
      ipAddress: request.ip,
      userAgent: request.headers["user-agent"] ?? null,
      expiresAt: new Date(Date.now() + sessionMaxAgeSeconds * 1000),
    });
    const rotated = this.deps.auth.generateRefreshToken();
    await this.deps.db.refreshTokens.create({
      tokenHash: rotated.tokenHash,
      sessionId: session.id,
      userId: userRecord.id,
      expiresAt: session.expiresAt,
    });
    const accessToken = await this.deps.auth.signAccessToken({
      userId: userRecord.id,
      sessionId: session.id,
    });
    return {
      accessToken,
      refreshToken: rotated.token,
      expiresIn: sessionMaxAgeSeconds,
      user: this.toAuthUser(userRecord, session.id),
    };
  }

  private toAuthUser(userRecord: UserWithRoles, sessionId: string): AuthUser {
    const roles = userRecord.roles.map((userRole) => userRole.role.code);
    const permissions = Array.from(
      new Set(
        userRecord.roles.flatMap((userRole) =>
          userRole.role.permissions.map((entry) => entry.permission.code),
        ),
      ),
    );
    return {
      id: userRecord.id,
      email: userRecord.email,
      displayName: userRecord.displayName,
      sessionId,
      roles,
      permissions,
    };
  }
}

export function createAuthService(deps: FastifyInstance): AuthService {
  return new AuthService(deps);
}
