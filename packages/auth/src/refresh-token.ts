import { createHash, createHmac, randomBytes } from "node:crypto";

const REFRESH_TOKEN_BYTES = 32;

export interface GeneratedRefreshToken {
  token: string;
  tokenHash: string;
}

export function generateRefreshToken(secret?: string): GeneratedRefreshToken {
  const token = randomBytes(REFRESH_TOKEN_BYTES).toString("base64url");
  return { token, tokenHash: hashRefreshToken(token, secret) };
}

export function hashRefreshToken(token: string, secret?: string): string {
  if (secret) {
    return createHmac("sha256", secret).update(token).digest("hex");
  }
  return createHash("sha256").update(token).digest("hex");
}
