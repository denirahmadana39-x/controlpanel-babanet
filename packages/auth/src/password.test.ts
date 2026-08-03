import { describe, expect, it } from "vitest";
import { hashPassword, validatePassword, verifyPassword } from "./password.js";

describe("validatePassword", () => {
  it("accepts a strong password", () => {
    const result = validatePassword("StrongPass123");
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("rejects a short password", () => {
    const result = validatePassword("Ab1");
    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => error.includes("8"))).toBe(true);
  });

  it("rejects a password without an uppercase letter", () => {
    const result = validatePassword("lowercase123");
    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => error.includes("uppercase"))).toBe(true);
  });

  it("rejects a password without a digit", () => {
    const result = validatePassword("NoDigitsHere");
    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => error.includes("number"))).toBe(true);
  });

  it("rejects an over-long password", () => {
    const result = validatePassword(`${"Aa1".repeat(50)}Zz9`);
    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => error.includes("128"))).toBe(true);
  });
});

describe("hashPassword / verifyPassword", () => {
  it("verifies a correct password and rejects a wrong one", async () => {
    const hash = await hashPassword("StrongPass123");
    expect(await verifyPassword("StrongPass123", hash)).toBe(true);
    expect(await verifyPassword("WrongPass123", hash)).toBe(false);
  });
});
