import { describe, expect, it } from "vitest";
import {
  ENGINE_EXTENSIONS,
  ENGINE_LIMITS,
  extensionOf,
  isAllowedStaticFile,
  isHiddenPath,
} from "./engine.js";

describe("extensionOf", () => {
  it("extracts the lowercase extension", () => {
    expect(extensionOf("index.HTML")).toBe("html");
    expect(extensionOf("style.css")).toBe("css");
    expect(extensionOf("a/b/c/main.js")).toBe("js");
  });

  it("returns empty for extensionless or dot-files", () => {
    expect(extensionOf("README")).toBe("");
    expect(extensionOf(".gitignore")).toBe("");
  });
});

describe("isAllowedStaticFile", () => {
  it("allows known static extensions", () => {
    for (const extension of ["html", "css", "js", "png", "svg", "woff2", "webp"]) {
      expect(isAllowedStaticFile(`file.${extension}`), extension).toBe(true);
    }
  });

  it("allows extensionless files", () => {
    expect(isAllowedStaticFile("README")).toBe(true);
    expect(isAllowedStaticFile("assets/favicon")).toBe(true);
  });

  it("rejects executable/server-side extensions", () => {
    for (const extension of ENGINE_EXTENSIONS.FORBIDDEN) {
      expect(isAllowedStaticFile(`shell.${extension}`), extension).toBe(false);
    }
  });

  it("rejects unknown extensions", () => {
    expect(isAllowedStaticFile("script.rb")).toBe(false);
    expect(isAllowedStaticFile("evil.php5")).toBe(false);
  });
});

describe("isHiddenPath", () => {
  it("detects dot-prefixed segments", () => {
    expect(isHiddenPath(".env")).toBe(true);
    expect(isHiddenPath("config/.secret")).toBe(true);
    expect(isHiddenPath("ok/visible.txt")).toBe(false);
    expect(isHiddenPath("a/.well-known/token")).toBe(true);
  });
});

describe("ENGINE_LIMITS", () => {
  it("exposes sane defaults", () => {
    expect(ENGINE_LIMITS.MAX_UPLOAD_SIZE_MB).toBe(100);
    expect(ENGINE_LIMITS.VERSION_RETENTION).toBe(5);
  });
});
