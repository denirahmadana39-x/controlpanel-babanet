import { describe, expect, it } from "vitest";
import { projectLockKey, projectLockKeyPair } from "./project-lock.js";

describe("projectLockKey", () => {
  it("returns a stable unsigned 32-bit hash", () => {
    const first = projectLockKey("59eb4d08-0b93-4c63-a48d-3afd7cb6a78d");
    const second = projectLockKey("59eb4d08-0b93-4c63-a48d-3afd7cb6a78d");
    expect(first).toBe(second);
    expect(first).toBeGreaterThanOrEqual(0);
    expect(first).toBeLessThanOrEqual(0xffffffff);
  });

  it("distinguishes different project ids", () => {
    const a = projectLockKey("project-aaaa");
    const b = projectLockKey("project-bbbb");
    expect(a).not.toBe(b);
  });
});

describe("projectLockKeyPair", () => {
  it("is stable for the same project id", () => {
    const first = projectLockKeyPair("59eb4d08-0b93-4c63-a48d-3afd7cb6a78d");
    const second = projectLockKeyPair("59eb4d08-0b93-4c63-a48d-3afd7cb6a78d");
    expect(first).toEqual(second);
  });

  it("produces two distinct signed 32-bit keys for pg_advisory_xact_lock(int4, int4)", () => {
    const key = projectLockKeyPair("59eb4d08-0b93-4c63-a48d-3afd7cb6a78d");
    expect(Number.isInteger(key.a)).toBe(true);
    expect(Number.isInteger(key.b)).toBe(true);
    expect(key.a).toBeGreaterThanOrEqual(-0x80000000);
    expect(key.a).toBeLessThanOrEqual(0x7fffffff);
    expect(key.b).toBeGreaterThanOrEqual(-0x80000000);
    expect(key.b).toBeLessThanOrEqual(0x7fffffff);
  });

  it("distinguishes different project ids", () => {
    const a = projectLockKeyPair("project-aaaa");
    const b = projectLockKeyPair("project-bbbb");
    expect(a).not.toEqual(b);
  });
});
