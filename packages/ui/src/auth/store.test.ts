import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAuthStore } from "./store";
import type { SessionResponse } from "../lib/types";

vi.mock("../lib/api", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
  setCsrfToken: vi.fn(),
}));

import { api } from "../lib/api";

const session: SessionResponse = {
  user: {
    id: "user-1",
    email: "client@example.com",
    displayName: "Client User",
    sessionId: "session-1",
    roles: ["client"],
    permissions: ["project:create"],
  },
  csrfToken: "csrf-token-1",
  expiresIn: 3600,
};

describe("useAuthStore.login", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ user: null, status: "unauthenticated" });
  });

  it("enters the authenticated state after a successful login", async () => {
    vi.mocked(api.post).mockResolvedValue(session);

    await useAuthStore.getState().login("client@example.com", "password", false);

    expect(useAuthStore.getState().status).toBe("authenticated");
    expect(useAuthStore.getState().user).toEqual(session.user);
  });

  it("stays unauthenticated when login fails", async () => {
    vi.mocked(api.post).mockRejectedValue(new Error("Invalid credentials"));

    await expect(
      useAuthStore.getState().login("client@example.com", "wrong", false),
    ).rejects.toThrow("Invalid credentials");

    expect(useAuthStore.getState().status).toBe("unauthenticated");
    expect(useAuthStore.getState().user).toBeNull();
  });
});
