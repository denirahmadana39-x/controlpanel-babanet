import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  platform: "node",
  target: "node20",
  clean: true,
  sourcemap: true,
  noExternal: [/^@hosting\//],
  external: ["argon2", "@prisma/client", "@prisma/adapter-pg", "adm-zip", "mime-types"],
});
