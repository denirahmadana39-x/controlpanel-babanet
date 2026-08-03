import { useQuery } from "@tanstack/react-query";
import {
  api,
  Badge,
  Card,
  CardBody,
  CardHeader,
  ProgressBar,
  Spinner,
  formatBytes,
  formatDuration,
  formatPercent,
  type StorageInfo,
  type SystemInfo,
} from "@hosting/ui";

export function MonitoringPage() {
  const systemQuery = useQuery({
    queryKey: ["system"],
    queryFn: () => api.get<SystemInfo>("/api/system"),
    refetchInterval: 15_000,
  });
  const storageQuery = useQuery({
    queryKey: ["storage"],
    queryFn: () => api.get<StorageInfo>("/api/storage"),
    refetchInterval: 15_000,
  });

  const system = systemQuery.data;
  const storage = storageQuery.data;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-100">Monitoring</h1>
        <p className="mt-1 text-sm text-slate-400">Platform system and storage metrics</p>
      </div>

      {systemQuery.isLoading && storageQuery.isLoading ? (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="System resources"
            description={
              system
                ? `${system.hostname} · up ${formatDuration(system.uptimeSeconds)}`
                : "System resources"
            }
          />
          <CardBody className="space-y-5">
            {system ? (
              <>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-400">Memory</span>
                    <span className="text-slate-200">
                      {formatPercent(system.memory.usagePercent)} ·{" "}
                      {formatBytes(system.memory.usedBytes)} /{" "}
                      {formatBytes(system.memory.totalBytes)}
                    </span>
                  </div>
                  <ProgressBar percent={system.memory.usagePercent} />
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-400">Disk</span>
                    <span className="text-slate-200">
                      {formatPercent(system.disk.usagePercent)} ·{" "}
                      {formatBytes(system.disk.usedBytes)} / {formatBytes(system.disk.totalBytes)}
                    </span>
                  </div>
                  <ProgressBar percent={system.disk.usagePercent} />
                </div>
                <div className="grid grid-cols-2 gap-4 pt-2 text-sm">
                  <div>
                    <p className="text-slate-500">Platform</p>
                    <p className="mt-0.5 text-slate-200">
                      {system.platform} / {system.arch}
                    </p>
                  </div>
                  <div>
                    <p className="text-slate-500">Node</p>
                    <p className="mt-0.5 text-slate-200">{system.nodeVersion}</p>
                  </div>
                  <div>
                    <p className="text-slate-500">CPU cores</p>
                    <p className="mt-0.5 text-slate-200">{system.cpu.cores}</p>
                  </div>
                  <div>
                    <p className="text-slate-500">Load (1/5/15m)</p>
                    <p className="mt-0.5 text-slate-200">
                      {system.cpu.loadAvg.map((value) => value.toFixed(2)).join(" / ")}
                    </p>
                  </div>
                </div>
              </>
            ) : (
              <p className="text-sm text-slate-400">System metrics unavailable.</p>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Storage" description="Aggregate usage across projects" />
          <CardBody className="space-y-5">
            {storage ? (
              <>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-400">Overall usage</span>
                    <span className="text-slate-200">
                      {formatPercent(storage.usagePercent)} ·{" "}
                      {formatBytes(storage.totalUsedMb * 1024 * 1024)} /{" "}
                      {formatBytes(storage.totalQuotaMb * 1024 * 1024)}
                    </span>
                  </div>
                  <ProgressBar percent={storage.usagePercent} />
                </div>
                <div>
                  <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                    By project
                  </p>
                  {storage.projects.length === 0 ? (
                    <p className="text-sm text-slate-400">No projects with storage yet.</p>
                  ) : (
                    <ul className="space-y-3">
                      {storage.projects.map((project) => (
                        <li key={project.projectId}>
                          <div className="flex items-center justify-between text-sm">
                            <span className="text-slate-200">{project.projectName}</span>
                            <span className="text-xs text-slate-500">
                              {formatPercent(project.usagePercent)} ·{" "}
                              {formatBytes(project.usedMb * 1024 * 1024)}
                            </span>
                          </div>
                          <div className="mt-1">
                            <ProgressBar percent={project.usagePercent} />
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="flex items-center gap-2 pt-2">
                  <Badge tone="gray">{storage.backups.count} backups</Badge>
                  <Badge tone="gray">
                    {formatBytes(storage.backups.totalSizeMb * 1024 * 1024)}
                  </Badge>
                </div>
              </>
            ) : (
              <p className="text-sm text-slate-400">Storage metrics unavailable.</p>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
