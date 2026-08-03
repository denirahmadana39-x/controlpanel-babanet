import { ROLE_CODES } from "@hosting/shared";
import {
  AppShell,
  AuthProvider,
  LoginPage,
  RequireAnonymous,
  RequireAuth,
  type NavItem,
} from "@hosting/ui";
import { createBrowserRouter, Outlet, RouterProvider } from "react-router";
import { DashboardPage } from "./pages/DashboardPage";
import { MonitoringPage } from "./pages/MonitoringPage";
import { ProjectDetailPage } from "./pages/ProjectDetailPage";
import { ProjectsPage } from "./pages/ProjectsPage";
import { UserDetailPage } from "./pages/UserDetailPage";
import { UsersPage } from "./pages/UsersPage";

const adminNav: NavItem[] = [
  { to: "/", label: "Dashboard", end: true },
  { to: "/users", label: "Users" },
  { to: "/projects", label: "Projects" },
  { to: "/monitoring", label: "Monitoring" },
];

function AdminLayout() {
  return (
    <AppShell brand="BabaHosting Admin" nav={adminNav}>
      <Outlet />
    </AppShell>
  );
}

const router = createBrowserRouter([
  {
    element: (
      <AuthProvider>
        <Outlet />
      </AuthProvider>
    ),
    children: [
      {
        element: <RequireAnonymous />,
        children: [{ path: "/login", element: <LoginPage brand="BabaHosting Admin" /> }],
      },
      {
        element: <RequireAuth allowRoles={[ROLE_CODES.admin]} />,
        children: [
          {
            element: <AdminLayout />,
            children: [
              { path: "/", element: <DashboardPage /> },
              { path: "/users", element: <UsersPage /> },
              { path: "/users/:id", element: <UserDetailPage /> },
              { path: "/projects", element: <ProjectsPage /> },
              { path: "/projects/:id", element: <ProjectDetailPage /> },
              { path: "/monitoring", element: <MonitoringPage /> },
            ],
          },
        ],
      },
    ],
  },
]);

function App() {
  return <RouterProvider router={router} />;
}

export default App;
