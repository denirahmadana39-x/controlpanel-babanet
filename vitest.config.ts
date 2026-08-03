import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

/**
 * Resolves ESM-style relative imports that reference ".js" to the existing
 * ".ts" source file (the repo's TypeScript sources use .js specifiers).
 */
function tsFromJsResolver() {
  return {
    name: "resolve-js-to-ts",
    resolveId(source: string, importer?: string) {
      if (!source.startsWith(".") || !source.endsWith(".js")) return undefined;
      if (!importer) return undefined;
      const base = resolve(dirname(importer), source);
      const candidates = [base, base.slice(0, -3) + ".ts", base.slice(0, -3) + ".tsx"];
      const match = candidates.find((candidate) => existsSync(candidate));
      return match;
    },
  };
}

export default defineConfig({
  resolve: {
    alias: {
      "@hosting/storage": fileURLToPath(
        new URL("./packages/storage/src/index.ts", import.meta.url),
      ),
      "@hosting/shared": fileURLToPath(new URL("./packages/shared/src/index.ts", import.meta.url)),
      "@hosting/nginx": fileURLToPath(new URL("./packages/nginx/src/index.ts", import.meta.url)),
      "@hosting/deploy": fileURLToPath(new URL("./packages/deploy/src/index.ts", import.meta.url)),
      "@hosting/monitoring": fileURLToPath(
        new URL("./packages/monitoring/src/index.ts", import.meta.url),
      ),
      "@hosting/logger": fileURLToPath(new URL("./packages/logger/src/index.ts", import.meta.url)),
      "@hosting/auth": fileURLToPath(new URL("./packages/auth/src/index.ts", import.meta.url)),
      "@hosting/errors": fileURLToPath(new URL("./packages/errors/src/index.ts", import.meta.url)),
    },
  },
  plugins: [tsFromJsResolver()],
  test: {
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts"],
    environment: "node",
    testTimeout: 30_000,
  },
});
