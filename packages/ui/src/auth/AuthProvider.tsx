import type { ReactNode } from "react";
import { useEffect } from "react";
import type { SessionResponse } from "../lib/types";
import { useAuthStore } from "./store";

export function AuthProvider({ children }: { children: ReactNode }): ReactNode {
  const hydrate = useAuthStore((state) => state.hydrate);
  const status = useAuthStore((state) => state.status);
  const updateUser = useAuthStore((state) => state.updateUser);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    const handleRefresh = (event: Event): void => {
      updateUser((event as CustomEvent<SessionResponse>).detail.user);
    };
    window.addEventListener("session:refresh", handleRefresh);
    return () => window.removeEventListener("session:refresh", handleRefresh);
  }, [updateUser]);

  if (status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-400">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-slate-700 border-t-indigo-400" />
      </div>
    );
  }

  return children;
}
