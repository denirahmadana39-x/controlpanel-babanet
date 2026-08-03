import type { ReactNode } from "react";
import { Navigate, Outlet, useLocation } from "react-router";
import { useAuthStore } from "../auth/store";

export function RequireAuth({ allowRoles }: { allowRoles?: string[] }): ReactNode {
  const status = useAuthStore((state) => state.status);
  const user = useAuthStore((state) => state.user);
  const location = useLocation();

  if (status === "loading") return null;
  if (status !== "authenticated" || !user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  if (allowRoles && !user.roles.some((role) => allowRoles.includes(role))) {
    return <Navigate to="/" replace />;
  }
  return <Outlet />;
}

export function RequireAnonymous(): ReactNode {
  const status = useAuthStore((state) => state.status);
  if (status === "authenticated") return <Navigate to="/" replace />;
  return <Outlet />;
}
