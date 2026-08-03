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
  Textarea,
  formatBytes,
  formatRelative,
  type ProjectListResponse,
  type ProjectStatus,
} from "@hosting/ui";
import { useState } from "react";
import { Link } from "react-router";

const statusTone: Record<ProjectStatus, "gray" | "green" | "red"> = {
  DRAFT: "gray",
  ACTIVE: "green",
  SUSPENDED: "red",
};

export function ProjectsPage() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["projects"],
    queryFn: () => api.get<ProjectListResponse>("/api/projects"),
  });

  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [quotaMb, setQuotaMb] = useState("100");
  const [error, setError] = useState<string | null>(null);

  const createProject = useMutation({
    mutationFn: (body: { name: string; description?: string; storageQuotaMb?: number }) =>
      api.post("/api/projects", body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
      setShowCreate(false);
      setName("");
      setDescription("");
      setQuotaMb("100");
      setError(null);
    },
    onError: (caught) => {
      setError(caught instanceof Error ? caught.message : "Failed to create project");
    },
  });

  const projects = query.data?.projects ?? [];

  const handleCreate = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setError(null);
    createProject.mutate({
      name,
      ...(description.trim().length > 0 ? { description: description.trim() } : {}),
      ...(Number.isFinite(Number(quotaMb)) ? { storageQuotaMb: Number(quotaMb) } : {}),
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Projects</h1>
          <p className="mt-1 text-sm text-slate-400">All projects on the platform</p>
        </div>
        <Button onClick={() => setShowCreate((value) => !value)}>
          {showCreate ? "Cancel" : "New project"}
        </Button>
      </div>

      {showCreate ? (
        <Card>
          <CardHeader
            title="Create project"
            description="Names must be lowercase, alphanumeric, and hyphenated"
          />
          <CardBody>
            <form onSubmit={handleCreate} className="grid max-w-2xl gap-4">
              {error ? <Alert>{error}</Alert> : null}
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Name" hint="e.g. my-site">
                  <Input
                    required
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="my-site"
                  />
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
              <div>
                <Button type="submit" loading={createProject.isPending}>
                  Create project
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
          ) : projects.length === 0 ? (
            <EmptyState
              title="No projects"
              description="Create your first project to get started."
            />
          ) : (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-800 text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-5 py-3 font-medium">Project</th>
                  <th className="px-5 py-3 font-medium">Owner</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium">Quota</th>
                  <th className="px-5 py-3 font-medium">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {projects.map((project) => (
                  <tr key={project.id} className="hover:bg-slate-800/40">
                    <td className="px-5 py-3">
                      <Link to={`/projects/${project.id}`} className="block hover:text-indigo-300">
                        <p className="font-medium text-slate-200">{project.name}</p>
                        {project.description ? (
                          <p className="max-w-xs truncate text-xs text-slate-500">
                            {project.description}
                          </p>
                        ) : null}
                      </Link>
                    </td>
                    <td className="px-5 py-3">
                      <p className="text-slate-200">{project.owner.displayName}</p>
                      <p className="text-xs text-slate-500">{project.owner.email}</p>
                    </td>
                    <td className="px-5 py-3">
                      <Badge tone={statusTone[project.status]}>{project.status}</Badge>
                    </td>
                    <td className="px-5 py-3 text-slate-400">
                      {formatBytes(project.storageQuotaMb * 1024 * 1024)}
                    </td>
                    <td className="px-5 py-3 text-slate-400">
                      {formatRelative(project.updatedAt)}
                    </td>
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
