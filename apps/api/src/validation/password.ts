import { PASSWORD_POLICY } from "@hosting/shared";
import { validatePassword } from "@hosting/auth";
import { z } from "zod";

export const strongPasswordSchema = z
  .string()
  .min(PASSWORD_POLICY.minLength)
  .max(PASSWORD_POLICY.maxLength)
  .refine((value) => validatePassword(value).ok, {
    message: "Password must be 8-128 characters and include uppercase, lowercase and a number",
  });
