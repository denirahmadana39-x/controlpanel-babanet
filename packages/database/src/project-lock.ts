/**
 * Stable hash used to derive Postgres advisory lock keys from a project id.
 *
 * FNV-1a produces a 32-bit hash; to reduce collision risk we hash the project
 * id twice with different salts and return two signed 32-bit halves. Postgres
 * `pg_advisory_xact_lock(int4, int4)` accepts keys in the signed int4 range,
 * which is why the halves are masked with `| 0`.
 *
 * Used to serialize per-project operations (version allocation, deploys,
 * rollbacks) across concurrent API and worker processes.
 */
export function projectLockKey(projectId: string): number {
  let hash = 2166136261 >>> 0;
  for (let i = 0; i < projectId.length; i += 1) {
    hash ^= projectId.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}

export interface ProjectLockKeyPair {
  a: number;
  b: number;
}

export function projectLockKeyPair(projectId: string): ProjectLockKeyPair {
  return {
    a: projectLockKey(`${projectId}:a`) | 0,
    b: projectLockKey(`${projectId}:b`) | 0,
  };
}
