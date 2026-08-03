import {
  AppShell,
  AuthProvider,
  LoginPage,
  RequireAnonymous,
  RequireAuth,
  type NavItem,
} from "@hosting/ui";
import { createBrowserRouter, Outlet, RouterProvider } from "react-router";
import { ProjectDetailPage } from "./pages/ProjectDetailPage";
import { ProjectsPage } from "./pages/ProjectsPage";
import { SettingsPage } from "./pages/SettingsPage";

const clientNav: NavItem[] = [
  { to: "/", label: "My Projects", end: true },
  { to: "/settings", label: "Settings" },
];

function ClientLayout() {
  return (
    <AppShell brand="BabaHosting" nav={clientNav}>
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
        children: [{ path: "/login", element: <LoginPage brand="BabaHosting" /> }],
      },
      {
        element: <RequireAuth />,
        children: [
          {
            element: <ClientLayout />,
            children: [
              { path: "/", element: <ProjectsPage /> },
              { path: "/projects/:id", element: <ProjectDetailPage /> },
              { path: "/settings", element: <SettingsPage /> },
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
