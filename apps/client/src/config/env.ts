import { z } from "zod";

const envSchema = z.object({
  VITE_APP_NAME: z.string().min(1).default("Client"),
  VITE_API_URL: z.string().url().optional(),
});

export type ClientEnv = z.infer<typeof envSchema>;

export const env = envSchema.parse(import.meta.env);
