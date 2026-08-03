import type { ReactNode } from "react";
import { NavLink, useNavigate } from "react-router";
import { useAuthStore } from "../auth/store";
import { Button } from "../components/primitives";

export interface NavItem {
  to: string;
  label: string;
  end?: boolean;
}

export function AppShell({
  brand,
  nav,
  children,
}: {
  brand: string;
  nav: NavItem[];
  children: ReactNode;
}) {
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const navigate = useNavigate();

  const handleLogout = async (): Promise<void> => {
    await logout();
    navigate("/login");
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="flex min-h-screen">
        <aside className="fixed inset-y-0 left-0 flex w-60 flex-col border-r border-slate-800 bg-slate-900/40">
          <div className="flex h-14 items-center border-b border-slate-800 px-5">
            <span className="text-sm font-bold tracking-tight text-slate-100">{brand}</span>
          </div>
          <nav className="flex-1 space-y-1 overflow-y-auto p-3">
            {nav.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                {...(item.end !== undefined ? { end: item.end } : {})}
                className={({ isActive }) =>
                  `block rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    isActive
                      ? "bg-indigo-500/15 text-indigo-300"
                      : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          {user ? (
            <div className="border-t border-slate-800 p-4">
              <div className="mb-3 min-w-0">
                <p className="truncate text-sm font-medium text-slate-200">{user.displayName}</p>
                <p className="truncate text-xs text-slate-500">{user.email}</p>
              </div>
              <Button variant="secondary" onClick={() => void handleLogout()} className="w-full">
                Sign out
              </Button>
            </div>
          ) : null}
        </aside>
        <main className="ml-60 flex-1 px-8 py-8">{children}</main>
      </div>
    </div>
  );
}
