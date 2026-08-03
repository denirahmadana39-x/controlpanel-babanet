import { useMutation } from "@tanstack/react-query";
import { Alert, Button, Card, CardBody, CardHeader, Field, Input, api } from "@hosting/ui";
import { useState } from "react";

export function SettingsPage() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const changePassword = useMutation({
    mutationFn: (body: { currentPassword: string; newPassword: string }) =>
      api.post("/api/auth/change-password", body),
    onSuccess: () => {
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setSaved(true);
      setError(null);
    },
    onError: (caught) => {
      setError(caught instanceof Error ? caught.message : "Failed to change password");
    },
  });

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setError(null);
    setSaved(false);
    if (newPassword !== confirmPassword) {
      setError("New passwords do not match");
      return;
    }
    changePassword.mutate({ currentPassword, newPassword });
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-100">Settings</h1>
        <p className="mt-1 text-sm text-slate-400">Manage your account security</p>
      </div>

      <Card>
        <CardHeader
          title="Change password"
          description="Requires your current password. All sessions are kept, this only updates your credentials."
        />
        <CardBody>
          <form onSubmit={handleSubmit} className="grid max-w-md gap-4">
            {error ? <Alert>{error}</Alert> : null}
            {saved ? <Alert tone="success">Password updated</Alert> : null}
            <Field label="Current password">
              <Input
                type="password"
                autoComplete="current-password"
                required
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
              />
            </Field>
            <Field label="New password" hint="At least 8 characters, mixed case and a number">
              <Input
                type="password"
                autoComplete="new-password"
                required
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
              />
            </Field>
            <Field label="Confirm new password">
              <Input
                type="password"
                autoComplete="new-password"
                required
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
              />
            </Field>
            <div>
              <Button type="submit" loading={changePassword.isPending}>
                Update password
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}
