export const PASSWORD_POLICY = {
  minLength: 8,
  maxLength: 128,
  requireUppercase: true,
  requireLowercase: true,
  requireDigit: true,
} as const;

export const PASSWORD_REQUIREMENTS: readonly string[] = [
  `At least ${PASSWORD_POLICY.minLength} characters`,
  `At most ${PASSWORD_POLICY.maxLength} characters`,
  "At least one uppercase letter",
  "At least one lowercase letter",
  "At least one number",
] as const;
