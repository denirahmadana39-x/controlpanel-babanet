import type { PrismaClient, Worker } from "../../generated/client/client.js";

export interface RegisterWorkerInput {
  id: string;
  hostname: string;
  pid: number;
}

export interface ActiveWorker {
  id: string;
  hostname: string;
  pid: number;
  lastHeartbeatAt: Date;
  startedAt: Date;
}

export class WorkerRepository {
  constructor(private readonly client: PrismaClient) {}

  async register(input: RegisterWorkerInput): Promise<Worker> {
    return this.client.worker.create({
      data: {
        id: input.id,
        hostname: input.hostname,
        pid: input.pid,
      },
    });
  }

  async heartbeat(id: string): Promise<void> {
    await this.client.worker.update({
      where: { id },
      data: { lastHeartbeatAt: new Date() },
    });
  }

  async stop(id: string): Promise<void> {
    await this.client.worker.updateMany({
      where: { id },
      data: { stoppedAt: new Date() },
    });
  }

  async findActive(staleAfterMinutes: number): Promise<ActiveWorker[]> {
    const cutoff = new Date(Date.now() - staleAfterMinutes * 60_000);
    const rows = await this.client.worker.findMany({
      where: { stoppedAt: null, lastHeartbeatAt: { gte: cutoff } },
      select: { id: true, hostname: true, pid: true, lastHeartbeatAt: true, startedAt: true },
    });
    return rows;
  }

  async countActive(staleAfterMinutes: number): Promise<number> {
    const cutoff = new Date(Date.now() - staleAfterMinutes * 60_000);
    return this.client.worker.count({
      where: { stoppedAt: null, lastHeartbeatAt: { gte: cutoff } },
    });
  }

  async pruneStale(staleAfterMinutes: number): Promise<number> {
    const cutoff = new Date(Date.now() - staleAfterMinutes * 60_000);
    const result = await this.client.worker.updateMany({
      where: { stoppedAt: null, lastHeartbeatAt: { lt: cutoff } },
      data: { stoppedAt: new Date() },
    });
    return result.count;
  }
}
