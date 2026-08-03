import argon2 from "argon2";
import { PASSWORD_POLICY } from "@hosting/shared";

const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

const DUMMY_PASSWORD_HASH =
  "$argon2id$v=19$m=19456,p=1,t=2$gksxPgkBtCvRlmePXofi4A$1fNuQfnZ+4+V2FZVXXC07/nTgYlJ7nIME87D2IYaM3M";

export interface PasswordValidationResult {
  ok: boolean;
  errors: string[];
}

export function validatePassword(password: string): PasswordValidationResult {
  const errors: string[] = [];
  if (password.length < PASSWORD_POLICY.minLength) {
    errors.push(`Password must be at least ${PASSWORD_POLICY.minLength} characters`);
  }
  if (password.length > PASSWORD_POLICY.maxLength) {
    errors.push(`Password must be at most ${PASSWORD_POLICY.maxLength} characters`);
  }
  if (PASSWORD_POLICY.requireUppercase && !/[A-Z]/.test(password)) {
    errors.push("Password must contain at least one uppercase letter");
  }
  if (PASSWORD_POLICY.requireLowercase && !/[a-z]/.test(password)) {
    errors.push("Password must contain at least one lowercase letter");
  }
  if (PASSWORD_POLICY.requireDigit && !/\d/.test(password)) {
    errors.push("Password must contain at least one number");
  }
  return { ok: errors.length === 0, errors };
}

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  return argon2.verify(passwordHash, password);
}

/**
 * Runs an argon2 verification against a fixed dummy hash so that failed logins
 * for unknown users take the same time as failed logins for known users,
 * mitigating user-enumeration via response timing.
 */
export async function verifyDummyPassword(password: string): Promise<void> {
  await argon2.verify(DUMMY_PASSWORD_HASH, password);
}
