import { describe, expect, it } from "vitest";
import { join, resolve } from "node:path";
import {
  assertPathInside,
  PathTraversalError,
  safeJoin,
  sanitizeRelativeZipPath,
  toPosixPath,
} from "./paths.js";

describe("safeJoin", () => {
  it("joins nested paths", () => {
    expect(safeJoin("/root", "a/b/c")).toBe(resolve("/root/a/b/c"));
  });

  it("normalizes away dot segments", () => {
    expect(safeJoin("/root", "./a/../b")).toBe(resolve("/root/b"));
  });

  it("strips leading slashes from relative input", () => {
    expect(safeJoin("/root", "/etc/passwd")).toBe(resolve("/root/etc/passwd"));
  });

  it("rejects traversal", () => {
    expect(() => safeJoin("/root", "../escape")).toThrow(PathTraversalError);
    expect(() => safeJoin("/root", "a/../../../escape")).toThrow(PathTraversalError);
  });
});

describe("assertPathInside", () => {
  it("allows paths inside the root", () => {
    expect(assertPathInside("/root", "/root/file.txt")).toBe(resolve("/root/file.txt"));
  });

  it("rejects absolute escape", () => {
    expect(() => assertPathInside("/root", "/etc/passwd")).toThrow(PathTraversalError);
  });
});

describe("sanitizeRelativeZipPath", () => {
  it("replaces backslashes and strips leading slashes", () => {
    expect(sanitizeRelativeZipPath("a\\b\\c.txt")).toBe("a/b/c.txt");
    expect(sanitizeRelativeZipPath("/a/b.txt")).toBe("a/b.txt");
  });

  it("collapses empty and dot segments", () => {
    expect(sanitizeRelativeZipPath("./a//b/./c.txt")).toBe("a/b/c.txt");
  });

  it("rejects traversal segments", () => {
    expect(() => sanitizeRelativeZipPath("../escape.txt")).toThrow(PathTraversalError);
    expect(() => sanitizeRelativeZipPath("a/../../escape.txt")).toThrow(PathTraversalError);
  });

  it("rejects NUL bytes", () => {
    expect(() => sanitizeRelativeZipPath("a\u0000b.txt")).toThrow(PathTraversalError);
  });
});

describe("toPosixPath", () => {
  it("converts OS separators to forward slashes", () => {
    expect(toPosixPath(join("a", "b", "c"))).toBe("a/b/c");
    expect(toPosixPath("already/posix")).toBe("already/posix");
  });
});
