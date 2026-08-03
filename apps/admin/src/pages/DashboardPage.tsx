import { useQuery } from "@tanstack/react-query";
import {
  api,
  Card,
  CardBody,
  CardHeader,
  formatBytes,
  formatDuration,
  formatRelative,
  type ProjectListResponse,
  type SystemInfo,
} from "@hosting/ui";

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardBody>
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
        <p className="mt-1 text-2xl font-semibold text-slate-100">{value}</p>
        {sub ? <p className="mt-0.5 text-xs text-slate-400">{sub}</p> : null}
      </CardBody>
    </Card>
  );
}

export function DashboardPage() {
  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: () => api.get<ProjectListResponse>("/api/projects"),
  });
  const systemQuery = useQuery({
    queryKey: ["system"],
    queryFn: () => api.get<SystemInfo>("/api/system"),
  });

  const projects = projectsQuery.data?.projects ?? [];
  const active = projects.filter((project) => project.status === "ACTIVE").length;
  const suspended = projects.filter((project) => project.status === "SUSPENDED").length;
  const system = systemQuery.data;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-100">Dashboard</h1>
        <p className="mt-1 text-sm text-slate-400">Overview of projects and platform health</p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Projects" value={String(projects.length)} />
        <StatCard label="Active" value={String(active)} />
        <StatCard label="Suspended" value={String(suspended)} />
        <StatCard
          label="Memory usage"
          value={system ? `${system.memory.usagePercent.toFixed(1)}%` : "—"}
          {...(system
            ? {
                sub: `${formatBytes(system.memory.usedBytes)} / ${formatBytes(system.memory.totalBytes)}`,
              }
            : {})}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Platform status"
            description="System information from the API server"
          />
          <CardBody>
            {system ? (
              <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                <dt className="text-slate-500">Hostname</dt>
                <dd className="text-right text-slate-200">{system.hostname}</dd>
                <dt className="text-slate-500">Platform</dt>
                <dd className="text-right text-slate-200">
                  {system.platform} / {system.arch}
                </dd>
                <dt className="text-slate-500">Node version</dt>
                <dd className="text-right text-slate-200">{system.nodeVersion}</dd>
                <dt className="text-slate-500">CPU cores</dt>
                <dd className="text-right text-slate-200">{system.cpu.cores}</dd>
                <dt className="text-slate-500">Load average</dt>
                <dd className="text-right text-slate-200">
                  {system.cpu.loadAvg.map((value) => value.toFixed(2)).join(" / ")}
                </dd>
                <dt className="text-slate-500">Uptime</dt>
                <dd className="text-right text-slate-200">
                  {formatDuration(system.uptimeSeconds)}
                </dd>
              </dl>
            ) : (
              <p className="text-sm text-slate-400">System information unavailable.</p>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Recent projects"
            description="Latest projects created on the platform"
          />
          <CardBody>
            {projects.length === 0 ? (
              <p className="text-sm text-slate-400">No projects yet.</p>
            ) : (
              <ul className="divide-y divide-slate-800">
                {[...projects]
                  .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
                  .slice(0, 5)
                  .map((project) => (
                    <li key={project.id} className="flex items-center justify-between py-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-200">
                          {project.name}
                        </p>
                        <p className="truncate text-xs text-slate-500">
                          {project.owner.displayName}
                        </p>
                      </div>
                      <span className="text-xs text-slate-400">
                        {formatRelative(project.createdAt)}
                      </span>
                    </li>
                  ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
