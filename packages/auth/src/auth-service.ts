import {
  createAccessTokenHandler,
  type AccessTokenClaims,
  type AccessTokenHandler,
} from "./access-token.js";
import {
  createCookieOptions,
  COOKIE_NAMES,
  type CookieOptions,
  type CookieSameSite,
} from "./cookies.js";
import { generateCsrfToken, validateCsrfToken } from "./csrf.js";
import { hashPassword, verifyPassword } from "./password.js";
import {
  generateRefreshToken,
  hashRefreshToken,
  type GeneratedRefreshToken,
} from "./refresh-token.js";

export interface AuthConfig {
  accessToken: {
    secret: string;
    issuer: string;
    audience: string;
    ttl: string;
  };
  refreshToken: {
    secret: string;
  };
  cookies: {
    secure: boolean;
    sameSite: CookieSameSite;
    accessTokenMaxAgeSeconds: number;
    sessionMaxAgeSeconds: number;
    rememberMeSessionMaxAgeSeconds: number;
  };
}

export interface AuthService {
  hashPassword(password: string): Promise<string>;
  verifyPassword(password: string, passwordHash: string): Promise<boolean>;
  signAccessToken(claims: AccessTokenClaims): Promise<string>;
  verifyAccessToken(token: string): Promise<AccessTokenClaims>;
  generateRefreshToken(): GeneratedRefreshToken;
  hashRefreshToken(token: string): string;
  generateCsrfToken(): string;
  validateCsrfToken(provided: string, expected: string): boolean;
  cookieNames: typeof COOKIE_NAMES;
  accessTokenCookieOptions(): CookieOptions;
  refreshTokenCookieOptions(maxAgeSeconds: number): CookieOptions;
  csrfCookieOptions(maxAgeSeconds: number): CookieOptions;
  sessionExpirySeconds(rememberMe: boolean): number;
}

export function createAuthService(config: AuthConfig): AuthService {
  const accessToken: AccessTokenHandler = createAccessTokenHandler(config.accessToken);

  const cookieBase = {
    httpOnly: true,
    secure: config.cookies.secure,
    sameSite: config.cookies.sameSite,
  };

  return {
    hashPassword,
    verifyPassword,
    signAccessToken: accessToken.sign,
    verifyAccessToken: accessToken.verify,
    generateRefreshToken: () => generateRefreshToken(config.refreshToken.secret),
    hashRefreshToken: (token: string) => hashRefreshToken(token, config.refreshToken.secret),
    generateCsrfToken,
    validateCsrfToken,
    cookieNames: COOKIE_NAMES,
    accessTokenCookieOptions: () =>
      createCookieOptions({ ...cookieBase, maxAge: config.cookies.accessTokenMaxAgeSeconds }),
    refreshTokenCookieOptions: (maxAgeSeconds: number) =>
      createCookieOptions({ ...cookieBase, maxAge: maxAgeSeconds }),
    csrfCookieOptions: (maxAgeSeconds: number) =>
      createCookieOptions({ ...cookieBase, maxAge: maxAgeSeconds }),
    sessionExpirySeconds: (rememberMe: boolean) =>
      rememberMe
        ? config.cookies.rememberMeSessionMaxAgeSeconds
        : config.cookies.sessionMaxAgeSeconds,
  };
}
