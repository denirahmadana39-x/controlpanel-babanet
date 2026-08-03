import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
  Textarea,
  formatBytes,
  formatDateTime,
  type ProjectResponse,
  type ProjectStatus,
} from "@hosting/ui";
import { useState } from "react";
import { useNavigate, useParams } from "react-router";

const statusTone: Record<ProjectStatus, "gray" | "green" | "red"> = {
  DRAFT: "gray",
  ACTIVE: "green",
  SUSPENDED: "red",
};

const statusOptions: ProjectStatus[] = ["DRAFT", "ACTIVE", "SUSPENDED"];

export function ProjectDetailPage() {
  const { id = "" } = useParams();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const query = useQuery({
    queryKey: ["projects", id],
    queryFn: () => api.get<ProjectResponse>(`/api/projects/${id}`),
  });

  const project = query.data?.project;

  const [name, setName] = useState(project?.name ?? "");
  const [description, setDescription] = useState(project?.description ?? "");
  const [status, setStatus] = useState<ProjectStatus>(project?.status ?? "DRAFT");
  const [quotaMb, setQuotaMb] = useState(String(project?.storageQuotaMb ?? 100));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const update = useMutation({
    mutationFn: (body: {
      name: string;
      description?: string;
      status: ProjectStatus;
      storageQuotaMb?: number;
    }) => api.patch<ProjectResponse>(`/api/projects/${id}`, body),
    onSuccess: (data) => {
      void queryClient.setQueryData(["projects", id], data);
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
      setSaved(true);
      setError(null);
    },
    onError: (caught) => {
      setError(caught instanceof Error ? caught.message : "Failed to update project");
    },
  });

  const remove = useMutation({
    mutationFn: () => api.delete(`/api/projects/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
      navigate("/projects");
    },
    onError: (caught) => {
      setError(caught instanceof Error ? caught.message : "Failed to delete project");
    },
  });

  if (query.isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    );
  }

  if (!project) {
    return (
      <Alert>
        {query.isError && query.error instanceof Error ? query.error.message : "Project not found"}
      </Alert>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-xl font-semibold text-slate-100">{project.name}</h1>
            <p className="mt-1 text-sm text-slate-400">
              Created {formatDateTime(project.createdAt)} by {project.owner.displayName}
            </p>
          </div>
          <Badge tone={statusTone[project.status]}>{project.status}</Badge>
        </div>
        <Button
          variant="danger"
          loading={remove.isPending}
          onClick={() => {
            if (window.confirm(`Delete project "${project.name}"? This cannot be undone.`)) {
              remove.mutate();
            }
          }}
        >
          Delete project
        </Button>
      </div>

      {error ? <Alert>{error}</Alert> : null}
      {saved ? <Alert tone="success">Changes saved</Alert> : null}

      <Card>
        <CardHeader title="Settings" description="Project configuration" />
        <CardBody>
          <form
            className="grid max-w-2xl gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              update.mutate({
                name,
                ...(description.trim().length > 0 ? { description: description.trim() } : {}),
                status,
                ...(Number.isFinite(Number(quotaMb)) ? { storageQuotaMb: Number(quotaMb) } : {}),
              });
            }}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name">
                <Input value={name} onChange={(event) => setName(event.target.value)} />
              </Field>
              <Field label="Storage quota (MB)">
                <Input
                  type="number"
                  min={1}
                  value={quotaMb}
                  onChange={(event) => setQuotaMb(event.target.value)}
                />
              </Field>
            </div>
            <Field label="Description">
              <Textarea
                rows={2}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </Field>
            <Field label="Status">
              <div className="flex flex-wrap gap-2">
                {statusOptions.map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setStatus(option)}
                    className={`inline-flex items-center rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
                      status === option
                        ? "border-indigo-500 bg-indigo-500/15 text-indigo-300"
                        : "border-slate-700 bg-slate-900 text-slate-400 hover:border-slate-600"
                    }`}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </Field>
            <div>
              <Button type="submit" loading={update.isPending}>
                Save changes
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Storage" description="Current allocation" />
        <CardBody>
          <p className="text-sm text-slate-300">
            {formatBytes(project.storageQuotaMb * 1024 * 1024)} allocated
          </p>
        </CardBody>
      </Card>
    </div>
  );
}
