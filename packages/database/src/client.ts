import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/client/client.js";
export type { PrismaClient } from "../generated/client/client.js";

export interface DatabaseClientConfig {
  connectionString: string;
}

export function createPrismaClient(config: DatabaseClientConfig): PrismaClient {
  const adapter = new PrismaPg({
    connectionString: config.connectionString,
  });
  return new PrismaClient({ adapter });
}
