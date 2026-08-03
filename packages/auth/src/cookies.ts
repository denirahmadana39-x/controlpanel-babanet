export const COOKIE_NAMES = {
  accessToken: "access_token",
  refreshToken: "refresh_token",
  csrfToken: "csrf_token",
} as const;

export type CookieSameSite = "lax" | "strict" | "none";

export interface CookieOptions {
  path: string;
  httpOnly: boolean;
  secure: boolean;
  sameSite: CookieSameSite;
  maxAge: number;
}

export interface CreateCookieOptionsInput {
  httpOnly: boolean;
  secure: boolean;
  sameSite: CookieSameSite;
  maxAge: number;
}

export function createCookieOptions(input: CreateCookieOptionsInput): CookieOptions {
  return {
    path: "/",
    httpOnly: input.httpOnly,
    secure: input.secure,
    sameSite: input.sameSite,
    maxAge: input.maxAge,
  };
}
