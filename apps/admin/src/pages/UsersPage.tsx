import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  api,
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Field,
  Input,
  Spinner,
  formatDateTime,
  type AdminUser,
  type UserListResponse,
} from "@hosting/ui";
import { useState } from "react";
import { Link } from "react-router";

export function UsersPage() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["users"],
    queryFn: () => api.get<UserListResponse>("/api/users"),
  });

  const [showCreate, setShowCreate] = useState(false);
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const createUser = useMutation({
    mutationFn: (body: { email: string; displayName: string; password: string }) =>
      api.post("/api/users", body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["users"] });
      setShowCreate(false);
      setEmail("");
      setDisplayName("");
      setPassword("");
      setError(null);
    },
    onError: (caught) => {
      setError(caught instanceof Error ? caught.message : "Failed to create user");
    },
  });

  const users = query.data?.users ?? [];

  const handleCreate = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setError(null);
    createUser.mutate({ email, displayName, password });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Users</h1>
          <p className="mt-1 text-sm text-slate-400">Manage accounts and access</p>
        </div>
        <Button onClick={() => setShowCreate((value) => !value)}>
          {showCreate ? "Cancel" : "Add user"}
        </Button>
      </div>

      {showCreate ? (
        <Card>
          <CardHeader
            title="Create user"
            description="The user will be able to sign in immediately"
          />
          <CardBody>
            <form onSubmit={handleCreate} className="grid max-w-2xl gap-4 sm:grid-cols-2">
              {error ? (
                <div className="sm:col-span-2">
                  <Alert>{error}</Alert>
                </div>
              ) : null}
              <Field label="Email">
                <Input
                  type="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="user@example.com"
                />
              </Field>
              <Field label="Display name">
                <Input
                  required
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  placeholder="Jane Doe"
                />
              </Field>
              <Field
                label="Temporary password"
                hint="At least 8 characters with mixed case and a number"
              >
                <Input
                  type="password"
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </Field>
              <div className="flex items-end">
                <Button type="submit" loading={createUser.isPending}>
                  Create user
                </Button>
              </div>
            </form>
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardBody className="p-0">
          {query.isLoading ? (
            <div className="flex justify-center py-12">
              <Spinner />
            </div>
          ) : users.length === 0 ? (
            <EmptyState title="No users" description="Create your first user to get started." />
          ) : (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-800 text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-5 py-3 font-medium">User</th>
                  <th className="px-5 py-3 font-medium">Roles</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {users.map((user: AdminUser) => (
                  <tr key={user.id} className="hover:bg-slate-800/40">
                    <td className="px-5 py-3">
                      <Link to={`/users/${user.id}`} className="block hover:text-indigo-300">
                        <p className="font-medium text-slate-200">{user.displayName}</p>
                        <p className="text-xs text-slate-500">{user.email}</p>
                      </Link>
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex gap-1.5">
                        {user.roles.map((role) => (
                          <Badge key={role.id} tone={role.code === "admin" ? "indigo" : "gray"}>
                            {role.code}
                          </Badge>
                        ))}
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      <Badge tone={user.isActive ? "green" : "red"}>
                        {user.isActive ? "Active" : "Disabled"}
                      </Badge>
                    </td>
                    <td className="px-5 py-3 text-slate-400">{formatDateTime(user.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
