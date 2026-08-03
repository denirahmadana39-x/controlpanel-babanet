import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ROLE_CODES } from "@hosting/shared";
import {
  api,
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Field,
  Input,
  Spinner,
  formatDateTime,
  type UserResponse,
} from "@hosting/ui";
import { useState } from "react";
import { useNavigate, useParams } from "react-router";

export function UserDetailPage() {
  const { id = "" } = useParams();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const query = useQuery({
    queryKey: ["users", id],
    queryFn: () => api.get<UserResponse>(`/api/users/${id}`),
  });

  const user = query.data?.user;

  const [displayName, setDisplayName] = useState(user?.displayName ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [isActive, setIsActive] = useState(user?.isActive ?? true);
  const [roleCodes, setRoleCodes] = useState<string[]>(user?.roles.map((role) => role.code) ?? []);
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const profile = useMutation({
    mutationFn: (body: { displayName: string; email: string; isActive: boolean }) =>
      api.patch<UserResponse>(`/api/users/${id}`, body),
    onSuccess: (data) => {
      void queryClient.setQueryData(["users", id], data);
      setSaved(true);
      setError(null);
    },
    onError: (caught) => {
      setError(caught instanceof Error ? caught.message : "Failed to update user");
    },
  });

  const roles = useMutation({
    mutationFn: (body: { roleCodes: string[] }) =>
      api.put<UserResponse>(`/api/users/${id}/roles`, body),
    onSuccess: (data) => {
      void queryClient.setQueryData(["users", id], data);
      setSaved(true);
      setError(null);
    },
    onError: (caught) => {
      setError(caught instanceof Error ? caught.message : "Failed to update roles");
    },
  });

  const resetPassword = useMutation({
    mutationFn: (body: { password: string }) => api.patch<UserResponse>(`/api/users/${id}`, body),
    onSuccess: () => {
      setNewPassword("");
      setSaved(true);
      setError(null);
    },
    onError: (caught) => {
      setError(caught instanceof Error ? caught.message : "Failed to reset password");
    },
  });

  const remove = useMutation({
    mutationFn: () => api.delete(`/api/users/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["users"] });
      navigate("/users");
    },
    onError: (caught) => {
      setError(caught instanceof Error ? caught.message : "Failed to delete user");
    },
  });

  if (query.isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    );
  }

  if (!user) {
    return (
      <Alert>
        {query.isError && query.error instanceof Error ? query.error.message : "User not found"}
      </Alert>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">{user.displayName}</h1>
          <p className="mt-1 text-sm text-slate-400">
            Member since {formatDateTime(user.createdAt)}
          </p>
        </div>
        <Button
          variant="danger"
          loading={remove.isPending}
          onClick={() => {
            if (window.confirm(`Delete user ${user.email}? This cannot be undone.`)) {
              remove.mutate();
            }
          }}
        >
          Delete user
        </Button>
      </div>

      {error ? <Alert>{error}</Alert> : null}
      {saved ? <Alert tone="success">Changes saved</Alert> : null}

      <Card>
        <CardHeader title="Profile" description="Basic account information" />
        <CardBody>
          <form
            className="grid max-w-2xl gap-4 sm:grid-cols-2"
            onSubmit={(event) => {
              event.preventDefault();
              profile.mutate({ displayName, email, isActive });
            }}
          >
            <Field label="Display name">
              <Input value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
            </Field>
            <Field label="Email">
              <Input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </Field>
            <div className="flex items-center gap-2 sm:col-span-2">
              <input
                id="active"
                type="checkbox"
                checked={isActive}
                onChange={(event) => setIsActive(event.target.checked)}
                className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-indigo-600 focus:ring-indigo-500"
              />
              <label htmlFor="active" className="text-sm text-slate-300">
                Account enabled
              </label>
            </div>
            <div className="sm:col-span-2">
              <Button type="submit" loading={profile.isPending}>
                Save profile
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Roles" description="Determines which permissions this user has" />
        <CardBody>
          <div className="mb-4 flex flex-wrap gap-2">
            {Object.values(ROLE_CODES).map((code) => {
              const checked = roleCodes.includes(code);
              return (
                <button
                  key={code}
                  type="button"
                  onClick={() =>
                    setRoleCodes((current) =>
                      checked ? current.filter((value) => value !== code) : [...current, code],
                    )
                  }
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                    checked
                      ? "border-indigo-500 bg-indigo-500/15 text-indigo-300"
                      : "border-slate-700 bg-slate-900 text-slate-400 hover:border-slate-600"
                  }`}
                >
                  {code}
                </button>
              );
            })}
          </div>
          <Button
            variant="secondary"
            loading={roles.isPending}
            onClick={() => roles.mutate({ roleCodes })}
          >
            Save roles
          </Button>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Reset password"
          description="Sets a new password and signs the user out everywhere"
        />
        <CardBody>
          <form
            className="flex max-w-2xl flex-col gap-4 sm:flex-row sm:items-end"
            onSubmit={(event) => {
              event.preventDefault();
              if (newPassword.length > 0) {
                resetPassword.mutate({ password: newPassword });
              }
            }}
          >
            <div className="flex-1">
              <Field label="New password" hint="At least 8 characters, mixed case and a number">
                <Input
                  type="password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  placeholder="••••••••"
                />
              </Field>
            </div>
            <Button
              type="submit"
              loading={resetPassword.isPending}
              disabled={newPassword.length === 0}
            >
              Reset password
            </Button>
          </form>
          <div className="mt-3">
            <Badge tone="gray">
              Current: {user.roles.map((role) => role.code).join(", ") || "none"}
            </Badge>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
