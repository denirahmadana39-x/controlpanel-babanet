import { create } from "zustand";
import { api, setCsrfToken } from "../lib/api";
import type { AuthUser, SessionResponse } from "../lib/types";

export type AuthStatus = "loading" | "authenticated" | "unauthenticated";

interface AuthState {
  user: AuthUser | null;
  status: AuthStatus;
  hydrate: () => Promise<void>;
  login: (email: string, password: string, rememberMe: boolean) => Promise<void>;
  logout: () => Promise<void>;
  updateUser: (user: AuthUser) => void;
}

function applySession(data: SessionResponse): { user: AuthUser } {
  setCsrfToken(data.csrfToken);
  return { user: data.user };
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  status: "loading",

  hydrate: async () => {
    try {
      const data = await api.get<SessionResponse>("/api/auth/me");
      set({ user: data.user, status: "authenticated" });
      setCsrfToken(data.csrfToken);
    } catch (error) {
      const { status } = error as { status?: number };
      if (status === 401) {
        set({ user: null, status: "unauthenticated" });
        return;
      }
      set({ user: null, status: "unauthenticated" });
    }
  },

  login: async (email, password, rememberMe) => {
    const data = await api.post<SessionResponse>("/api/auth/login", {
      email,
      password,
      rememberMe,
    });
    set(applySession(data));
  },

  logout: async () => {
    try {
      await api.post("/api/auth/logout");
    } finally {
      setCsrfToken(undefined);
      set({ user: null, status: "unauthenticated" });
    }
  },

  updateUser: (user) => set({ user }),
}));
