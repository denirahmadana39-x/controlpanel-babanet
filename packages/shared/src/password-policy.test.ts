import { describe, expect, it } from "vitest";
import { PASSWORD_POLICY, PASSWORD_REQUIREMENTS } from "./password-policy.js";

describe("PASSWORD_POLICY", () => {
  it("requires 8-128 chars with upper, lower and digit", () => {
    expect(PASSWORD_POLICY.minLength).toBe(8);
    expect(PASSWORD_POLICY.maxLength).toBe(128);
    expect(PASSWORD_POLICY.requireUppercase).toBe(true);
    expect(PASSWORD_POLICY.requireLowercase).toBe(true);
    expect(PASSWORD_POLICY.requireDigit).toBe(true);
  });

  it("documents requirements", () => {
    expect(PASSWORD_REQUIREMENTS.length).toBeGreaterThanOrEqual(4);
  });
});
