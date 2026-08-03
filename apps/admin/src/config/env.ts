import { z } from "zod";

const envSchema = z.object({
  VITE_APP_NAME: z.string().min(1).default("Admin"),
  VITE_API_URL: z.string().url().optional(),
});

export type AdminEnv = z.infer<typeof envSchema>;

export const env = envSchema.parse(import.meta.env);
